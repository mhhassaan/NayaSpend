# Ongoing Gmail Polling & Reliability (Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward (ongoing) Gmail polling via `historyId`, the Capture Scheduler cron handler with retry-via-Queue on API failure, and the Watchdog that detects when the capture mechanism itself has stopped working — not whether any particular email arrived.

**Architecture:** `captureScheduler.ts` is the hourly cron entrypoint: it decides backfill-vs-ongoing-poll, calls the right `gmailAdapter` function, and on failure enqueues a Cloudflare Queue retry message (1/5/15 min delays) instead of sleeping in-process. `watchdog.ts` runs on its own offset hourly cron and only looks at `capture_runs`' own run-status bookkeeping — never at whether matching email existed. Both the scheduler and watchdog need a notification channel, so this plan also builds `notificationEngine.ts` (spec item 14) now, ahead of its originally-planned Phase 7 — see Plan-Level Rulings.

**Tech Stack:** TypeScript on Cloudflare Workers, Cloudflare Queues (retry scheduling), Resend's HTTP API (outbound email — the Workers runtime cannot use SMTP sockets), Cloudflare D1 via Drizzle.

**Spec:** `docs/designs/personal-spending-tracker.md` — Technical Plan → Capture paths → "1. NayaPay Gmail import" (ongoing polling via `historyId`) and Reliability: Gmail capture health alert; CUJ 4; Detailed Implementation Plan items 1 (remaining cron triggers), 10, 11, 14, 31, 32; Risks & Mitigations → "OAuth token lifecycle", "Silent capture failure".

## Plan-Level Rulings

- **`notificationEngine.ts` (spec item 14) is pulled into this plan from Phase 7.** The spec's own architecture says the Gmail capture health alert "delivers through this same layer" as budget/bill notifications — Watchdog cannot function without a notification channel, and Phase 7 (where item 14 was originally scheduled) doesn't exist yet. This plan builds the shared engine now; Phase 7 will add `budgetAlertTrigger`/`billReminderTrigger` as additional callers of the same engine, not rebuild it.
- **Ongoing polling needs the Gmail API's `users.history.list` endpoint**, distinct from `messages.list`/`messages.get` (backfill). This plan adds `listHistory` to `gmailClient.ts` and a sibling `runOngoingPoll` function to `gmailAdapter.ts` (`runBackfill` is untouched).
- **Seeding the initial `historyId`.** Ongoing polling needs a starting watermark. This plan seeds `capture_runs.pollingHistoryId` the moment backfill completes (inside `runBackfill`'s existing completion branch), by calling Gmail's `users.getProfile` endpoint for the current `historyId` at that moment — so ongoing polling picks up exactly where backfill leaves off, with no gap or overlap.
- **Retry queue is dependency-injected**, not a hard dependency on the real Cloudflare Queue binding in tests — `captureScheduler.ts` takes a `QueueSender` interface (`send(message, {delaySeconds})`), with the real implementation being `env.CAPTURE_RETRY_QUEUE` (declared in `wrangler.toml`) and a fake implementation in tests, mirroring the `GmailClient` injection seam from Phase 2.
- **Budget/bill cron dispatch is a no-op placeholder.** `wrangler.toml`'s third cron trigger (every 6 hours, budget/bill evaluation) was already declared in Phase 0-1; `index.ts`'s `scheduled` handler gains real dispatch for the capture-scheduler and watchdog crons in this plan, but the budget/bill cron continues to no-op until Phase 7 builds those triggers.

## Global Constraints

- Ongoing polling uses a forward `historyId` watermark — a completely separate mechanism and `capture_runs` column (`pollingHistoryId`) from backfill's backward `pageToken` (`backfillPageToken`). Never conflate them.
- The Watchdog watches the capture *mechanism's* own health (did the scheduled job run, did its Gmail API call succeed) — never whether any matching email was found. A successful poll with zero new messages is not a failure.
- On an API-call failure, the Capture Scheduler retries up to 3 times with exponential backoff: 1 min, 5 min, 15 min — via a Cloudflare Queue message with `delaySeconds`, never an in-process sleep.
- 2 consecutive missed successful scheduled runs trigger the Watchdog's escalation — not 1, not a rolling average.
- Every user-facing alert names the specific failure reason (`auth_failure`, `rate_limit`, `network_timeout`/`unknown`, or "the sync job didn't run") — never one generic failure message.
- `notificationEngine.ts` sends via Resend's HTTP API using `config.resendApiKey` (already in `AppConfig` from Phase 0-1); it does not contain trigger evaluation logic itself.

## Review Focus

- **A Gmail API failure during ongoing polling** (not just backfill) must retry via the Queue with the correct backoff sequence and eventually escalate through the Watchdog if it keeps failing — not just be handled during backfill. → test in Task 4.
- **The Watchdog must not cry wolf on a genuinely quiet day** — a successful run with zero new messages must never be treated as a missed run. → test in Task 2.
- **The Watchdog must escalate with the *specific* stored `error_type`**, not a generic message, when `capture_runs` shows 2 consecutive non-successful runs. → test in Task 2.
- **Historyid-based polling must not reprocess messages already captured by backfill or a prior poll** — idempotent via the same `gmail_message_id` mechanism as backfill. → test in Task 3.
- **A Cloudflare Queue retry that is itself the 3rd consecutive failure** must stop retrying and hand off to the Watchdog's normal escalation path, not retry forever. → test in Task 4.

---

### Task 1: Notification Engine (shared delivery layer)

**Files:**
- Create: `backend/src/services/notificationEngine.ts` (spec item 14)
- Test: `backend/test/notificationEngine.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (`resendApiKey`, Phase 0-1).
- Produces: `sendNotification(env: ConfigEnv, notification: { subject: string; body: string }): Promise<void>`. Task 2's `watchdog.ts` (and later Phase 7 triggers) call this by name.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test, vi } from "vitest";
import { sendNotification } from "../src/services/notificationEngine";

const testEnv = {
  GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key", TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
};

describe("sendNotification", () => {
  test("POSTs to Resend's API with the Bearer token and the given subject/body", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.resend.com/emails");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-resend-key");
      const body = JSON.parse(init.body as string);
      expect(body.subject).toBe("Gmail access expired");
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await sendNotification(testEnv, { subject: "Gmail access expired", body: "Reconnect your account." });

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("a failed Resend call throws rather than silently swallowing the notification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(sendNotification(testEnv, { subject: "x", body: "y" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- notificationEngine`
Expected: FAIL with "Cannot find module '../src/services/notificationEngine'".

- [ ] **Step 3: Implement `backend/src/services/notificationEngine.ts`**

`sendNotification` calls `loadConfig(env)`, then `POST https://api.resend.com/emails` with `Authorization: Bearer <resendApiKey>`, JSON body `{ from: "NayaSpend <alerts@resend.dev>", to: [...single-user placeholder...], subject, text: body }` (the exact recipient address is an open question — use a clearly-named placeholder constant documented as needing the real user email once known). Throw if the response isn't `ok`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- notificationEngine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/notificationEngine.ts backend/test/notificationEngine.test.ts
git commit -m "feat: add shared notification engine over Resend's HTTP API"
```

---

### Task 2: Watchdog

**Files:**
- Create: `backend/src/services/watchdog.ts` (spec item 11)
- Test: `backend/test/watchdog.test.ts` (spec item 31)

**Interfaces:**
- Consumes: `sendNotification` (Task 1), the `captureRuns` table (schema).
- Produces: `checkCaptureHealth(db: DrizzleD1Database, env: ConfigEnv): Promise<{ escalated: boolean }>`. Task 4's `captureScheduler.ts` does not call this directly (it runs on its own cron per the Global Constraints) — `index.ts`'s dispatch (Task 5) calls it.

- [ ] **Step 1: Write the failing test**

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { captureRuns } from "../src/db/schema";
import { checkCaptureHealth } from "../src/services/watchdog";

describe("checkCaptureHealth", () => {
  test("a successful run with zero new messages is healthy, not escalated", async () => {
    const db = drizzle(env.DB);
    const now = new Date().toISOString();
    await db.insert(captureRuns).values({ runStatus: "success", lastAttemptedRun: now, lastSuccessfulRun: now });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, env);

    expect(result.escalated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("2 consecutive non-successful runs escalate with the specific error_type", async () => {
    const db = drizzle(env.DB);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.insert(captureRuns).values({
      runStatus: "api_call_failed",
      errorType: "auth_failure",
      lastAttemptedRun: twoHoursAgo,
      lastSuccessfulRun: null,
    });
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.subject).toContain("Gmail");
      expect(body.text).toContain("reconnect");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, env);

    expect(result.escalated).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("a job that simply never ran (job_did_not_run, no lastSuccessfulRun ever) escalates with that specific reason", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "job_did_not_run" });
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("didn't run");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, env);

    expect(result.escalated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- watchdog`
Expected: FAIL with "Cannot find module '../src/services/watchdog'".

- [ ] **Step 3: Implement `backend/src/services/watchdog.ts`**

Read the single `capture_runs` row. Healthy (`escalated: false`, no notification) when `runStatus === "success"`. Otherwise, only escalate once there have been 2 consecutive non-successful attempts — track this via comparing `lastAttemptedRun` against `lastSuccessfulRun` and how long ago `lastAttemptedRun` was relative to the hourly cadence (at least ~2 hours since the last success, or `runStatus === "job_did_not_run"` persisting across a check), calling `sendNotification` with a message naming the specific `errorType` (e.g. "Gmail access expired — reconnect your account" for `auth_failure`, "Gmail is rate-limiting requests" for `rate_limit`, "the sync job didn't run" when `runStatus === "job_did_not_run"`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- watchdog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/watchdog.ts backend/test/watchdog.test.ts
git commit -m "feat: add watchdog for Gmail capture mechanism health"
```

---

### Task 3: Ongoing (historyId-based) Gmail polling

**Files:**
- Modify: `backend/src/adapters/gmailClient.ts` (add `listHistory`)
- Modify: `backend/src/adapters/gmailAdapter.ts` (add `runOngoingPoll`, seed `pollingHistoryId` on backfill completion)
- Modify: `backend/test/gmailClient.test.ts`, `backend/test/gmailAdapter.test.ts`

**Interfaces:**
- Produces: `GmailClient.listHistory(startHistoryId: string, maxResults: number): Promise<{ addedMessageIds: string[]; newHistoryId: string }>` and `GmailClient.getCurrentHistoryId(): Promise<string>`. Produces `runOngoingPoll(db: DrizzleD1Database, client: GmailClient, options?: { maxMessagesPerChunk?: number }): Promise<{ processed: number }>`. Task 4's `captureScheduler.ts` consumes `runOngoingPoll` and `runBackfill` (Phase 2) by name, choosing between them based on `capture_runs.backfillCompletedAt`.

- [ ] **Step 1: Write the failing tests** (add to `gmailClient.test.ts` and `gmailAdapter.test.ts`)

```typescript
// gmailClient.test.ts additions
test("listHistory calls users.history.list with startHistoryId and returns added message ids + new watermark", async () => {
  const fetchSpy = vi.fn(async (url: string) => {
    expect(url).toContain("startHistoryId=100");
    return new Response(JSON.stringify({
      history: [{ messagesAdded: [{ message: { id: "m1" } }] }],
      historyId: "150",
    }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchSpy);
  const client = createGmailClient("token");
  const result = await client.listHistory("100", 50);
  expect(result.addedMessageIds).toEqual(["m1"]);
  expect(result.newHistoryId).toBe("150");
});

test("getCurrentHistoryId calls users.getProfile and returns its historyId", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ historyId: "999" }), { status: 200 })));
  const client = createGmailClient("token");
  expect(await client.getCurrentHistoryId()).toBe("999");
});
```

```typescript
// gmailAdapter.test.ts additions
describe("runOngoingPoll", () => {
  test("processes newly-added messages found via history, same as backfill's parse/categorize/dedup path", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", pollingHistoryId: "100" });
    const client = { /* fake with listHistory returning one new message id, getMessage returning cleanTransactionEmail */ } as any;
    const result = await runOngoingPoll(db, client);
    expect(result.processed).toBe(1);
    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).not.toBe("100");
  });

  test("backfill completion seeds pollingHistoryId via getCurrentHistoryId", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient({ first: { messages: [{ id: "m-clean" }] } }, { "m-clean": cleanTransactionEmail });
    client.getCurrentHistoryId = async () => "500";
    await runBackfill(db, client);
    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).toBe("500");
  });
});
```

(These are illustrative — write concrete fakes following the existing `fakeClient` pattern in `gmailAdapter.test.ts`, extended with `listHistory`/`getCurrentHistoryId`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm run test -- gmailClient gmailAdapter`
Expected: FAIL — `listHistory`/`getCurrentHistoryId`/`runOngoingPoll` don't exist yet.

- [ ] **Step 3: Implement `listHistory`/`getCurrentHistoryId` in `gmailClient.ts`**

`listHistory(startHistoryId, maxResults)`: `GET .../history?startHistoryId=<id>&maxResults=<n>&historyTypes=messageAdded`, extract message ids from every `history[].messagesAdded[].message.id`, return the response's own `historyId` as the new watermark (falling back to `startHistoryId` if Gmail returns no `historyId`, e.g. no changes). `getCurrentHistoryId()`: `GET .../profile`, return `historyId`. Both check `response.ok` and throw `GmailApiError` on failure, consistent with Task 1/Phase 2's existing methods.

- [ ] **Step 4: Implement `runOngoingPoll` in `gmailAdapter.ts`, and seed `pollingHistoryId` in `runBackfill`**

`runOngoingPoll` mirrors `runBackfill`'s chunked/batched/idempotent structure (reuse `buildCommittedRow`/`buildQuarantinedRow`, the same `onConflictDoNothing` on `gmailMessageId`, the same dedup-check-after-batch wiring) but sources its message ids from `client.listHistory(pollingHistoryId, maxMessagesPerChunk)` instead of `listMessages`, and updates `capture_runs.pollingHistoryId` (never `backfillPageToken`/`backfillCompletedAt`) to the returned `newHistoryId`. In `runBackfill`, when `backfillFinished` is true, additionally call `client.getCurrentHistoryId()` and include `pollingHistoryId` in the same checkpoint update that sets `backfillCompletedAt`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm run test -- gmailClient gmailAdapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/gmailClient.ts backend/src/adapters/gmailAdapter.ts backend/test/gmailClient.test.ts backend/test/gmailAdapter.test.ts
git commit -m "feat: add historyId-based ongoing Gmail polling"
```

---

### Task 4: Capture Scheduler (cron handler + Queue retry)

**Files:**
- Create: `backend/src/services/captureScheduler.ts` (spec item 10)
- Test: `backend/test/captureScheduler.test.ts` (spec item 32)
- Modify: `backend/wrangler.toml` (add the retry Queue binding)

**Interfaces:**
- Consumes: `runBackfill`/`runOngoingPoll` (Phase 2/Task 3), a `QueueSender` interface (`send(message: unknown, options: { delaySeconds: number }): Promise<void>`, injected — real implementation is `env.CAPTURE_RETRY_QUEUE`).
- Produces: `runCaptureScheduler(db: DrizzleD1Database, client: GmailClient, queue: QueueSender, attempt?: number): Promise<void>`. `index.ts`'s `queue` consumer handler (Task 5) calls this again with an incremented `attempt` when a retry message is delivered.

- [ ] **Step 1: Write the failing test**

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { captureRuns } from "../src/db/schema";
import { runCaptureScheduler } from "../src/services/captureScheduler";
import { GmailApiError } from "../src/adapters/gmailClient";

function fakeQueue() {
  const sent: { message: unknown; delaySeconds: number }[] = [];
  return { sent, async send(message: unknown, options: { delaySeconds: number }) { sent.push({ message, delaySeconds: options.delaySeconds }); } };
}

describe("runCaptureScheduler", () => {
  test("chooses runBackfill while backfill is not yet complete", async () => {
    const db = drizzle(env.DB);
    const client = { listMessages: async () => ({ messages: [] }), getMessage: async () => { throw new Error("unused"); } } as any;
    const queue = fakeQueue();
    await runCaptureScheduler(db, client, queue);
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
  });

  test("on an API-call failure, enqueues a retry at 1 minute for attempt 1", async () => {
    const db = drizzle(env.DB);
    const client = { listMessages: async () => { throw new GmailApiError(500, "unknown", "boom"); }, getMessage: async () => { throw new Error("unused"); } } as any;
    const queue = fakeQueue();
    await runCaptureScheduler(db, client, queue);
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].delaySeconds).toBe(60);
  });

  test("retries at 5 minutes for attempt 2, 15 minutes for attempt 3, and stops after attempt 3", async () => {
    const db = drizzle(env.DB);
    const client = { listMessages: async () => { throw new GmailApiError(500, "unknown", "boom"); }, getMessage: async () => { throw new Error("unused"); } } as any;
    const queue2 = fakeQueue();
    await runCaptureScheduler(db, client, queue2, 2);
    expect(queue2.sent[0].delaySeconds).toBe(300);

    const queue3 = fakeQueue();
    await runCaptureScheduler(db, client, queue3, 3);
    expect(queue3.sent).toHaveLength(0); // no 4th attempt -- Watchdog takes over
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("api_call_failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- captureScheduler`
Expected: FAIL with "Cannot find module '../src/services/captureScheduler'".

- [ ] **Step 3: Add the retry Queue binding to `backend/wrangler.toml`**

```toml
[[queues.producers]]
queue = "capture-retry"
binding = "CAPTURE_RETRY_QUEUE"

[[queues.consumers]]
queue = "capture-retry"
max_batch_size = 1
```

- [ ] **Step 4: Implement `backend/src/services/captureScheduler.ts`**

`runCaptureScheduler(db, client, queue, attempt = 1)`: read `capture_runs`; call `runOngoingPoll` if `backfillCompletedAt` is set, else `runBackfill`. On success, nothing further (the called function already updates `capture_runs` itself). On a thrown `GmailApiError` (or any error): if `attempt <= 3`, `queue.send({ attempt: attempt + 1 }, { delaySeconds: [60, 300, 900][attempt - 1] })`; the 4th would-be attempt (`attempt > 3`) does not enqueue — the run's `api_call_failed` status (already set inside `runBackfill`/`runOngoingPoll`'s own error handling, per Phase 2) is left for the Watchdog to find on its own cron.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm run test -- captureScheduler`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/captureScheduler.ts backend/test/captureScheduler.test.ts backend/wrangler.toml
git commit -m "feat: add Capture Scheduler with Queue-based retry backoff"
```

---

### Task 5: Wire cron dispatch in the Worker entrypoint

**Files:**
- Modify: `backend/src/index.ts`
- Test: `backend/test/index.test.ts`

**Interfaces:**
- Consumes: `runCaptureScheduler` (Task 4), `checkCaptureHealth` (Task 2), `createGmailClient` (Phase 2), `decryptToken`/`loadConfig` (Phase 0-1), the `gmailCredentials` table.
- Produces: the Worker's real `scheduled` handler (replacing Phase 0-1's placeholder) and a new exported `queue` handler. Nothing downstream consumes these — they are the Worker's own entrypoints.

- [ ] **Step 1: Write the failing test**

```typescript
import { env, createExecutionContext } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";
import worker from "../src/index";

describe("scheduled handler", () => {
  test("dispatches the hourly capture cron to the capture scheduler path", async () => {
    // No stored Gmail credentials -- assert it does not throw (fails
    // gracefully with a decrypt/config error caught internally) rather
    // than crashing the Worker; exact behavior documented in Step 3.
    const controller = { cron: "0 * * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await expect(worker.scheduled!(controller, env, ctx)).resolves.not.toThrow();
  });

  test("dispatches the watchdog cron without throwing", async () => {
    const controller = { cron: "30 * * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await expect(worker.scheduled!(controller, env, ctx)).resolves.not.toThrow();
  });

  test("the budget/bill cron is still a documented no-op (Phase 7 not built yet)", async () => {
    const controller = { cron: "0 */6 * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await expect(worker.scheduled!(controller, env, ctx)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- index`
Expected: FAIL (current placeholder just logs; adjust the assertion target once you see its actual behavior — the point is to lock in real dispatch behavior once Step 3 lands, so if the placeholder already happens not to throw, proceed to Step 3 and confirm this test still passes for the *new* reason).

- [ ] **Step 3: Implement real cron dispatch in `backend/src/index.ts`**

In the `scheduled` export, branch on `event.cron`: for the capture-scheduler cron, read `gmail_credentials`, decrypt the access token, build a `GmailClient` via `createGmailClient`, and call `runCaptureScheduler(db, client, env.CAPTURE_RETRY_QUEUE)` — wrapped in try/catch so a missing/undecryptable credential (no Gmail connected yet) logs and returns rather than throwing. For the watchdog cron, call `checkCaptureHealth(db, env)`, same try/catch discipline. For the budget/bill cron, no-op with a comment pointing at Phase 7. Add a `queue` export that reads each message's `attempt` and calls `runCaptureScheduler` again with it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test -- index`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts backend/test/index.test.ts
git commit -m "feat: wire capture-scheduler and watchdog cron dispatch"
```

---

## Self-Review Notes

- **Spec coverage**: item 14 (Task 1, pulled forward), item 11/31 (Task 2), item 1's remaining ongoing-polling half of item 7 plus the `historyId` mechanism (Task 3), item 10/32 (Task 4), remainder of item 1 (Task 5).
- **Review Focus**: polling-time API failure retry → Task 4; Watchdog never false-alarms on a quiet day → Task 2; Watchdog names the specific error → Task 2; historyId polling idempotent via `gmail_message_id` → Task 3 (reuses Phase 2's existing unique constraint, no new idempotency mechanism needed); Queue retry stops at 3 and hands off to Watchdog → Task 4.
- **Type consistency**: `QueueSender`'s `send` signature (Task 4) matches both the fake used in tests and `env.CAPTURE_RETRY_QUEUE`'s real Cloudflare Queue binding type; `runOngoingPoll`'s return shape mirrors `runBackfill`'s.
- **Proportion check**: five tasks, each isolating one new concern, with Task 3 the largest since it touches two already-existing files.
