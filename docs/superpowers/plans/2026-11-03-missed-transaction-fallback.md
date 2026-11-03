# Missed-Transaction Fallback (Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the third, manual capture path (CUJ 3) for anything neither Gmail nor a bank statement ever sees — plus the first transaction-management API surface: listing, viewing, correcting a category, and resolving a dedup candidate pair.

**Architecture:** `manualAdapter.ts` is a single function that writes directly into the canonical `transactions` table as `committed`, auto-categorized, with no provenance and no dedup check — mirroring the "none beyond user-entered fields" simplicity the spec calls for. `transactions.ts` is a small Hono sub-app covering the four read/correct/resolve actions the spec's item 18 names; all three new route files are mounted into `index.ts`'s `app` (unlike `authGmail.ts`, which stays unmounted pending its deferred CSRF fix — these routes carry no equivalent public-callback risk).

**Tech Stack:** TypeScript on Cloudflare Workers (Hono) + Cloudflare D1 via Drizzle ORM. No new dependencies.

**Spec:** `docs/designs/personal-spending-tracker.md` — Technical Plan → Capture paths → "3. Log a missed transaction"; De-duplication (the `manual_missed` exclusion rule); Canonical Transaction model (`source`, `provenance`, `dedup_resolution` values); CUJ 3; Detailed Implementation Plan items 9, 18, 19; Build Phases item 7 ("Phase 6 — Missed-transaction fallback. Items 9, 18-19").

## Plan-Level Rulings

- **Manual-missed category is always auto-assigned, never user-supplied at logging time.** The spec's CUJ 3 says the transaction "is categorized automatically," and the UX for this form is an explicit, not-yet-designed open question — so this plan doesn't invent a category field for it. A user who disagrees with the auto-assigned category corrects it afterward via the same `PATCH /transactions/:id/category` route every other source uses (item 18), keeping exactly one way to change a category.
- **`resolve-dedup`'s three resolution values are a complementary pair, not three independent per-row writes.** The spec names the three values (`kept`/`discarded`/`confirmed_distinct`) and says the write touches "the transaction and its paired `dedup_group_id` counterpart," but doesn't spell out which value lands on which side of the pair. This plan resolves it as: `kept` on the target row writes `discarded` + `deleted_at` (soft-delete) on its counterpart; `discarded` on the target row writes `kept` on its counterpart (and soft-deletes the target itself); `confirmed_distinct` writes the same value to both rows, neither deleted — "these turned out not to be duplicates after all, keep both, stop asking."
- **`transactions.ts` and `missedTransactions.ts` are mounted into `index.ts`'s `app` in this phase.** `authGmail.ts`'s routes remain unmounted (Phase 2's documented, deliberate deferral of its CSRF `state` parameter) — but that risk is specific to a public OAuth callback URL. These routes have no equivalent exposure, and Phase 8's frontend needs a real, reachable API surface to build against.
- **No new query parameters beyond `GET /transactions?reviewStatus=`.** The spec's only other list-related open question (quarantine-resolution UX) is about the *resolution action*, not the ability to list `pending_review` rows, which the frontend will need regardless of how that question resolves later. Nothing else is spec'd or needed yet (YAGNI).

## Global Constraints

- `manual_missed` rows are never passed to `runDedupCheck` — no code path in this phase calls it for a manual entry.
- `manual_missed` provenance is `"{}"` ("none beyond the user-entered fields," per the spec) — no idempotency key, by design.
- Every write in this phase goes through the existing `categorizationEngine.categorize`/`correctCategory` and `normalize` functions (Phase 0-1) — no parallel categorization logic.
- Nothing is ever hard-deleted; a "discarded" dedup resolution sets `deleted_at`, never removes the row.
- `amount` stored for a manual entry must be a positive integer (minor units/cents), matching the canonical schema's existing `CHECK` constraint and the spirit of "a real expense."

## Review Focus

- **A missed-transaction amount that is zero, negative, or non-integer** (e.g. `0`, `-500`, `12.5`) must be rejected with a clear 400, never silently stored as a nonsense transaction. → test in Task 1.
- **A missed-transaction date that isn't a valid ISO `YYYY-MM-DD`** (malformed, empty, or missing) must be rejected with a clear 400, never stored as `"Invalid Date"` or silently defaulted to today. → test in Task 1.
- **`resolve-dedup` called on a transaction with no `dedup_group_id`** (never matched, or already resolved and later re-fetched) must fail clearly (400), never crash or silently no-op. → test in Task 3.
- **A `discarded` dedup resolution must soft-delete, never hard-delete** — the row must still exist afterward with `deleted_at` set, per the canonical model's "nothing is hard-deleted" rule. → test in Task 3.
- **`GET /transactions` must exclude soft-deleted rows by default**, so a `discarded` duplicate doesn't reappear in a normal list view the moment it's resolved. → test in Task 2.

---

### Task 1: Manual missed-transaction adapter + route

**Files:**
- Create: `backend/src/adapters/manualAdapter.ts` (spec item 9)
- Create: `backend/src/routes/missedTransactions.ts` (spec item 19)
- Test: `backend/test/manualAdapter.test.ts`
- Test: `backend/test/missedTransactions.test.ts`

**Interfaces:**
- Consumes: `categorize`, `normalize` (`categorizationEngine.ts`), the `transactions` table (`db/schema.ts`).
- Produces: `logMissedTransaction(db: DrizzleD1Database, input: { vendorRaw: string; amountCents: number; date: string }): Promise<{ id: number; category: string }>`, throwing a plain `Error` with a human-readable message on invalid input (caught by the route and turned into a 400). Task 4 (mounting) consumes `missedTransactionsRoutes` (the exported Hono instance) by name.

- [ ] **Step 1: Write the failing adapter test**

```typescript
// backend/test/manualAdapter.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { logMissedTransaction } from "../src/adapters/manualAdapter";
import { transactions } from "../src/db/schema";

describe("logMissedTransaction", () => {
  test("writes a committed, auto-categorized manual_missed row with no provenance beyond the input", async () => {
    const db = drizzle(env.DB);
    const result = await logMissedTransaction(db, { vendorRaw: "Corner Store", amountCents: 50000, date: "2026-10-27" });

    const [row] = await db.select().from(transactions);
    expect(row.source).toBe("manual_missed");
    expect(row.reviewStatus).toBe("committed");
    expect(row.amount).toBe(50000);
    expect(row.date).toBe("2026-10-27");
    expect(row.vendorNormalized).toBe("corner store");
    expect(row.provenance).toBe("{}");
    expect(row.dedupGroupId).toBeNull();
    expect(result.id).toBe(row.id);
    expect(result.category).toBe(row.category);
  });

  test("rejects a zero or negative amount", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 0, date: "2026-10-27" })).rejects.toThrow();
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: -500, date: "2026-10-27" })).rejects.toThrow();
  });

  test("rejects a non-integer amount", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100.5, date: "2026-10-27" })).rejects.toThrow();
  });

  test("rejects a malformed date", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100, date: "10/27/2026" })).rejects.toThrow();
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100, date: "" })).rejects.toThrow();
  });

  test("rejects an empty vendor", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "   ", amountCents: 100, date: "2026-10-27" })).rejects.toThrow();
  });

  test("picks up an existing category_rules entry for the vendor, same as every other source", async () => {
    const db = drizzle(env.DB);
    const { correctCategory } = await import("../src/services/categorizationEngine");
    await correctCategory(db, "corner store", "Groceries");

    const result = await logMissedTransaction(db, { vendorRaw: "Corner Store", amountCents: 1000, date: "2026-10-27" });

    expect(result.category).toBe("Groceries");
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails with "logMissedTransaction is not a function" or a module-not-found error**

Run: `npm --prefix backend run test -- manualAdapter`

- [ ] **Step 3: Implement `logMissedTransaction` in `backend/src/adapters/manualAdapter.ts`**

Validate in order: vendor non-empty after `.trim()`, `amountCents` is a positive (`> 0`) safe integer, `date` matches `/^\d{4}-\d{2}-\d{2}$/` — throw a distinct `Error` message for each so a failing test's assertion is easy to trace. On success, insert one row (`source: "manual_missed"`, `reviewStatus: "committed"`, `vendorNormalized: normalize(vendorRaw)`, `category: await categorize(db, vendorRaw)`, `provenance: "{}"`) with `.returning({ id: transactions.id, category: transactions.category })`.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- manualAdapter`

- [ ] **Step 5: Write the failing route test**

```typescript
// backend/test/missedTransactions.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { missedTransactionsRoutes } from "../src/routes/missedTransactions";
import { transactions } from "../src/db/schema";

describe("missedTransactions routes", () => {
  test("POST / logs a committed transaction and returns 201 with its id and category", async () => {
    const res = await missedTransactionsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendorRaw: "Corner Store", amountCents: 50000, date: "2026-10-27" }) },
      env
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTypeOf("number");
    const db = drizzle(env.DB);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
  });

  test("POST / with an invalid amount returns 400 and writes nothing", async () => {
    const res = await missedTransactionsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendorRaw: "x", amountCents: -5, date: "2026-10-27" }) },
      env
    );

    expect(res.status).toBe(400);
    const db = drizzle(env.DB);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  test("POST / with a malformed JSON body returns 400, not a 500", async () => {
    const res = await missedTransactionsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
      env
    );

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- missedTransactions`

- [ ] **Step 7: Implement `missedTransactionsRoutes` in `backend/src/routes/missedTransactions.ts`**

`export const missedTransactionsRoutes = new Hono<{ Bindings: { DB: D1Database } }>()`. `POST /` reads the JSON body inside a `try/catch` (a parse failure or `logMissedTransaction` validation throw both become `return c.text((err as Error).message, 400)`), otherwise `return c.json(result, 201)`.

- [ ] **Step 8: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- missedTransactions`

- [ ] **Step 9: Commit**

```bash
git add backend/src/adapters/manualAdapter.ts backend/src/routes/missedTransactions.ts backend/test/manualAdapter.test.ts backend/test/missedTransactions.test.ts
git commit -m "feat: add manual missed-transaction adapter and route"
```

---

### Task 2: Transactions list/get/correct-category route

**Files:**
- Create: `backend/src/routes/transactions.ts` (spec item 18, part 1 of 2 — Task 3 adds resolve-dedup to this same file)
- Test: `backend/test/transactions.test.ts`

**Interfaces:**
- Consumes: `correctCategory`, `normalize` (`categorizationEngine.ts`), the `transactions` table.
- Produces: `transactionsRoutes` (exported Hono instance). Task 3 adds a route to this same instance. Task 4 mounts it by name.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/transactions.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { transactionsRoutes } from "../src/routes/transactions";
import { transactions } from "../src/db/schema";

async function seed(db: ReturnType<typeof drizzle>, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  const [row] = await db
    .insert(transactions)
    .values({
      amount: 50000,
      date: "2026-10-27",
      vendorRaw: "Starbucks",
      vendorNormalized: "starbucks",
      category: "Uncategorized",
      source: "manual_missed",
      provenance: "{}",
      reviewStatus: "committed",
      ...overrides,
    })
    .returning();
  return row;
}

describe("transactions routes", () => {
  test("GET / lists committed transactions, newest first, excluding soft-deleted rows", async () => {
    const db = drizzle(env.DB);
    await seed(db, { date: "2026-10-01" });
    await seed(db, { date: "2026-10-27" });
    await seed(db, { date: "2026-10-15", deletedAt: new Date().toISOString() });

    const res = await transactionsRoutes.request("/", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].date).toBe("2026-10-27");
    expect(body[1].date).toBe("2026-10-01");
  });

  test("GET /?reviewStatus=pending_review filters to only that status", async () => {
    const db = drizzle(env.DB);
    await seed(db, { reviewStatus: "committed" });
    await seed(db, { reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request("/?reviewStatus=pending_review", {}, env);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].reviewStatus).toBe("pending_review");
  });

  test("GET /:id returns the transaction, including a soft-deleted one", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, { deletedAt: new Date().toISOString() });

    const res = await transactionsRoutes.request(`/${row.id}`, {}, env);

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(row.id);
  });

  test("GET /:id for a nonexistent id returns 404", async () => {
    const res = await transactionsRoutes.request("/999", {}, env);
    expect(res.status).toBe(404);
  });

  test("PATCH /:id/category updates the transaction's own category and upserts the category_rules entry for future auto-categorization", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, { vendorNormalized: "starbucks" });

    const res = await transactionsRoutes.request(
      `/${row.id}/category`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee" }) },
      env
    );

    expect(res.status).toBe(200);
    const [updated] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    expect(updated.category).toBe("Coffee");

    const { categorize } = await import("../src/services/categorizationEngine");
    expect(await categorize(db, "starbucks")).toBe("Coffee");
  });

  test("PATCH /:id/category for a nonexistent id returns 404", async () => {
    const res = await transactionsRoutes.request(
      "/999/category",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee" }) },
      env
    );
    expect(res.status).toBe(404);
  });
});
```

(Add `import { eq } from "drizzle-orm";` alongside the other imports.)

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm --prefix backend run test -- transactions`

- [ ] **Step 3: Implement `transactionsRoutes` in `backend/src/routes/transactions.ts`**

`export const transactionsRoutes = new Hono<{ Bindings: { DB: D1Database } }>()`.
- `GET /` — reads optional `?reviewStatus=` query param; selects from `transactions` filtering `isNull(deletedAt)` always, plus `eq(reviewStatus, ...)` when the param is present; `orderBy(desc(transactions.date))`.
- `GET /:id` — `parseInt(c.req.param("id"), 10)`; select by id (no `deletedAt` filter — a direct lookup is honest regardless); `404` via `c.text("not found", 404)` if no row.
- `PATCH /:id/category` — look up the row first (404 if missing, same as `GET /:id`); `db.update(transactions).set({ category }).where(eq(id, ...))`; then `correctCategory(db, row.vendorNormalized, category)`; respond `c.json({ id, category })`.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- transactions`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/transactions.ts backend/test/transactions.test.ts
git commit -m "feat: add transactions list/get/correct-category routes"
```

---

### Task 3: Transactions resolve-dedup route

**Files:**
- Modify: `backend/src/routes/transactions.ts` (adds to the Hono instance Task 2 created)
- Modify: `backend/test/transactions.test.ts`

**Interfaces:**
- Consumes: the `transactions` table; the pairing ruling from Plan-Level Rulings above.
- Produces: `POST /:id/resolve-dedup` on the same `transactionsRoutes` instance Task 2 exported — no new exports.

- [ ] **Step 1: Write the failing tests (append to `backend/test/transactions.test.ts`)**

```typescript
async function seedDedupPair(db: ReturnType<typeof drizzle>) {
  const groupId = "test-group-1";
  const [a] = await db
    .insert(transactions)
    .values({ amount: 50000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed", dedupGroupId: groupId, dedupResolution: "pending" })
    .returning();
  const [b] = await db
    .insert(transactions)
    .values({ amount: 50000, date: "2026-10-27", vendorRaw: "Starbucks Coffee", vendorNormalized: "starbucks coffee", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed", dedupGroupId: groupId, dedupResolution: "pending" })
    .returning();
  return { a, b };
}

test("POST /:id/resolve-dedup with action=kept marks this row kept and soft-deletes its counterpart as discarded", async () => {
  const db = drizzle(env.DB);
  const { a, b } = await seedDedupPair(db);

  const res = await transactionsRoutes.request(
    `/${a.id}/resolve-dedup`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
    env
  );

  expect(res.status).toBe(200);
  const [updatedA] = await db.select().from(transactions).where(eq(transactions.id, a.id));
  const [updatedB] = await db.select().from(transactions).where(eq(transactions.id, b.id));
  expect(updatedA.dedupResolution).toBe("kept");
  expect(updatedA.deletedAt).toBeNull();
  expect(updatedB.dedupResolution).toBe("discarded");
  expect(updatedB.deletedAt).not.toBeNull();
});

test("POST /:id/resolve-dedup with action=discarded soft-deletes this row and marks its counterpart kept", async () => {
  const db = drizzle(env.DB);
  const { a, b } = await seedDedupPair(db);

  await transactionsRoutes.request(
    `/${a.id}/resolve-dedup`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discarded" }) },
    env
  );

  const [updatedA] = await db.select().from(transactions).where(eq(transactions.id, a.id));
  const [updatedB] = await db.select().from(transactions).where(eq(transactions.id, b.id));
  expect(updatedA.dedupResolution).toBe("discarded");
  expect(updatedA.deletedAt).not.toBeNull();
  expect(updatedB.dedupResolution).toBe("kept");
});

test("POST /:id/resolve-dedup with action=confirmed_distinct marks both rows confirmed_distinct and deletes neither", async () => {
  const db = drizzle(env.DB);
  const { a, b } = await seedDedupPair(db);

  await transactionsRoutes.request(
    `/${a.id}/resolve-dedup`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirmed_distinct" }) },
    env
  );

  const [updatedA] = await db.select().from(transactions).where(eq(transactions.id, a.id));
  const [updatedB] = await db.select().from(transactions).where(eq(transactions.id, b.id));
  expect(updatedA.dedupResolution).toBe("confirmed_distinct");
  expect(updatedA.deletedAt).toBeNull();
  expect(updatedB.dedupResolution).toBe("confirmed_distinct");
  expect(updatedB.deletedAt).toBeNull();
});

test("POST /:id/resolve-dedup on a transaction with no dedup_group_id returns 400, not a crash", async () => {
  const db = drizzle(env.DB);
  const row = await seed(db); // no dedupGroupId

  const res = await transactionsRoutes.request(
    `/${row.id}/resolve-dedup`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
    env
  );

  expect(res.status).toBe(400);
});

test("POST /:id/resolve-dedup with an invalid action returns 400", async () => {
  const db = drizzle(env.DB);
  const { a } = await seedDedupPair(db);

  const res = await transactionsRoutes.request(
    `/${a.id}/resolve-dedup`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "maybe" }) },
    env
  );

  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run the test, confirm the new ones fail**

Run: `npm --prefix backend run test -- transactions`

- [ ] **Step 3: Implement `POST /:id/resolve-dedup` in `backend/src/routes/transactions.ts`**

Validate `action` is one of `"kept" | "discarded" | "confirmed_distinct"` (400 otherwise). Look up the target row by id (404 if missing); 400 if `dedupGroupId` is null. Look up its counterpart: `eq(dedupGroupId, target.dedupGroupId)` and `ne(id, target.id)` (400 if none found — a data-integrity guard, since `runDedupCheck` always writes exactly two rows per group). Apply the pairing rule from Plan-Level Rulings as one `db.batch([...])` of two updates (both rows written atomically, same pattern as `dedupEngine.ts`'s own match-writing batch): `kept` → target `{dedupResolution: "kept"}`, counterpart `{dedupResolution: "discarded", deletedAt: now}`; `discarded` → target `{dedupResolution: "discarded", deletedAt: now}`, counterpart `{dedupResolution: "kept"}`; `confirmed_distinct` → both `{dedupResolution: "confirmed_distinct"}`. Respond `c.json({ resolved: action })`.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix backend run test -- transactions`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/transactions.ts backend/test/transactions.test.ts
git commit -m "feat: add transactions resolve-dedup route"
```

---

### Task 4: Mount the new routes into the real app

**Files:**
- Modify: `backend/src/index.ts`
- Test: `backend/test/index.test.ts`

**Interfaces:**
- Consumes: `transactionsRoutes` (Task 2/3), `missedTransactionsRoutes` (Task 1).
- Produces: nothing new for later tasks — this is the end of Phase 6.

- [ ] **Step 1: Write the failing test (append a new `describe` block to `backend/test/index.test.ts`)**

```typescript
describe("app routing", () => {
  test("the real app (not just the standalone route instances) serves /transactions and /missed-transactions", async () => {
    const listRes = await worker.fetch(new Request("https://example.com/transactions"), testEnv);
    expect(listRes.status).toBe(200);

    const postRes = await worker.fetch(
      new Request("https://example.com/missed-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorRaw: "Corner Store", amountCents: 1000, date: "2026-10-27" }),
      }),
      testEnv
    );
    expect(postRes.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails (404 — nothing mounted yet)**

Run: `npm --prefix backend run test -- index`

- [ ] **Step 3: Mount the routes in `backend/src/index.ts`**

Add `app.route("/transactions", transactionsRoutes)` and `app.route("/missed-transactions", missedTransactionsRoutes)` alongside the existing `const app = new Hono<{ Bindings: Env }>();` declaration, with the matching imports.

- [ ] **Step 4: Run the full suite and the build**

Run: `npm --prefix backend run test` — expect all tests (Phase 1-6) passing.
Run: `npm --prefix backend run build` — expect a clean `tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts backend/test/index.test.ts
git commit -m "feat: mount transactions and missed-transactions routes into the app"
```
