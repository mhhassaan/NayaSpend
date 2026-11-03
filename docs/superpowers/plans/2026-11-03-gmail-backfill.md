# Gmail Capture (Backfill Only, Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the NayaPay Gmail adapter's historical-backfill path — parsing matching emails into draft transactions, with a resumable `pageToken` checkpoint — and the OAuth connect/callback routes needed to obtain a Gmail token at all. Ongoing (forward) polling, the Capture Scheduler cron wrapper, and the Watchdog are explicitly out of scope (Phase 5).

**Architecture:** A `GmailClient` interface (list/get messages) with a real `fetch`-based implementation against the Gmail REST API, and a fake implementation for tests — this is the one seam the adapter needs to be unit-testable without live network/OAuth. The adapter's pure parsing logic (`parseNayaPayEmail`) is separated from its orchestration logic (`runBackfill`) so parsing can be tested directly against fixture email bodies.

**Tech Stack:** TypeScript on Cloudflare Workers, Hono (for the new `authGmail` routes), Cloudflare D1 via Drizzle (from the Phase 0-1 foundation), Web Crypto (via the existing `security.ts`), native `fetch` for Gmail's REST API and Google's OAuth token endpoint.

**Spec:** `docs/designs/personal-spending-tracker.md` — Technical Plan → Capture paths → "1. NayaPay Gmail import"; Canonical Transaction model; CUJ 1 (first-time connection + backfill) and CUJ 4 (capture breaks silently, for context on what state this phase must leave behind for Phase 5's Watchdog); Non-Functional Requirements → Security & Privacy (sender/subject-scoped queries only, OAuth token encrypted at rest); Detailed Implementation Plan items 7, 22, 29; Open Questions → "NayaPay email parsing approach", "OAuth token storage and lifecycle".

## Plan-Level Rulings (resolving spec gaps before task breakdown)

- The spec's Build Phases list assigns item 27 (`dedupEngine.test.ts`) to *both* Phase 2 and Phase 3. `dedupEngine.ts` (item 12) isn't built until Phase 3, so item 27 cannot run in Phase 2 — this plan excludes it; it belongs to the upcoming Phase 3 (statement import + dedup) plan.
- The spec's Build Phases list never assigns item 22 (`authGmail.ts`) to any phase. Since nothing in Phase 2 can be exercised end-to-end without an OAuth-connected account, this plan pulls item 22 in now, scoped minimally (connect + callback + reconnect, storing the encrypted token via the existing `security.ts`).
- The spec leaves the exact NayaPay email parsing rules as an open question (no real sample emails were available to this plan). This plan implements a reasonable regex-based extraction (amount, vendor, date from subject/body) against synthetic fixtures modeled on typical digital-payment notification emails, and flags to the human partner that real NayaPay email samples should be used to validate/correct the parser before relying on it for real backfill.

## Global Constraints

- Gmail OAuth scope is `gmail.readonly`, which grants read access to the *whole mailbox* — Gmail has no scope restrictable to one sender ahead of time. The sender/subject restriction must be enforced entirely in this app's own query logic (`messages.list` query string), never relaxed to a broader read.
- The backfill pages *backward* through old mail using Gmail's `pageToken`, with the last-processed token persisted so an interruption resumes rather than restarting from zero. This is a distinct mechanism from the forward `historyId` watermark Phase 5's ongoing polling uses — do not conflate them or store them in the same field.
- Backfill parsing must be chunked across multiple invocations (a bounded batch of messages per invocation, persisting `pageToken` after each chunk) to stay within a single Cloudflare Worker invocation's execution-time limit.
- A low-confidence or failed parse is written with `review_status: pending_review` — never silently dropped and never thrown away.
- The adapter records, per poll cycle, the exact query string used and scanned/matched counts, as diagnostic logging only (not an automated alert).
- The Gmail OAuth token (access + refresh) must be encrypted at rest using the existing `encryptToken`/`decryptToken` from `backend/src/security.ts` before being written to the `gmail_credentials` table.
- `transactions.source` for every row this adapter writes is the literal string `"gmail_email"`.
- `transactions.amount` is an integer in minor units (cents) — parsed amounts must be converted from decimal currency notation, never stored as a float.

## Review Focus

- **A matching email whose body doesn't fit the expected template** (e.g. a promotional NayaPay email that happens to match the sender/subject filter, or a transaction email with a layout variant) must be quarantined (`pending_review`), not crash the batch or get silently dropped. → test in Task 2.
- **A decimal amount string with multiple formats** (e.g. "Rs. 1,250.00", "PKR 1250", "1250.5") must parse to the correct integer cent value or be quarantined — never truncate/round in a way that silently loses money. → test in Task 2.
- **An interrupted backfill resuming from a saved `pageToken`** must not reprocess already-handled messages, and must not lose the checkpoint if the Worker invocation ends mid-chunk. → test in Task 3.
- **The Gmail REST client never issues an unscoped mailbox read** — every `messages.list` call must include the sender/subject query string, with no code path that calls it without one. → test in Task 1.
- **A failed OAuth token exchange or an already-connected account retrying `connect`** must fail with a clear, specific error rather than silently overwriting a working credential with a broken one. → test in Task 4.

---

### Task 1: GmailClient interface + real REST implementation

**Files:**
- Create: `backend/src/adapters/gmailClient.ts`
- Test: `backend/test/gmailClient.test.ts`

**Interfaces:**
- Produces: `GmailClient` interface — `listMessages(query: string, pageToken?: string): Promise<{ messages: {id: string}[]; nextPageToken?: string }>` and `getMessage(id: string): Promise<{ id: string; threadId: string; subject: string; from: string; bodyText: string; internalDate: string }>` — plus `createGmailClient(accessToken: string): GmailClient`, the real `fetch`-based implementation. Task 3's `runBackfill` consumes this interface (injected, not imported directly), and tests there use a fake implementation of the same interface.
- Produces: `NAYAPAY_QUERY` — the exported sender/subject query string constant, so every caller uses the identical, auditable restriction.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test, vi } from "vitest";
import { createGmailClient, NAYAPAY_QUERY } from "../src/adapters/gmailClient";

describe("createGmailClient", () => {
  test("listMessages always includes the sender/subject query string, never an unscoped read", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain(encodeURIComponent(NAYAPAY_QUERY));
      return new Response(JSON.stringify({ messages: [{ id: "m1" }], nextPageToken: "tok2" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGmailClient("fake-access-token");
    const result = await client.listMessages(NAYAPAY_QUERY, "tok1");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.messages).toEqual([{ id: "m1" }]);
    expect(result.nextPageToken).toBe("tok2");
  });

  test("getMessage parses subject, sender, and plain-text body from the Gmail API response shape", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "m1",
          threadId: "t1",
          internalDate: "1730000000000",
          payload: {
            headers: [
              { name: "Subject", value: "You spent PKR 500" },
              { name: "From", value: "NayaPay <noreply@nayapay.com>" },
            ],
            body: { data: Buffer.from("Transaction body text").toString("base64url") },
          },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGmailClient("fake-access-token");
    const message = await client.getMessage("m1");

    expect(message.subject).toBe("You spent PKR 500");
    expect(message.from).toBe("NayaPay <noreply@nayapay.com>");
    expect(message.bodyText).toBe("Transaction body text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- gmailClient`
Expected: FAIL with "Cannot find module '../src/adapters/gmailClient'".

- [ ] **Step 3: Implement `backend/src/adapters/gmailClient.ts`**

Export `NAYAPAY_QUERY = 'from:nayapay.com subject:"You spent"'` (or similar sender+subject restriction — document that the exact subject phrase is provisional pending real samples, per the Plan-Level Rulings above). `createGmailClient(accessToken)` returns an object whose `listMessages` calls `GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q=<query>&pageToken=<token>` with an `Authorization: Bearer <accessToken>` header, and whose `getMessage` calls `GET .../messages/{id}` and extracts the `Subject`/`From` headers and base64url-decodes `payload.body.data` (handle the case where the body is nested under `payload.parts` for multipart messages — decode the first `text/plain` part found). Use Node's `Buffer` is NOT available in Workers — use `atob`/manual base64url decode (reuse the pattern from `security.ts`'s `base64ToBytes`, adapting for the URL-safe alphabet).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- gmailClient`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/adapters/gmailClient.ts backend/test/gmailClient.test.ts
git commit -m "feat: add Gmail REST client with sender/subject-scoped queries"
```

---

### Task 2: Email parser (pure function, fixture-tested)

**Files:**
- Create: `backend/src/adapters/parseNayaPayEmail.ts`
- Create: `backend/test/fixtures/nayapayEmails.ts`
- Test: `backend/test/gmailAdapter.test.ts` (spec item 29 — parsing portion)

**Interfaces:**
- Consumes: nothing from earlier tasks (pure function, fixture input only).
- Produces: `parseNayaPayEmail(email: { subject: string; from: string; bodyText: string; internalDate: string }): ParsedEmailResult`, where `ParsedEmailResult = { confidence: "high" } & ParsedTransaction | { confidence: "low"; reason: string }` and `ParsedTransaction = { amountCents: number; date: string; vendorRaw: string }`. Task 3's `runBackfill` consumes this function by name and this exact result shape.

- [ ] **Step 1: Write fixtures in `backend/test/fixtures/nayapayEmails.ts`**

Export an array of synthetic sample emails covering: a clean "Rs. 1,250.00 spent at Starbucks" style email (high confidence), a "PKR 500" format variant (high confidence, different currency notation), a promotional email that matches sender/subject filtering but has no transaction amount at all (low confidence), and a transaction email with a malformed/unexpected body layout (low confidence). Each fixture has `{ subject, from, bodyText, internalDate }` matching `GmailClient.getMessage`'s return shape.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, expect, test } from "vitest";
import { parseNayaPayEmail } from "../src/adapters/parseNayaPayEmail";
import { cleanTransactionEmail, pkrFormatEmail, promoEmailNoAmount, malformedLayoutEmail } from "./fixtures/nayapayEmails";

describe("parseNayaPayEmail", () => {
  test("parses a clean 'Rs. 1,250.00' transaction email to 125000 cents", () => {
    const result = parseNayaPayEmail(cleanTransactionEmail);
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(125000);
      expect(result.vendorRaw).toContain("Starbucks");
    }
  });

  test("parses a 'PKR 500' format email to 50000 cents", () => {
    const result = parseNayaPayEmail(pkrFormatEmail);
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(50000);
    }
  });

  test("a matching email with no transaction amount is low-confidence, not thrown", () => {
    const result = parseNayaPayEmail(promoEmailNoAmount);
    expect(result.confidence).toBe("low");
  });

  test("a malformed/unexpected body layout is low-confidence, not thrown", () => {
    const result = parseNayaPayEmail(malformedLayoutEmail);
    expect(result.confidence).toBe("low");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm run test -- gmailAdapter`
Expected: FAIL with "Cannot find module '../src/adapters/parseNayaPayEmail'".

- [ ] **Step 4: Implement `backend/src/adapters/parseNayaPayEmail.ts`**

Extract an amount via regex matching both `Rs\.?\s*([\d,]+\.?\d*)` and `PKR\s*([\d,]+\.?\d*)` patterns (strip commas, parse as float, multiply by 100 and round to get integer cents — never leave it as a float). Extract a vendor via a simple pattern (e.g. text following "at " or "to " in the body, falling back to the email subject). Extract the date from `internalDate` (Gmail's millisecond-epoch string) converted to an ISO date string. Return `{ confidence: "low", reason: "..." }` with a specific reason (e.g. "no amount found", "unrecognized layout") whenever the amount can't be confidently extracted — never throw.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm run test -- gmailAdapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/parseNayaPayEmail.ts backend/test/fixtures/nayapayEmails.ts backend/test/gmailAdapter.test.ts
git commit -m "feat: add NayaPay email parser with confidence-scored fallback"
```

---

### Task 3: Backfill orchestration (chunked, resumable)

**Files:**
- Modify: `backend/src/adapters/gmailAdapter.ts` (Create — this is spec item 7's main file)
- Modify: `backend/test/gmailAdapter.test.ts` (add backfill-orchestration tests alongside Task 2's parser tests)

**Interfaces:**
- Consumes: `GmailClient` (Task 1, injected — never imported/constructed directly inside `runBackfill`, so tests inject a fake), `parseNayaPayEmail` (Task 2), `categorize` (from `backend/src/services/categorizationEngine.ts`, Phase 0-1), the `transactions` and `captureRuns` tables (schema, Phase 0-1).
- Produces: `runBackfill(db: DrizzleD1Database, client: GmailClient, options?: { maxMessagesPerChunk?: number }): Promise<{ processed: number; nextPageToken: string | null }>`. Phase 5's `captureScheduler.ts` (a later plan) will call this function (or its ongoing-polling sibling) by this name.

- [ ] **Step 1: Write the failing test**

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { transactions, captureRuns } from "../src/db/schema";
import { runBackfill } from "../src/adapters/gmailAdapter";
import { cleanTransactionEmail, promoEmailNoAmount } from "./fixtures/nayapayEmails";
import type { GmailClient } from "../src/adapters/gmailClient";

function fakeClient(messagesByPage: Record<string, { id: string }[]>, bodies: Record<string, typeof cleanTransactionEmail>, nextTokens: Record<string, string | undefined>): GmailClient {
  return {
    async listMessages(_query, pageToken = "first") {
      return { messages: messagesByPage[pageToken] ?? [], nextPageToken: nextTokens[pageToken] };
    },
    async getMessage(id) {
      return bodies[id];
    },
  };
}

describe("runBackfill", () => {
  test("parses a chunk of matching messages, writes high-confidence ones as committed", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: [{ id: "m1" }] },
      { m1: cleanTransactionEmail },
      { first: undefined }
    );

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(1);
    expect(result.nextPageToken).toBeNull();
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("gmail_email");
    expect(rows[0].reviewStatus).toBe("committed");
  });

  test("a low-confidence parse is written as pending_review, not dropped", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: [{ id: "m2" }] },
      { m2: promoEmailNoAmount },
      { first: undefined }
    );

    await runBackfill(db, client);

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewStatus).toBe("pending_review");
  });

  test("persists nextPageToken to capture_runs so an interruption can resume", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: [{ id: "m1" }] },
      { m1: cleanTransactionEmail },
      { first: "page2token" }
    );

    const result = await runBackfill(db, client);

    expect(result.nextPageToken).toBe("page2token");
    const [run] = await db.select().from(captureRuns);
    expect(run.backfillPageToken).toBe("page2token");
  });

  test("resuming from a saved pageToken does not reprocess the first page", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", backfillPageToken: "page2token" });
    const client = fakeClient(
      { page2token: [{ id: "m3" }] },
      { m3: cleanTransactionEmail },
      { page2token: undefined }
    );

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(1);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1); // only m3, not m1 from the first page
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- gmailAdapter`
Expected: FAIL with "Cannot find module '../src/adapters/gmailAdapter'".

- [ ] **Step 3: Implement `runBackfill` in `backend/src/adapters/gmailAdapter.ts`**

Read the current `backfillPageToken` from `capture_runs` (single row; insert a default row if none exists). Call `client.listMessages(NAYAPAY_QUERY, currentToken)`, bounded to `options.maxMessagesPerChunk` (default e.g. 50) messages per invocation (slice the returned list if the caller doesn't already paginate small enough — note Gmail's own `maxResults` query param is the real bound in production use; the fake client in tests returns however many it's given). For each message: `client.getMessage(id)`, then `parseNayaPayEmail(...)`. On `confidence: "high"`, look up the category via `categorize(db, vendorNormalized)` (normalize `vendorRaw` the same way `categorizationEngine` does — lowercase+trim) and insert with `reviewStatus: "committed"`; on `confidence: "low"`, insert with `reviewStatus: "pending_review"` and store the `reason` in `provenance`. Every inserted row's `provenance` is `JSON.stringify({ gmailMessageId: id, threadId, parserVersion: 1, ...(reason ? { quarantineReason: reason } : {}) })`. After the chunk, update `capture_runs.backfillPageToken` to the `nextPageToken` returned by `listMessages` (or `null` when backfill is exhausted). Return `{ processed, nextPageToken }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- gmailAdapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/adapters/gmailAdapter.ts
git commit -m "feat: add chunked, resumable Gmail backfill orchestration"
```

---

### Task 4: Gmail OAuth routes (connect / callback / reconnect)

**Files:**
- Create: `backend/src/routes/authGmail.ts` (spec item 22)
- Test: `backend/test/authGmail.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (`gmailClientId`/`gmailClientSecret`, Phase 0-1), `encryptToken` (Phase 0-1), the `gmailCredentials` table (schema, Phase 0-1).
- Produces: a Hono router exported as `authGmailRoutes`, mounted later (Phase 7/8's `index.ts` wiring, out of scope here) at e.g. `/auth/gmail/*`. Exposes `GET /connect` (redirects to Google's OAuth consent screen with `scope=gmail.readonly`), `GET /callback` (exchanges the `code` query param for tokens via Google's token endpoint, encrypts and upserts into `gmail_credentials`), and `GET /reconnect` (alias for `/connect` — same flow, since Google's OAuth consent screen is also how an expired/revoked token gets replaced).

- [ ] **Step 1: Write the failing test**

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { authGmailRoutes } from "../src/routes/authGmail";
import { gmailCredentials } from "../src/db/schema";

describe("authGmail routes", () => {
  test("GET /connect redirects to Google's OAuth consent screen with gmail.readonly scope", async () => {
    const res = await authGmailRoutes.request("/connect", {}, env);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("accounts.google.com");
    expect(location).toContain("scope=" + encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly"));
  });

  test("GET /callback exchanges the code and stores an encrypted token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "real-access-token", refresh_token: "real-refresh-token", expires_in: 3600 }), { status: 200 })
    ));

    const res = await authGmailRoutes.request("/callback?code=fake-auth-code", {}, env);
    expect(res.status).toBe(200);

    const db = drizzle(env.DB);
    const [row] = await db.select().from(gmailCredentials);
    expect(row.encryptedAccessToken).not.toContain("real-access-token"); // must be encrypted, not plaintext
    expect(row.encryptedAccessToken.length).toBeGreaterThan(0);
  });

  test("a callback with no code param fails clearly instead of calling the token endpoint", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await authGmailRoutes.request("/callback", {}, env);

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- authGmail`
Expected: FAIL with "Cannot find module '../src/routes/authGmail'".

- [ ] **Step 3: Implement `backend/src/routes/authGmail.ts`**

Build a Hono app with three routes. `/connect` and `/reconnect` both build and redirect to `https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&response_type=code&scope=https://www.googleapis.com/auth/gmail.readonly&access_type=offline&prompt=consent` using `loadConfig(c.env).gmailClientId`. `/callback` reads `?code=`, 400s with a clear message if absent; otherwise POSTs to `https://oauth2.googleapis.com/token` (`code`, `client_id`, `client_secret`, `grant_type: authorization_code`, `redirect_uri`), encrypts both `access_token` and `refresh_token` via `encryptToken` (Phase 0-1, using `loadConfig(c.env).tokenEncryptionKey`), computes `expiresAt` from `expires_in`, and upserts (single row, keyed to the one user) into `gmail_credentials`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- authGmail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/authGmail.ts backend/test/authGmail.test.ts
git commit -m "feat: add Gmail OAuth connect/callback/reconnect routes"
```

---

## Self-Review Notes

- **Spec coverage**: item 7 (Task 3, backfill portion only — ongoing polling is Phase 5), item 29 (Tasks 2+3's tests), item 22 (Task 4). Item 27 excluded per the Plan-Level Ruling above (belongs to the Phase 3 plan).
- **Review Focus**: malformed email body → Task 2; multi-format amount parsing → Task 2; resumable pageToken → Task 3; scoped-query-only REST client → Task 1; OAuth failure/retry → Task 4.
- **Type consistency**: `ParsedEmailResult`'s shape (Task 2) is consumed verbatim by `runBackfill` (Task 3); `GmailClient`'s method signatures (Task 1) match the fake client implementations used in Tasks 3-4's tests.
- **Proportion check**: four tasks, each a single new file + test, matching the spec's own item-per-file granularity for this phase.
