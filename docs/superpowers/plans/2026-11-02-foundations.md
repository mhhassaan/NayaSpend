# Foundations (Phase 0 + Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the backend project skeleton, validate that Cloudflare D1 can express the query shapes the dedup/trends engines will need, and build the canonical schema, config, security, and categorization modules — with no capture channel wired in yet.

**Architecture:** TypeScript Cloudflare Worker (Hono) with Cloudflare D1 via Drizzle ORM. This plan covers Build Phases 0–1 of the design doc only: project scaffolding, the D1 feasibility spike, the canonical `transactions`/`capture_runs`/`gmail_credentials`/`category_rules`/`budgets`/`bills` schema, config/security scaffolding, and the categorization engine. No adapters, routes, or frontend — those are later plans.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Cloudflare D1, Drizzle ORM (`drizzle-orm`, `drizzle-kit`), Vitest (`vitest`, `@cloudflare/vitest-pool-workers`), ESLint, Web Crypto API (AES-256-GCM).

**Spec:** `docs/designs/personal-spending-tracker.md` (sections: Technical Plan → Canonical Transaction model; Detailed Implementation Plan, items 1–6 and 13; Build Phases 0–1; Risks & Mitigations → "D1 query feasibility"). Executors should read both this plan and the spec.

## Global Constraints

- Stack is fixed: TypeScript on Cloudflare Workers (Hono) + Cloudflare D1 (Drizzle ORM). No substituting Postgres/Hyperdrive unless the Phase 0 spike (Task 1) fails and that decision is escalated back to the human partner — do not silently fall back.
- `amount` is stored as an **integer in minor units** (e.g. cents) — never a float — to avoid rounding issues.
- `category` is a free-text column (no FK/enum) — the category taxonomy is an open question in the spec; do not hard-code an enum.
- `source` is one of exactly: `gmail_email`, `statement_import`, `manual_missed`.
- `review_status` is one of exactly: `pending_review`, `committed`.
- `dedup_resolution` is one of exactly: `pending`, `kept`, `discarded`, `confirmed_distinct` (nullable).
- `provenance` is a JSON-as-text column; shape varies by `source` (do not model it as separate typed columns).
- The Gmail OAuth token must be encrypted at rest using the Web Crypto API, AES-256-GCM, with a random 12-byte IV per encryption and a key imported from a base64-encoded Worker secret.
- `wrangler.toml` declares three Cron Triggers (hourly Capture Scheduler, hourly-offset Watchdog, every-6-hours budget/bill evaluation) dispatching through one exported `scheduled` handler keyed on `event.cron` — even though that handler (`backend/src/index.ts`) is built in a later phase, so the triggers are declared now but unreachable until then.
- Nothing is hard-deleted — `deleted_at` is a soft-delete marker on `transactions`.

## Review Focus

- **Malformed/missing Worker secret.** `config.ts` reading an absent or malformed Gmail client secret or encryption key should fail fast with a clear error, not proceed with `undefined` and fail confusingly later. → test in Task 2.
- **Tampered ciphertext.** Decrypting a ciphertext that was altered after encryption (bit-flip, truncation) must fail loudly, not return garbage plaintext silently. → test in Task 3 (mirrors spec item 33).
- **Vendor-name casing/whitespace variance.** `categorizationEngine` looking up a vendor name that differs only in case or surrounding whitespace from the stored rule should still match — a naive exact-string lookup would silently miscategorize. → test in Task 5.
- **Amount provided as a non-integer.** Any schema-level insert of a non-integer `amount` (e.g. a float like `12.5` meant as dollars, not cents) must be rejected or caught by a test, since the spec's whole rationale for integer minor units is avoiding this exact mistake. → test in Task 4.
- **D1 query ceiling under realistic shape.** The dedup engine's planned fuzzy/date-proximity matching and the trends service's category+time aggregation must be shown to actually run against D1's SQLite dialect before the schema is relied on — not assumed. → the Phase 0 spike itself (Task 1) is this test.

---

### Task 1: Project scaffolding + D1 feasibility spike

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/wrangler.toml`
- Create: `backend/drizzle.config.ts`
- Create: `backend/.dev.vars.example`
- Create: `backend/test/d1Spike.test.ts`
- Create: `backend/src/index.ts` (placeholder only — see Step 5)

**Interfaces:**
- Produces: a Worker project that installs (`npm install`), type-checks (`tsc --noEmit`), and runs `vitest` against `@cloudflare/vitest-pool-workers` with a local D1 binding named `DB`. Later tasks assume this `DB` binding name and this test runner are already working.

- [ ] **Step 1: Write `backend/package.json` and `backend/tsconfig.json`**

`package.json` dependencies: `hono`, `drizzle-orm`, `drizzle-kit` (dev), `vitest` (dev), `@cloudflare/vitest-pool-workers` (dev), `@cloudflare/workers-types` (dev), `eslint` (dev), `typescript` (dev), `wrangler` (dev). Scripts: `"build": "tsc --noEmit"`, `"test": "vitest run"`, `"lint": "eslint ."`. `tsconfig.json`: `target`/`lib` `ES2022`, `module` `ESNext`, `types: ["@cloudflare/workers-types"]`, `strict: true`.

- [ ] **Step 2: Write `backend/wrangler.toml`**

Declare the Worker (`main = "src/index.ts"`, `compatibility_date` = today's date), a D1 database binding named `DB`, and three `[[triggers.crons]]`/`[triggers]` cron entries: hourly (`0 * * * *`) for the Capture Scheduler, hourly offset by 30 minutes (`30 * * * *`) for the Watchdog, and every 6 hours (`0 */6 * * *`) for budget/bill evaluation. Add a comment noting all three currently point at a placeholder `scheduled` export (Step 5) and will be wired to real logic in later phases.

- [ ] **Step 3: Write `backend/.dev.vars.example`**

List the required local secrets with placeholder (non-real) values and one comment line each: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `RESEND_API_KEY`, `TOKEN_ENCRYPTION_KEY` (base64-encoded).

- [ ] **Step 4: Write `backend/drizzle.config.ts`**

Point it at `backend/src/db/schema.ts` (created in Task 4) as the schema source and `backend/migrations` as the output directory, dialect `sqlite`, driver `d1-http` or local D1 per `drizzle-kit`'s Cloudflare D1 guidance.

- [ ] **Step 5: Write a placeholder `backend/src/index.ts`**

Export a minimal Hono `app` with no routes yet and a `fetch` handler, plus a `scheduled` handler that does nothing but log `event.cron` — just enough for `wrangler.toml`'s triggers to reference a real export and for `tsc --noEmit` to pass. Real dispatch logic replaces this in the Phase 7/8 plan (spec item 26).

- [ ] **Step 6: Write the D1 feasibility spike test in `backend/test/d1Spike.test.ts`**

Using `@cloudflare/vitest-pool-workers`'s local D1 binding (`env.DB`), without importing the real schema (none exists yet): create a throwaway table with columns shaped like the planned `transactions` table (`date TEXT`, `amount INTEGER`, `vendor_normalized TEXT`), insert ~5 synthetic rows, and run:
  1. a date-range query (`WHERE date BETWEEN ? AND ?`) — proxy for dedup's date-proximity check,
  2. a `GROUP BY` category+month aggregation — proxy for the trends service,
  3. a `LIKE`-based substring match on `vendor_normalized` — proxy for the coarse half of dedup's vendor fuzzy-match (D1/SQLite has no native Jaro-Winkler; confirm `string-similarity`'s algorithm runs in-Worker JS over rows fetched via a cheap pre-filter like this `LIKE`, not in SQL).
  Assert each query returns the expected rows without error.

- [ ] **Step 7: Run the spike and record the outcome**

Run: `cd backend && npm install && npm run test -- d1Spike`
Expected: PASS. If any query errors or is unsupported by D1's SQLite dialect, STOP and report back — per Risks & Mitigations in the spec, this is the trigger to escalate a Postgres/Hyperdrive fallback (Alternative L) rather than silently proceeding.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/wrangler.toml backend/drizzle.config.ts backend/.dev.vars.example backend/src/index.ts backend/test/d1Spike.test.ts
git commit -m "chore: scaffold backend worker project and validate D1 query shapes"
```

---

### Task 2: Config module

**Files:**
- Create: `backend/src/config.ts`
- Test: `backend/test/config.test.ts`

**Interfaces:**
- Consumes: Worker `Env` bindings/secrets declared in Task 1 (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `RESEND_API_KEY`, `TOKEN_ENCRYPTION_KEY`).
- Produces: `loadConfig(env: Env): AppConfig` where `AppConfig = { gmailClientId: string; gmailClientSecret: string; resendApiKey: string; tokenEncryptionKey: string }`. Task 3 (security module) consumes `AppConfig.tokenEncryptionKey`.

- [ ] **Step 1: Write the failing test**

```typescript
import { loadConfig } from "../src/config";

test("loadConfig reads all four required secrets", () => {
  const env = { GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", RESEND_API_KEY: "c", TOKEN_ENCRYPTION_KEY: "ZGQ=" } as any;
  const config = loadConfig(env);
  expect(config).toEqual({ gmailClientId: "a", gmailClientSecret: "b", resendApiKey: "c", tokenEncryptionKey: "ZGQ=" });
});

test("loadConfig throws a clear error when a required secret is missing", () => {
  const env = { GMAIL_CLIENT_ID: "a" } as any;
  expect(() => loadConfig(env)).toThrow(/GMAIL_CLIENT_SECRET/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- config`
Expected: FAIL with "loadConfig not defined" (or module not found).

- [ ] **Step 3: Implement `loadConfig(env: Env): AppConfig` in `backend/src/config.ts`**

Check each of the four keys is present and non-empty; throw `Error` naming the specific missing key (not a generic "config invalid" message) on the first one found missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config.ts backend/test/config.test.ts
git commit -m "feat: add config module for worker secrets"
```

---

### Task 3: Security module (token encryption)

**Files:**
- Create: `backend/src/security.ts`
- Test: `backend/test/security.test.ts` (spec item 33)

**Interfaces:**
- Consumes: `AppConfig.tokenEncryptionKey` (base64 string) from Task 2.
- Produces: `encryptToken(plaintext: string, key: string): Promise<string>` and `decryptToken(ciphertext: string, key: string): Promise<string>`, where `ciphertext` is a single string encoding IV + ciphertext (e.g. base64 of `iv || tag || data`, implementer's choice of exact packing). Later Gmail-adapter/credentials-storage work (a later plan) consumes these two functions by name and signature.

- [ ] **Step 1: Write the failing test**

```typescript
import { encryptToken, decryptToken } from "../src/security";

const key = "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1leGFjdGx5ISE="; // test-only base64 key

test("encrypt then decrypt round-trips the original plaintext", async () => {
  const ciphertext = await encryptToken("super-secret-oauth-token", key);
  expect(await decryptToken(ciphertext, key)).toBe("super-secret-oauth-token");
});

test("two encryptions of the same plaintext produce different ciphertexts (random IV)", async () => {
  const a = await encryptToken("same-value", key);
  const b = await encryptToken("same-value", key);
  expect(a).not.toBe(b);
});

test("a tampered ciphertext fails to decrypt", async () => {
  const ciphertext = await encryptToken("super-secret-oauth-token", key);
  const tampered = ciphertext.slice(0, -4) + "abcd";
  await expect(decryptToken(tampered, key)).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- security`
Expected: FAIL with "encryptToken not defined".

- [ ] **Step 3: Implement `encryptToken`/`decryptToken` in `backend/src/security.ts`**

Use `crypto.subtle` (Web Crypto, available in Workers): import the base64-decoded key as an `AES-GCM` `CryptoKey`, generate a random 12-byte IV per call via `crypto.getRandomValues`, encrypt/decrypt with `crypto.subtle.encrypt`/`decrypt` (`AES-GCM` includes the auth tag, so a tampered ciphertext naturally fails `decrypt` without extra bookkeeping). Pack IV + ciphertext into one base64 string for storage; unpack symmetrically in `decryptToken`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- security`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/security.ts backend/test/security.test.ts
git commit -m "feat: add AES-256-GCM token encryption module"
```

---

### Task 4: Canonical D1 schema + initial migration

**Files:**
- Create: `backend/src/db/schema.ts` (spec item 5)
- Create: `backend/migrations/0000_initial.sql` (spec item 6, generated via `drizzle-kit`)
- Test: `backend/test/schema.test.ts`

**Interfaces:**
- Consumes: the `DB` D1 binding established in Task 1.
- Produces: Drizzle table objects `transactions`, `captureRuns`, `gmailCredentials`, `categoryRules`, `budgets`, `bills`, exported by name from `backend/src/db/schema.ts`. Every later task that reads/writes D1 (adapters, services, routes — later plans) imports these exact table names.

- [ ] **Step 1: Write the failing test**

```typescript
import { drizzle } from "drizzle-orm/d1";
import { transactions } from "../src/db/schema";

test("inserting a transaction with integer amount round-trips correctly", async (env) => {
  const db = drizzle(env.DB);
  await db.insert(transactions).values({
    amount: 1250, // $12.50 in cents
    date: "2026-11-01",
    vendorRaw: "NAYAPAY RAW",
    vendorNormalized: "nayapay",
    category: "Uncategorized",
    source: "manual_missed",
    provenance: "{}",
    reviewStatus: "committed",
  });
  const rows = await db.select().from(transactions);
  expect(rows[0].amount).toBe(1250);
  expect(Number.isInteger(rows[0].amount)).toBe(true);
});

test("amount column rejects a non-integer value", async (env) => {
  const db = drizzle(env.DB);
  await expect(
    db.insert(transactions).values({
      amount: 12.5 as any,
      date: "2026-11-01",
      vendorRaw: "x",
      vendorNormalized: "x",
      category: "Uncategorized",
      source: "manual_missed",
      provenance: "{}",
      reviewStatus: "committed",
    })
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- schema`
Expected: FAIL with "Cannot find module '../src/db/schema'".

- [ ] **Step 3: Implement `backend/src/db/schema.ts`**

Define, using `drizzle-orm/sqlite-core`:
  - `transactions`: `id` (integer, PK, autoincrement), `amount` (integer, not null), `date` (text, not null), `vendorRaw`/`vendorNormalized` (text, not null), `category` (text, not null, default `"Uncategorized"`), `source` (text, not null, one of the three Global Constraints values), `provenance` (text, not null, JSON string), `reviewStatus` (text, not null, one of `pending_review`/`committed`), `dedupGroupId` (text, nullable), `dedupResolution` (text, nullable, one of the four values), `deletedAt` (text, nullable).
  - `captureRuns`: `id` (integer PK), `lastAttemptedRun`/`lastSuccessfulRun` (text, nullable), `runStatus` (text), `errorType` (text, nullable), `backfillPageToken` (text, nullable), `pollingHistoryId` (text, nullable).
  - `gmailCredentials`: `id` (integer PK), `encryptedAccessToken` (text), `encryptedRefreshToken` (text), `expiresAt` (text).
  - `categoryRules`: `id` (integer PK), `vendorNormalized` (text, unique, not null), `category` (text, not null).
  - `budgets`: `id` (integer PK), `category` (text, not null), `limitAmount` (integer, not null), `periodType` (text, not null).
  - `bills`: `id` (integer PK), `vendor` (text, not null), `expectedAmount` (integer, not null), `expectedInterval` (text, not null), `nextDueDate` (text, not null).
  SQLite has no native integer-only CHECK by type (it's dynamically typed), so additionally add a `CHECK (amount = CAST(amount AS INTEGER))` constraint on `transactions.amount` so the second test's non-integer insert is rejected at the DB level, not just by TypeScript types.

- [ ] **Step 4: Generate the migration**

Run: `cd backend && npx drizzle-kit generate`
Expected: produces `backend/migrations/0000_initial.sql` reflecting the schema above. Review the generated SQL once to confirm the `CHECK` constraint from Step 3 is present; if `drizzle-kit` doesn't emit custom CHECK constraints, add it by hand to the generated file.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm run test -- schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.ts backend/migrations/0000_initial.sql backend/test/schema.test.ts
git commit -m "feat: add canonical D1 schema and initial migration"
```

---

### Task 5: Categorization engine

**Files:**
- Create: `backend/src/services/categorizationEngine.ts` (spec item 13)
- Test: `backend/test/categorizationEngine.test.ts` (spec item 28)

**Interfaces:**
- Consumes: the `categoryRules` table from Task 4, the `DB` binding from Task 1.
- Produces: `categorize(db: DrizzleD1Database, vendorNormalized: string): Promise<string>` and `correctCategory(db: DrizzleD1Database, vendorNormalized: string, category: string): Promise<void>`. Later adapter/route work (later plans) calls `categorize` when ingesting a transaction and `correctCategory` when the user edits a transaction's category.

- [ ] **Step 1: Write the failing test**

```typescript
import { drizzle } from "drizzle-orm/d1";
import { categoryRules } from "../src/db/schema";
import { categorize, correctCategory } from "../src/services/categorizationEngine";

test("categorize returns the matched rule's category", async (env) => {
  const db = drizzle(env.DB);
  await db.insert(categoryRules).values({ vendorNormalized: "starbucks", category: "Coffee" });
  expect(await categorize(db, "starbucks")).toBe("Coffee");
});

test("categorize falls back to Uncategorized for an unknown vendor", async (env) => {
  const db = drizzle(env.DB);
  expect(await categorize(db, "some-new-vendor")).toBe("Uncategorized");
});

test("categorize is case/whitespace insensitive on the stored normalized vendor", async (env) => {
  const db = drizzle(env.DB);
  await db.insert(categoryRules).values({ vendorNormalized: "starbucks", category: "Coffee" });
  expect(await categorize(db, "  Starbucks ")).toBe("Coffee");
});

test("correctCategory upserts the rule so the next lookup uses the correction", async (env) => {
  const db = drizzle(env.DB);
  await correctCategory(db, "newvendor", "Groceries");
  expect(await categorize(db, "newvendor")).toBe("Groceries");

  await correctCategory(db, "newvendor", "Dining");
  expect(await categorize(db, "newvendor")).toBe("Dining");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- categorizationEngine`
Expected: FAIL with "Cannot find module '../src/services/categorizationEngine'".

- [ ] **Step 3: Implement `categorize`/`correctCategory` in `backend/src/services/categorizationEngine.ts`**

`categorize`: normalize the input (`.trim().toLowerCase()`) before querying `categoryRules.vendorNormalized`; return the matched `category` or the literal string `"Uncategorized"` if no row matches. `correctCategory`: normalize the same way, then upsert (`ON CONFLICT (vendorNormalized) DO UPDATE SET category = ...`, or an explicit select-then-update/insert) into `categoryRules`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- categorizationEngine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/categorizationEngine.ts backend/test/categorizationEngine.test.ts
git commit -m "feat: add categorization engine with per-vendor correction"
```

---

## Self-Review Notes

- **Spec coverage**: Items 1–6 and 13 (Phase 1) are each covered by a task; the Phase 0 D1 spike (Risks & Mitigations) is Task 1 Step 6. Item 46 (`.dev.vars.example`) is folded into Task 1 since it documents the same secrets Task 1 scaffolds. Items 27–33 other than 33 (security test) belong to later phases (Gmail/statement adapters) and are intentionally out of scope here.
- **Review Focus**: all five lines above have an owning test (malformed secret → Task 2; tampered ciphertext → Task 3; vendor casing → Task 5; non-integer amount → Task 4; D1 query ceiling → Task 1).
- **Type consistency**: `AppConfig.tokenEncryptionKey` (Task 2) is the exact string type `encryptToken`/`decryptToken` (Task 3) take as `key`; `categoryRules`/`transactions` field names in Task 5's test match the camelCase names defined in Task 4's schema.
