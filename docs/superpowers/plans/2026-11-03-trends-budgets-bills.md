# Trends, Budgets, Bills (Phase 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the last three capture-adjacent services (budget alerts, bill reminders, trends) and the remaining API routes (statements, capture, trends, budgets, bills), finish the deferred OAuth CSRF fix, and mount the *entire* API surface into the real app — the explicit prerequisite Phase 8 (frontend) is gated on.

**Architecture:** `budgetAlertTrigger.ts` and `billReminderTrigger.ts` are cron-invoked evaluators, same shape as `watchdog.ts`: read state, decide, call the existing `notificationEngine.sendNotification`. Both need a small, debounced "already alerted this period/due-date" state column (new migration) — without it, a budget that stays over its limit or a bill that stays due would renotify every 6 hours forever, the same class of problem Phase 5 deliberately deferred for the Watchdog, but this is new code being built now rather than a patch on shipped code, so it's built in from the start. `trendsService.ts` is a pure query/aggregation function with no cron and no state. The five new route files are thin Hono wrappers over existing or new services, all mounted into `index.ts`'s `app` alongside `authGmail.ts` (whose routes have been built since Phase 2 but never mounted, pending this phase's CSRF fix).

**Tech Stack:** TypeScript on Cloudflare Workers (Hono) + Cloudflare D1 via Drizzle ORM. No new dependencies.

**Spec:** `docs/designs/personal-spending-tracker.md` — Technical Plan → Detailed Implementation Plan items 15-17 (triggers/trends), 20-21, 23-25 (routes); Canonical Transaction model's dedup-exclusion rule ("excluding any transaction with `dedup_resolution: pending`"); Open Questions → "Budget period definition"; Build Phases item 8 ("Phase 7 — Trends, budgets, bills. Items 14-17, 15's and 17's dedup-exclusion logic, 20-21, 23-25") and item 9's note that Phase 8 starts "once the API surface from prior phases is stable."

## Plan-Level Rulings

- **Budget period is calendar-month only for v1** (spec: "Budget period definition" is an open question — "calendar month vs. a rolling window"). `budgets.periodType` is validated at the route layer to accept only `"monthly"`; a different value is rejected with 400. Revisit if a rolling window is ever wanted.
- **Budget alert thresholds are 80% and 100% of the limit**, each fired at most once per calendar month per threshold, via two new nullable columns on `budgets` (`last_alerted_threshold`, `last_alerted_period_start`) — a migration, since this is genuinely new state, not a Phase 5-style retrofit. Crossing back down and re-crossing up again within the same month does not re-alert (same spirit as "stop asking" once resolved); a new month resets both columns' comparison naturally since `last_alerted_period_start` won't match.
- **Bill reminders fire once per due date**, via a new nullable `bills.last_reminder_sent_for_due_date` column (same migration). Once the user updates `next_due_date` to the next cycle (via the CRUD route this phase also builds), the reminder can fire again.
- **`budgets.limit_amount` and `bills.expected_amount` get the same integer-cents `CHECK` constraint `transactions.amount` already has, plus `> 0`** (a budget cap or expected bill amount can never be negative or fractional, unlike a transaction, which can be a negative refund — this is the right table for that stronger constraint, not a weakening of the existing one).
- **Trends aggregate by calendar month**, matching the budget period ruling above, via `GET /trends?month=YYYY-MM` (defaults to the current month if omitted).
- **The dedup-exclusion filter is one shared predicate**: `reviewStatus = "committed" AND deletedAt IS NULL AND dedupResolution != "pending"`, applied identically in `budgetAlertTrigger.ts` and `trendsService.ts`. `manual_missed` rows have `dedupResolution: null`, which already satisfies `!= "pending"` with no special-casing needed.
- **The OAuth `state` parameter (deferred since Phase 2) is a stateless, HMAC-signed, time-boxed token**, not a server-side session: `state = base64url(timestamp) + "." + base64url(HMAC-SHA256(timestamp, TOKEN_ENCRYPTION_KEY))`, verified in `/callback` by recomputing the HMAC and checking the timestamp is within a 10-minute window. This needs no new secret (reuses `TOKEN_ENCRYPTION_KEY`, already high-entropy and already a Worker secret) and no DB/session state for a single-user app with no concurrent OAuth attempts to track.
- **`statements.ts` accepts CSV only**, via `multipart/form-data` with a `file` field — PDF is still gated on Phase 4's unresolved bank-formats question, unchanged by this phase.
- **`capture.ts`'s manual-backfill trigger reuses `index.ts`'s existing token-refresh-aware client-building logic**, extracted into a new shared `services/gmailCredentialStore.ts` module (`getGmailClient(env): Promise<GmailClient | null>`) so the route doesn't duplicate Phase 5's already-reviewed refresh logic, and `index.ts` becomes a consumer of it instead of defining it inline.
- **Budgets and bills CRUD allow real deletion** (`DELETE` removes the row) — unlike `transactions`, these are configuration, not financial records; the "nothing hard-deleted" rule in the spec is scoped to the Canonical Transaction model, not budget/bill config.

## Global Constraints

- Every money field this phase touches (`limitAmount`, `expectedAmount`) is validated as a positive integer (cents) at both the route layer and the DB `CHECK` constraint, matching the existing `transactions.amount` pattern.
- `budgetAlertTrigger`/`billReminderTrigger`/`trendsService` never include a `pending_review` or soft-deleted transaction, and never include a transaction whose `dedup_resolution` is `"pending"`.
- The OAuth `state` fix must not require any new Worker secret or schema change — it is pure function logic over the existing `TOKEN_ENCRYPTION_KEY`.
- Every new route file is mounted into `index.ts`'s real `app` by the end of this phase — no route this phase creates stays unmounted (unlike Phase 6's one exception, which this phase resolves).

## Review Focus

- **A budget that stays over its 100% threshold across multiple 6-hourly evaluation runs within the same month** must notify once, not every run. → test in Task 1.
- **A bill whose `next_due_date` hasn't changed across multiple evaluation runs** must notify once for that due date, not every run. → test in Task 2.
- **A transaction with `dedup_resolution: "pending"`** must be excluded from both a budget's "spent this period" total and a trends aggregation — a disputed, possibly-duplicate amount must never silently inflate either. → test in Task 1 and Task 3.
- **An OAuth callback with a `state` that is missing, tampered with, or older than the 10-minute window** must be rejected (400), not accepted — this is the entire point of the deferred CSRF fix. → test in Task 8.
- **A statement upload with a non-CSV or unparseable file** must respond clearly (400/422), never crash the route or silently import nothing with a success response. → test in Task 6.

---

### Task 1: Budget alert trigger

**Files:**
- Create: `backend/db/migrations/0003_budget_bill_alert_state.sql` (hand-written, mirroring the project's existing migration style — see `0001_backfill_idempotency.sql`)
- Modify: `backend/src/db/schema.ts` (add `lastAlertedThreshold`, `lastAlertedPeriodStart` to `budgets`; add the `CHECK` constraint to `limitAmount`)
- Create: `backend/src/services/budgetAlertTrigger.ts` (spec item 15)
- Test: `backend/test/budgetAlertTrigger.test.ts`

**Interfaces:**
- Consumes: `sendNotification` (`notificationEngine.ts`), the `transactions` and `budgets` tables.
- Produces: `evaluateBudgets(db: DrizzleD1Database, env: Partial<ConfigEnv>): Promise<{ alerted: string[] }>` (returns the categories alerted this run, for the test to assert on). Task 9 (mounting) calls this from the every-6-hours cron slot; no other task consumes it.

- [ ] **Step 1: Write the migration**

Add `last_alerted_threshold text` and `last_alerted_period_start text` columns to `budgets`, and add a `CHECK (limit_amount = CAST(limit_amount AS INTEGER) AND limit_amount > 0)` constraint (SQLite requires recreating the table to add a `CHECK` to an existing column — follow the same table-rebuild pattern `0000_initial.sql`/drizzle-kit itself would generate; regenerate via `drizzle-kit generate` after updating `schema.ts` in Step 2, then hand-verify the output matches this intent, consistent with how Phase 0-1 caught and fixed a drizzle-kit `CHECK`-constraint drift).

- [ ] **Step 2: Update `backend/src/db/schema.ts`**

Add to the `budgets` table definition: `lastAlertedThreshold: text("last_alerted_threshold")`, `lastAlertedPeriodStart: text("last_alerted_period_start")`, and the `limit_amount` `CHECK` (mirroring `transactions`'s `amountIsInteger` check, named e.g. `limitAmountIsPositiveInteger`).

- [ ] **Step 3: Write the failing test**

```typescript
// backend/test/budgetAlertTrigger.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { evaluateBudgets } from "../src/services/budgetAlertTrigger";
import { budgets, transactions } from "../src/db/schema";

const testEnv = { RESEND_API_KEY: "test-resend-key", NOTIFICATION_EMAIL: "user@example.com" };

async function seedTransaction(db: ReturnType<typeof drizzle>, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  await db.insert(transactions).values({
    amount: 10000,
    date: "2026-10-15",
    vendorRaw: "x",
    vendorNormalized: "x",
    category: "Coffee",
    source: "manual_missed",
    provenance: "{}",
    reviewStatus: "committed",
    ...overrides,
  });
}

describe("evaluateBudgets", () => {
  test("alerts once when spending crosses 100% of the monthly limit", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, { amount: 10000 });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv);

    expect(result.alerted).toEqual(["Coffee"]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("does not re-alert on a second run within the same month at the same threshold", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, { amount: 10000 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await evaluateBudgets(db, testEnv);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await evaluateBudgets(db, testEnv);

    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("[Review Focus] excludes a transaction whose dedup_resolution is pending from the spent total", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, { amount: 10000, dedupGroupId: "g1", dedupResolution: "pending" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv);

    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("excludes a soft-deleted transaction from the spent total", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, { amount: 10000, deletedAt: new Date().toISOString() });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv);

    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does not alert below the 80% threshold", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, { amount: 7000 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv);

    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- budgetAlertTrigger`

- [ ] **Step 5: Implement `evaluateBudgets` in `backend/src/services/budgetAlertTrigger.ts`**

For each row in `budgets`: compute the current month's start (`YYYY-MM-01`, from `new Date()`); sum `transactions.amount` where `category` matches, `date` falls within the current month, and the shared dedup-exclusion filter (Global Constraints) holds; compute `percent = spent / limitAmount`; determine `threshold` as `"100"` if `percent >= 1`, `"80"` if `percent >= 0.8`, else `null`. Skip (no alert, no write) if `threshold` is null, or if `threshold === row.lastAlertedThreshold && currentMonthStart === row.lastAlertedPeriodStart`. Otherwise call `sendNotification(env, {subject, body})` naming the category/percent, update the row's `lastAlertedThreshold`/`lastAlertedPeriodStart`, and add the category to the returned `alerted` array.

- [ ] **Step 6: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- budgetAlertTrigger`

- [ ] **Step 7: Commit**

```bash
git add backend/db/migrations/0003_budget_bill_alert_state.sql backend/src/db/schema.ts backend/src/services/budgetAlertTrigger.ts backend/test/budgetAlertTrigger.test.ts
git commit -m "feat: add budget alert trigger with per-month threshold debounce"
```

---

### Task 2: Bill reminder trigger

**Files:**
- Modify: `backend/db/migrations/0003_budget_bill_alert_state.sql` (same migration as Task 1 — add `bills.last_reminder_sent_for_due_date` and the `expected_amount` `CHECK` in the same file, since both are one logical "alert state" migration)
- Modify: `backend/src/db/schema.ts` (add `lastReminderSentForDueDate` to `bills`; add the `CHECK` to `expectedAmount`)
- Create: `backend/src/services/billReminderTrigger.ts` (spec item 16)
- Test: `backend/test/billReminderTrigger.test.ts`

**Interfaces:**
- Consumes: `sendNotification` (`notificationEngine.ts`), the `bills` table.
- Produces: `evaluateBills(db: DrizzleD1Database, env: Partial<ConfigEnv>): Promise<{ reminded: string[] }>` (vendor names reminded this run). Task 9 calls this from the same cron slot as Task 1.

- [ ] **Step 1: Extend the Task 1 migration and schema**

Add `last_reminder_sent_for_due_date text` to `bills`, and `CHECK (expected_amount = CAST(expected_amount AS INTEGER) AND expected_amount > 0)`.

- [ ] **Step 2: Write the failing test**

```typescript
// backend/test/billReminderTrigger.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { evaluateBills } from "../src/services/billReminderTrigger";
import { bills } from "../src/db/schema";

const testEnv = { RESEND_API_KEY: "test-resend-key", NOTIFICATION_EMAIL: "user@example.com" };

function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("evaluateBills", () => {
  test("reminds once for a bill due within the 3-day lookahead window", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: daysFromNow(2) });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBills(db, testEnv);

    expect(result.reminded).toEqual(["Netflix"]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("does not re-remind on a second run for the same due date", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: daysFromNow(2) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await evaluateBills(db, testEnv);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await evaluateBills(db, testEnv);

    expect(result.reminded).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does not remind for a bill due more than 3 days out", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: daysFromNow(10) });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBills(db, testEnv);

    expect(result.reminded).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("reminds again once next_due_date has moved to a new cycle", async () => {
    const db = drizzle(env.DB);
    const [bill] = await db
      .insert(bills)
      .values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: daysFromNow(2) })
      .returning();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await evaluateBills(db, testEnv);

    const { eq } = await import("drizzle-orm");
    await db.update(bills).set({ nextDueDate: daysFromNow(32) }).where(eq(bills.id, bill.id));
    await db.update(bills).set({ nextDueDate: daysFromNow(1) }).where(eq(bills.id, bill.id));

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await evaluateBills(db, testEnv);

    expect(result.reminded).toEqual(["Netflix"]);
  });
});
```

- [ ] **Step 3: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- billReminderTrigger`

- [ ] **Step 4: Implement `evaluateBills` in `backend/src/services/billReminderTrigger.ts`**

For each row in `bills`: compute `daysUntilDue = (Date.parse(nextDueDate) - todayUTC) / 86400000`; skip if outside `[0, 3]` or if `lastReminderSentForDueDate === nextDueDate`. Otherwise call `sendNotification`, update `lastReminderSentForDueDate = nextDueDate`, add `vendor` to `reminded`.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- billReminderTrigger`

- [ ] **Step 6: Commit**

```bash
git add backend/db/migrations/0003_budget_bill_alert_state.sql backend/src/db/schema.ts backend/src/services/billReminderTrigger.ts backend/test/billReminderTrigger.test.ts
git commit -m "feat: add bill reminder trigger with per-due-date debounce"
```

---

### Task 3: Trends service

**Files:**
- Create: `backend/src/services/trendsService.ts` (spec item 17)
- Test: `backend/test/trendsService.test.ts`

**Interfaces:**
- Consumes: the `transactions` table.
- Produces: `getMonthlyTrends(db: DrizzleD1Database, month: string): Promise<{ month: string; totalCents: number; byCategory: { category: string; totalCents: number }[]; hasData: boolean }>`, where `month` is `"YYYY-MM"`. Task 5 (`trends.ts` route) consumes this by name.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/trendsService.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { getMonthlyTrends } from "../src/services/trendsService";
import { transactions } from "../src/db/schema";

async function seed(db: ReturnType<typeof drizzle>, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  await db.insert(transactions).values({
    amount: 5000,
    date: "2026-10-15",
    vendorRaw: "x",
    vendorNormalized: "x",
    category: "Coffee",
    source: "manual_missed",
    provenance: "{}",
    reviewStatus: "committed",
    ...overrides,
  });
}

describe("getMonthlyTrends", () => {
  test("sums committed transactions by category for the given month", async () => {
    const db = drizzle(env.DB);
    await seed(db, { amount: 5000, category: "Coffee" });
    await seed(db, { amount: 3000, category: "Coffee" });
    await seed(db, { amount: 2000, category: "Groceries" });

    const result = await getMonthlyTrends(db, "2026-10");

    expect(result.totalCents).toBe(10000);
    expect(result.hasData).toBe(true);
    expect(result.byCategory).toEqual(
      expect.arrayContaining([{ category: "Coffee", totalCents: 8000 }, { category: "Groceries", totalCents: 2000 }])
    );
  });

  test("excludes a transaction outside the requested month", async () => {
    const db = drizzle(env.DB);
    await seed(db, { date: "2026-09-30" });

    const result = await getMonthlyTrends(db, "2026-10");

    expect(result.hasData).toBe(false);
    expect(result.totalCents).toBe(0);
  });

  test("excludes pending_review, soft-deleted, and dedup-pending transactions", async () => {
    const db = drizzle(env.DB);
    await seed(db, { reviewStatus: "pending_review" });
    await seed(db, { deletedAt: new Date().toISOString() });
    await seed(db, { dedupGroupId: "g1", dedupResolution: "pending" });

    const result = await getMonthlyTrends(db, "2026-10");

    expect(result.hasData).toBe(false);
  });

  test("a month with zero matching transactions reports hasData: false instead of a misleadingly empty chart", async () => {
    const db = drizzle(env.DB);

    const result = await getMonthlyTrends(db, "2026-10");

    expect(result.hasData).toBe(false);
    expect(result.byCategory).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- trendsService`

- [ ] **Step 3: Implement `getMonthlyTrends` in `backend/src/services/trendsService.ts`**

Select transactions where `date` starts with `month` (string comparison on the `YYYY-MM-DD` column against `YYYY-MM` is safe here), plus the shared dedup-exclusion filter from Task 1/Plan-Level Rulings. Group in JS (not SQL, consistent with `dedupEngine.ts`'s established approach at this data scale) into a `Map<category, totalCents>`, sum for `totalCents`, and set `hasData` to whether any row matched.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- trendsService`

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/trendsService.ts backend/test/trendsService.test.ts
git commit -m "feat: add monthly trends aggregation service"
```

---

### Task 4: Budgets and bills CRUD routes

**Files:**
- Create: `backend/src/routes/budgets.ts` (spec item 24)
- Create: `backend/src/routes/bills.ts` (spec item 25)
- Test: `backend/test/budgets.test.ts`
- Test: `backend/test/bills.test.ts`

**Interfaces:**
- Consumes: the `budgets`/`bills` tables.
- Produces: `budgetsRoutes`, `billsRoutes` (exported Hono instances). Task 9 mounts both by name.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/test/budgets.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { budgetsRoutes } from "../src/routes/budgets";
import { budgets } from "../src/db/schema";

describe("budgets routes", () => {
  test("POST / creates a monthly budget", async () => {
    const res = await budgetsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee", limitAmount: 10000, periodType: "monthly" }) },
      env
    );
    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    expect(await db.select().from(budgets)).toHaveLength(1);
  });

  test("POST / rejects a non-monthly periodType", async () => {
    const res = await budgetsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee", limitAmount: 10000, periodType: "weekly" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("POST / rejects a zero or negative limitAmount", async () => {
    const res = await budgetsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee", limitAmount: 0, periodType: "monthly" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("GET / lists budgets", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    const res = await budgetsRoutes.request("/", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });

  test("PATCH /:id updates a budget's limit", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" }).returning();
    const res = await budgetsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limitAmount: 20000 }) },
      env
    );
    expect(res.status).toBe(200);
    const [updated] = await db.select().from(budgets).where(eq(budgets.id, row.id));
    expect(updated.limitAmount).toBe(20000);
  });

  test("DELETE /:id removes a budget", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" }).returning();
    const res = await budgetsRoutes.request(`/${row.id}`, { method: "DELETE" }, env);
    expect(res.status).toBe(204);
    expect(await db.select().from(budgets)).toHaveLength(0);
  });

  test("PATCH and DELETE on a nonexistent id return 404", async () => {
    const patchRes = await budgetsRoutes.request(
      "/999",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limitAmount: 5000 }) },
      env
    );
    const deleteRes = await budgetsRoutes.request("/999", { method: "DELETE" }, env);
    expect(patchRes.status).toBe(404);
    expect(deleteRes.status).toBe(404);
  });
});
```

```typescript
// backend/test/bills.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { billsRoutes } from "../src/routes/bills";
import { bills } from "../src/db/schema";

describe("bills routes", () => {
  test("POST / creates a bill", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }) },
      env
    );
    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    expect(await db.select().from(bills)).toHaveLength(1);
  });

  test("POST / rejects a zero or negative expectedAmount", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: -1, expectedInterval: "monthly", nextDueDate: "2026-11-15" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("POST / rejects a malformed nextDueDate", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "not-a-date" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("GET / lists bills", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" });
    const res = await billsRoutes.request("/", {}, env);
    expect(await res.json()).toHaveLength(1);
  });

  test("PATCH /:id updates nextDueDate", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    const res = await billsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nextDueDate: "2026-12-15" }) },
      env
    );
    expect(res.status).toBe(200);
    const [updated] = await db.select().from(bills).where(eq(bills.id, row.id));
    expect(updated.nextDueDate).toBe("2026-12-15");
  });

  test("DELETE /:id removes a bill", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    const res = await billsRoutes.request(`/${row.id}`, { method: "DELETE" }, env);
    expect(res.status).toBe(204);
    expect(await db.select().from(bills)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run both tests, confirm they fail**

Run: `npm --prefix backend run test -- budgets bills`

- [ ] **Step 3: Implement `budgetsRoutes` in `backend/src/routes/budgets.ts` and `billsRoutes` in `backend/src/routes/bills.ts`**

Both follow `transactions.ts`'s established try/catch-JSON, validate-then-write pattern (Phase 6). `budgets.ts`: `GET /`, `POST /` (require `category` non-empty, `limitAmount` a positive integer, `periodType === "monthly"`), `PATCH /:id` (same per-field validation for any field present; 404 if missing), `DELETE /:id` (204; 404 if missing). `bills.ts`: same shape, validating `vendor` non-empty, `expectedAmount` a positive integer, `nextDueDate` a valid ISO calendar date (reuse `manualAdapter.ts`'s round-trip-through-`Date` validation approach locally — this file doesn't import from `manualAdapter.ts`, matching the project's existing pattern of small validation helpers living next to their one call site), `expectedInterval` non-empty (free text, no fixed set per the spec's silence on exact values).

- [ ] **Step 4: Run both tests, confirm they pass**

Run: `npm --prefix backend run test -- budgets bills`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/budgets.ts backend/src/routes/bills.ts backend/test/budgets.test.ts backend/test/bills.test.ts
git commit -m "feat: add budgets and bills CRUD routes"
```

---

### Task 5: Trends route

**Files:**
- Create: `backend/src/routes/trends.ts` (spec item 23)
- Test: `backend/test/trends.test.ts`

**Interfaces:**
- Consumes: `getMonthlyTrends` (Task 3).
- Produces: `trendsRoutes` (exported Hono instance). Task 9 mounts it.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/trends.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { trendsRoutes } from "../src/routes/trends";
import { transactions } from "../src/db/schema";

describe("trends routes", () => {
  test("GET /?month=2026-10 returns that month's aggregation", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({
      amount: 5000, date: "2026-10-15", vendorRaw: "x", vendorNormalized: "x", category: "Coffee",
      source: "manual_missed", provenance: "{}", reviewStatus: "committed",
    });

    const res = await trendsRoutes.request("/?month=2026-10", {}, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalCents: number; hasData: boolean };
    expect(body.totalCents).toBe(5000);
    expect(body.hasData).toBe(true);
  });

  test("GET / with no month param defaults to the current month", async () => {
    const res = await trendsRoutes.request("/", {}, env);
    expect(res.status).toBe(200);
  });

  test("GET /?month=bad-format returns 400", async () => {
    const res = await trendsRoutes.request("/?month=bad-format", {}, env);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- trends`

- [ ] **Step 3: Implement `trendsRoutes` in `backend/src/routes/trends.ts`**

`GET /` reads `?month=`, validating `/^\d{4}-\d{2}$/` when present (400 otherwise), defaulting to `new Date().toISOString().slice(0, 7)` when absent, calls `getMonthlyTrends`, returns `c.json(result)`.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- trends`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/trends.ts backend/test/trends.test.ts
git commit -m "feat: add trends query route"
```

---

### Task 6: Statements upload route

**Files:**
- Create: `backend/src/routes/statements.ts` (spec item 20)
- Test: `backend/test/statements.test.ts`

**Interfaces:**
- Consumes: `importStatementCsv` (`statementAdapter.ts`, Phase 3).
- Produces: `statementsRoutes` (exported Hono instance). Task 9 mounts it.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/statements.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { statementsRoutes } from "../src/routes/statements";
import { transactions } from "../src/db/schema";

describe("statements routes", () => {
  test("POST / with a CSV file imports its rows", async () => {
    const csv = "Date,Description,Amount\n2026-10-27,Starbucks,12.50\n";
    const form = new FormData();
    form.set("file", new File([csv], "statement.csv", { type: "text/csv" }));

    const res = await statementsRoutes.request("/", { method: "POST", body: form }, env);

    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  test("POST / with no file returns 400", async () => {
    const res = await statementsRoutes.request("/", { method: "POST", body: new FormData() }, env);
    expect(res.status).toBe(400);
  });

  test("POST / with an unparseable CSV (no recognizable columns) still returns 201, with every row quarantined", async () => {
    const csv = "TxnDate,Memo,Balance\n2026-10-27,something,100\n";
    const form = new FormData();
    form.set("file", new File([csv], "weird.csv", { type: "text/csv" }));

    const res = await statementsRoutes.request("/", { method: "POST", body: form }, env);

    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    const [row] = await db.select().from(transactions);
    expect(row.reviewStatus).toBe("pending_review");
  });
});
```

(This exercises `statementAdapter.ts`'s existing, already-tested quarantine behavior through the route rather than re-testing the parser itself — the route's own job is just accepting the upload and generating a `fileRef`.)

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- statements`

- [ ] **Step 3: Implement `statementsRoutes` in `backend/src/routes/statements.ts`**

`POST /` parses `multipart/form-data` via `c.req.parseBody()`, reads the `file` field (400 if missing or not a `File`), reads its text, generates `fileRef` as `` `${file.name}-${Date.now()}` ``, calls `importStatementCsv(db, text, fileRef)`, returns `c.json(result, 201)`.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- statements`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/statements.ts backend/test/statements.test.ts
git commit -m "feat: add statement upload route"
```

---

### Task 7: Shared Gmail client helper + capture route

**Files:**
- Create: `backend/src/services/gmailCredentialStore.ts`
- Modify: `backend/src/index.ts` (replace its inline `buildGmailClientFromStoredCredentials` with this new module)
- Create: `backend/src/routes/capture.ts` (spec item 21)
- Test: `backend/test/gmailCredentialStore.test.ts`
- Test: `backend/test/capture.test.ts`
- Modify: `backend/test/index.test.ts` (no behavior change expected — existing capture-cron/token-refresh tests must keep passing against the refactored call site)

**Interfaces:**
- Consumes: `createGmailClient`, `GmailClient` (`gmailClient.ts`), `refreshAccessToken` (`gmailTokenRefresh.ts`), `decryptToken`/`encryptToken` (`security.ts`), `loadConfig` (`config.ts`), the `gmailCredentials` table.
- Produces: `getGmailClient(db: DrizzleD1Database, env: Partial<ConfigEnv>): Promise<GmailClient | null>` (same behavior Phase 5's `buildGmailClientFromStoredCredentials` had: returns `null` if nothing connected, refreshes an expiring token and persists it, otherwise decrypts and returns a client). Task 9 wires this into `index.ts`'s cron dispatch in place of the old inline function; `capture.ts` consumes it directly for the manual-backfill endpoint.

- [ ] **Step 1: Write the failing test for the extracted helper**

```typescript
// backend/test/gmailCredentialStore.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { getGmailClient } from "../src/services/gmailCredentialStore";
import { gmailCredentials } from "../src/db/schema";
import { encryptToken, decryptToken } from "../src/security";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key", TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
};

describe("getGmailClient", () => {
  test("returns null when nothing is connected", async () => {
    const db = drizzle(env.DB);
    expect(await getGmailClient(db, testEnv)).toBeNull();
  });

  test("returns a client built from the stored, non-expired access token", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("real-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const client = await getGmailClient(db, testEnv);

    expect(client).not.toBeNull();
  });

  test("refreshes and persists an expiring token before returning the client", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("stale-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), { status: 200 }))
    );

    await getGmailClient(db, testEnv);

    const [row] = await db.select().from(gmailCredentials);
    expect(await decryptToken(row.encryptedAccessToken, testEnv.TOKEN_ENCRYPTION_KEY)).toBe("fresh-token");
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- gmailCredentialStore`

- [ ] **Step 3: Implement `getGmailClient` in `backend/src/services/gmailCredentialStore.ts`**

Move the body of `index.ts`'s existing `buildGmailClientFromStoredCredentials` (the `credentials` lookup, the `TOKEN_EXPIRY_SKEW_MS` check, the refresh-and-persist branch, the plain-decrypt branch) here verbatim, taking `db` as a parameter instead of building it from `env.DB` internally (so both `index.ts` and `capture.ts` can pass an already-open `db`).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- gmailCredentialStore`

- [ ] **Step 5: Update `index.ts` to consume the extracted helper**

Delete `buildGmailClientFromStoredCredentials` and `TOKEN_EXPIRY_SKEW_MS` from `index.ts`; replace every call site (`dispatchCapture`, the `queue()` handler) with `getGmailClient(drizzle(env.DB), env)`. Remove now-unused imports (`createGmailClient`, `refreshAccessToken`, `decryptToken`/`encryptToken` if nothing else in the file still uses them).

- [ ] **Step 6: Run the full suite, confirm every existing `index.test.ts` test still passes unchanged**

Run: `npm --prefix backend run test -- index`
Expected: all tests pass (this step proves the extraction preserved Phase 5's reviewed behavior exactly — the test file itself needs no changes).

- [ ] **Step 7: Write the failing test for the capture route**

```typescript
// backend/test/capture.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { captureRoutes } from "../src/routes/capture";
import { captureRuns, gmailCredentials } from "../src/db/schema";
import { encryptToken } from "../src/security";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key", TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
};

describe("capture routes", () => {
  test("GET /health returns the current capture_runs row", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", lastSuccessfulRun: new Date().toISOString() });

    const res = await captureRoutes.request("/health", {}, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { runStatus: string };
    expect(body.runStatus).toBe("success");
  });

  test("GET /health with no capture_runs row yet returns a healthy 'never run' shape, not a 404 or crash", async () => {
    const res = await captureRoutes.request("/health", {}, testEnv);
    expect(res.status).toBe(200);
  });

  test("POST /backfill with no Gmail account connected returns 409, not a crash", async () => {
    const res = await captureRoutes.request("/backfill", { method: "POST" }, testEnv);
    expect(res.status).toBe(409);
  });

  test("POST /backfill with a connected account runs a backfill chunk", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("real-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 })));

    const res = await captureRoutes.request("/backfill", { method: "POST" }, testEnv);

    expect(res.status).toBe(200);
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
  });
});
```

- [ ] **Step 8: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- capture`

- [ ] **Step 9: Implement `captureRoutes` in `backend/src/routes/capture.ts`**

`GET /health` selects the single `captureRuns` row; if none exists, returns a synthetic `{ runStatus: "job_did_not_run", lastAttemptedRun: null, lastSuccessfulRun: null, errorType: null }` shape rather than a 404 (a brand-new, never-run installation is a normal state the frontend's Capture Health page must render, not an error). `POST /backfill` calls `getGmailClient`; 409 (not connected — a conflict with the precondition "an account must be connected first", not a 404/400) if `null`; otherwise calls `runBackfill(db, client)` (`gmailAdapter.ts`, Phase 2) directly (not through `runCaptureScheduler`, since this is a manual, synchronous, single-chunk trigger with no retry/queue semantics) and returns `c.json({processed, nextPageToken})`.

- [ ] **Step 10: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- capture`

- [ ] **Step 11: Commit**

```bash
git add backend/src/services/gmailCredentialStore.ts backend/src/index.ts backend/src/routes/capture.ts backend/test/gmailCredentialStore.test.ts backend/test/capture.test.ts
git commit -m "refactor: extract Gmail credential/refresh logic; add manual capture route"
```

---

### Task 8: OAuth CSRF `state` parameter fix

**Files:**
- Modify: `backend/src/routes/authGmail.ts`
- Modify: `backend/test/authGmail.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (for `tokenEncryptionKey`, reused as the HMAC key — no new secret).
- Produces: no new exports; `authGmailRoutes`'s existing shape is unchanged. Task 9 mounts it (the only task that was waiting on this fix).

- [ ] **Step 1: Write the failing tests (add to `backend/test/authGmail.test.ts`)**

```typescript
test("GET /connect includes a state parameter in the consent URL", async () => {
  const res = await authGmailRoutes.request("/connect", {}, testEnv);
  const location = new URL(res.headers.get("Location")!);
  expect(location.searchParams.get("state")).toBeTruthy();
});

test("GET /callback with no state parameter is rejected, not silently accepted", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const res = await authGmailRoutes.request("/callback?code=fake-code", {}, testEnv);
  expect(res.status).toBe(400);
});

test("GET /callback with a tampered state parameter is rejected", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const connectRes = await authGmailRoutes.request("/connect", {}, testEnv);
  const state = new URL(connectRes.headers.get("Location")!).searchParams.get("state")!;
  const tampered = state.slice(0, -1) + (state.endsWith("A") ? "B" : "A");

  const res = await authGmailRoutes.request(`/callback?code=fake-code&state=${tampered}`, {}, testEnv);

  expect(res.status).toBe(400);
});

test("GET /callback with a valid, fresh state succeeds", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 }))
  );
  const connectRes = await authGmailRoutes.request("/connect", {}, testEnv);
  const state = new URL(connectRes.headers.get("Location")!).searchParams.get("state")!;

  const res = await authGmailRoutes.request(`/callback?code=fake-code&state=${encodeURIComponent(state)}`, {}, testEnv);

  expect(res.status).toBe(200);
});

test("GET /callback with an expired (>10 minutes old) state is rejected", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const { signState } = await import("../src/routes/authGmail");
  const staleState = await signState(Date.now() - 11 * 60 * 1000, testEnv.TOKEN_ENCRYPTION_KEY);

  const res = await authGmailRoutes.request(`/callback?code=fake-code&state=${encodeURIComponent(staleState)}`, {}, testEnv);

  expect(res.status).toBe(400);
});
```

(Every *existing* test in this file that calls `/callback` without a `state` param needs updating to generate and pass one first, the same way the new "valid, fresh state" test does above — otherwise they now fail the new check instead of testing what they originally tested. Thread the real `/connect`-issued state through each.)

- [ ] **Step 2: Run the test, confirm the new ones fail and note which existing ones now fail too**

Run: `npm --prefix backend run test -- authGmail`

- [ ] **Step 3: Implement the signed `state` in `backend/src/routes/authGmail.ts`**

Export `signState(timestampMs: number, key: string): Promise<string>` (HMAC-SHA256 over the timestamp string via Web Crypto, formatted `` `${base64url(timestamp)}.${base64url(hmac)}` ``) and a local `verifyState(state: string, key: string): boolean` (recompute, compare, and check `Date.now() - timestamp <= 10 * 60 * 1000`). `consentUrl`/`redirectToConsent` add `state: await signState(Date.now(), config.tokenEncryptionKey)` to the query string. `/callback` reads `c.req.query("state")`, returns 400 immediately if missing or `verifyState` fails, before doing anything else (including the existing missing-`code` check — order either way is fine, both are 400s, but `state` must be checked before the token exchange is ever attempted).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- authGmail`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/authGmail.ts backend/test/authGmail.test.ts
git commit -m "fix: add signed, time-boxed state parameter to the OAuth flow (CSRF)"
```

---

### Task 9: Mount everything, wire the budget/bill cron slot

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/wrangler.toml` (comment only — the every-6-hours cron already exists from Phase 5)
- Modify: `backend/test/index.test.ts`

**Interfaces:**
- Consumes: `transactionsRoutes`/`missedTransactionsRoutes` (Phase 6, already mounted — unchanged), `budgetsRoutes`/`billsRoutes` (Task 4), `trendsRoutes` (Task 5), `statementsRoutes` (Task 6), `captureRoutes` (Task 7), `authGmailRoutes` (existing, Task 8's fix), `evaluateBudgets` (Task 1), `evaluateBills` (Task 2).
- Produces: nothing new for later tasks — this is the end of Phase 7, and per the spec's Phase 8 note, the API surface is now stable.

- [ ] **Step 1: Write the failing tests (extend `backend/test/index.test.ts`'s "app routing" describe block, and add budget/bill cron coverage to "scheduled handler")**

```typescript
test("the real app serves /budgets, /bills, /trends, /statements, /capture/health, and /auth/gmail/connect", async () => {
  expect((await worker.fetch(new Request("https://example.com/budgets"), testEnv)).status).toBe(200);
  expect((await worker.fetch(new Request("https://example.com/bills"), testEnv)).status).toBe(200);
  expect((await worker.fetch(new Request("https://example.com/trends"), testEnv)).status).toBe(200);
  expect((await worker.fetch(new Request("https://example.com/capture/health"), testEnv)).status).toBe(200);
  expect((await worker.fetch(new Request("https://example.com/auth/gmail/connect"), testEnv)).status).toBe(302);
});

test("the every-6-hours cron now dispatches to evaluateBudgets/evaluateBills instead of being a no-op", async () => {
  const db = drizzle(env.DB);
  const { budgets } = await import("../src/db/schema");
  await db.insert(budgets).values({ category: "Coffee", limitAmount: 100, periodType: "monthly" });
  await db.insert(transactions).values({
    amount: 100, date: new Date().toISOString().slice(0, 10), vendorRaw: "x", vendorNormalized: "x",
    category: "Coffee", source: "manual_missed", provenance: "{}", reviewStatus: "committed",
  });
  const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);

  const controller = { cron: "0 */6 * * *", scheduledTime: Date.now() } as ScheduledController;
  const ctx = createExecutionContext();
  await worker.scheduled!(controller, testEnv, ctx);
  await waitOnExecutionContext(ctx);

  expect(fetchSpy).toHaveBeenCalledOnce(); // the budget alert
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- index`

- [ ] **Step 3: Mount every remaining route and wire the cron slot in `backend/src/index.ts`**

Add `app.route("/budgets", budgetsRoutes)`, `app.route("/bills", billsRoutes)`, `app.route("/trends", trendsRoutes)`, `app.route("/statements", statementsRoutes)`, `app.route("/capture", captureRoutes)`, `app.route("/auth/gmail", authGmailRoutes)`. Replace the `scheduled()` handler's `else` branch (currently a documented no-op comment) with `await evaluateBudgets(drizzle(env.DB), env); await evaluateBills(drizzle(env.DB), env);`, inside the same try/catch the other two branches already use.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- index`

- [ ] **Step 5: Update the stale `wrangler.toml` comment**

The comment above the budget/bill cron currently says it's "still an intentional no-op until Phase 7" — update it to describe what it now dispatches to.

- [ ] **Step 6: Run the full suite and the build**

Run: `npm --prefix backend run test` — expect every test (Phases 1-7) passing.
Run: `npm --prefix backend run build` — expect a clean `tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/index.ts backend/wrangler.toml backend/test/index.test.ts
git commit -m "feat: mount the full API surface and wire the budget/bill cron"
```
