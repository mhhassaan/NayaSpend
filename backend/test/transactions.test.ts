import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test } from "vitest";
import { transactionsRoutes } from "../src/routes/transactions";
import { transactions } from "../src/db/schema";
import { correctCategory } from "../src/services/categorizationEngine";
import { seedUserAndSession } from "./helpers/authedRequest";

async function seed(db: ReturnType<typeof drizzle>, userId: number, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  const [row] = await db
    .insert(transactions)
    .values({
      userId,
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
  let userId: number;
  let cookie: string;
  beforeEach(async () => {
    ({ userId, cookie } = await seedUserAndSession(drizzle(env.DB)));
  });

  test("POST /fix-sign-convention flips only eligible rows and counts actual changes", async () => {
    const db = drizzle(env.DB);
    const manual = await seed(db, userId);
    const gmail = await seed(db, userId, { source: "gmail_email", amount: 125000 });
    const untouched = await Promise.all([
      seed(db, userId, { source: "statement_import" }),
      seed(db, userId, { amount: -50000 }),
      seed(db, userId, { source: "gmail_email", amount: -125000 }),
      seed(db, userId, { amount: 0 }),
      seed(db, userId, { reviewStatus: "pending_review" }),
      seed(db, userId, { source: "gmail_email", reviewStatus: "pending_review" }),
      seed(db, userId, { deletedAt: new Date().toISOString() }),
      seed(db, userId, { source: "gmail_email", deletedAt: new Date().toISOString() }),
    ]);

    const res = await transactionsRoutes.request("/fix-sign-convention", { method: "POST", headers: { Cookie: cookie } }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fixed: 2 });
    const [updatedManual] = await db.select().from(transactions).where(eq(transactions.id, manual.id));
    const [updatedGmail] = await db.select().from(transactions).where(eq(transactions.id, gmail.id));
    expect(updatedManual).toEqual({ ...manual, amount: -50000 });
    expect(updatedGmail).toEqual({ ...gmail, amount: -125000 });
    for (const row of untouched) {
      const [unchanged] = await db.select().from(transactions).where(eq(transactions.id, row.id));
      expect(unchanged).toEqual(row);
    }
  });

  test("POST /fix-sign-convention is idempotent", async () => {
    const db = drizzle(env.DB);
    await seed(db, userId);
    await seed(db, userId, { source: "gmail_email" });

    const first = await transactionsRoutes.request("/fix-sign-convention", { method: "POST", headers: { Cookie: cookie } }, env);
    const second = await transactionsRoutes.request("/fix-sign-convention", { method: "POST", headers: { Cookie: cookie } }, env);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ fixed: 2 });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ fixed: 0 });
    const rows = await db.select().from(transactions);
    expect(rows.map((row) => row.amount)).toEqual([-50000, -50000]);
  });

  test("POST /recategorize changes only eligible Uncategorized rows and counts actual changes", async () => {
    const db = drizzle(env.DB);
    const keyword = await seed(db, userId, { vendorNormalized: "alkhan pharmacy" });
    const learned = await seed(db, userId, { vendorNormalized: "kfc lahore" });
    await correctCategory(db, "kfc lahore", "Work meals", userId);
    const untouched = await Promise.all([
      seed(db, userId, { vendorNormalized: "kfc lahore", category: "Personal" }),
      seed(db, userId, { vendorNormalized: "kfc lahore", category: "Food & Dining" }),
      seed(db, userId, { vendorNormalized: "kfc lahore", category: "uncategorized" }),
      seed(db, userId, { vendorNormalized: "kfc lahore", deletedAt: new Date().toISOString() }),
      seed(db, userId, { vendorNormalized: "kfc lahore", reviewStatus: "pending_review" }),
      seed(db, userId, { vendorNormalized: "unknown vendor" }),
    ]);

    const res = await transactionsRoutes.request("/recategorize", { method: "POST", headers: { Cookie: cookie } }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recategorized: 2 });
    const [updatedKeyword] = await db.select().from(transactions).where(eq(transactions.id, keyword.id));
    const [updatedLearned] = await db.select().from(transactions).where(eq(transactions.id, learned.id));
    expect(updatedKeyword.category).toBe("Health");
    expect(updatedLearned.category).toBe("Work meals");
    for (const row of untouched) {
      const [unchanged] = await db.select().from(transactions).where(eq(transactions.id, row.id));
      expect(unchanged).toEqual(row);
    }
  });

  test("POST /recategorize is idempotent", async () => {
    const db = drizzle(env.DB);
    await seed(db, userId, { vendorNormalized: "alfa mart lahore pk" });

    const first = await transactionsRoutes.request("/recategorize", { method: "POST", headers: { Cookie: cookie } }, env);
    const second = await transactionsRoutes.request("/recategorize", { method: "POST", headers: { Cookie: cookie } }, env);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ recategorized: 1 });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ recategorized: 0 });
  });

  test("GET / lists committed transactions, newest first, excluding soft-deleted rows", async () => {
    const db = drizzle(env.DB);
    await seed(db, userId, { date: "2026-10-01" });
    await seed(db, userId, { date: "2026-10-27" });
    await seed(db, userId, { date: "2026-10-15", deletedAt: new Date().toISOString() });

    const res = await transactionsRoutes.request("/", { headers: { Cookie: cookie } }, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string }[];
    expect(body).toHaveLength(2);
    expect(body[0].date).toBe("2026-10-27");
    expect(body[1].date).toBe("2026-10-01");
  });

  test("GET /?reviewStatus=pending_review filters to only that status", async () => {
    const db = drizzle(env.DB);
    await seed(db, userId, { reviewStatus: "committed" });
    await seed(db, userId, { reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request("/?reviewStatus=pending_review", { headers: { Cookie: cookie } }, env);

    const body = (await res.json()) as { reviewStatus: string }[];
    expect(body).toHaveLength(1);
    expect(body[0].reviewStatus).toBe("pending_review");
  });

  test("GET /:id returns the transaction, including a soft-deleted one", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { deletedAt: new Date().toISOString() });

    const res = await transactionsRoutes.request(`/${row.id}`, { headers: { Cookie: cookie } }, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number };
    expect(body.id).toBe(row.id);
  });

  test("GET /:id for a nonexistent id returns 404", async () => {
    const res = await transactionsRoutes.request("/999", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(404);
  });

  test("PATCH /:id/category updates the transaction's own category and upserts the category_rules entry for future auto-categorization", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { vendorNormalized: "starbucks" });

    const res = await transactionsRoutes.request(
      `/${row.id}/category`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee" }) },
      env
    );

    expect(res.status).toBe(200);
    const [updated] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    expect(updated.category).toBe("Coffee");

    const { categorize } = await import("../src/services/categorizationEngine");
    expect(await categorize(db, "starbucks", userId)).toBe("Coffee");
  });

  test("PATCH /:id/category for a nonexistent id returns 404", async () => {
    const res = await transactionsRoutes.request(
      "/999/category",
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee" }) },
      env
    );
    expect(res.status).toBe(404);
  });

  test("[I3] PATCH /:id/category with malformed JSON returns 400, not a 500", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId);

    const res = await transactionsRoutes.request(
      `/${row.id}/category`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "not json" },
      env
    );

    expect(res.status).toBe(400);
  });

  test("[I4] PATCH /:id/category with an empty or missing category returns 400 and changes nothing", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { category: "Uncategorized" });

    const emptyRes = await transactionsRoutes.request(
      `/${row.id}/category`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ category: "   " }) },
      env
    );
    const missingRes = await transactionsRoutes.request(
      `/${row.id}/category`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({}) },
      env
    );

    expect(emptyRes.status).toBe(400);
    expect(missingRes.status).toBe(400);
    const [unchanged] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    expect(unchanged.category).toBe("Uncategorized");
  });

  async function seedDedupPair(db: ReturnType<typeof drizzle>, userId: number) {
    const groupId = "test-group-1";
    const [a] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 50000,
        date: "2026-10-27",
        vendorRaw: "Starbucks",
        vendorNormalized: "starbucks",
        category: "Coffee",
        source: "gmail_email",
        provenance: "{}",
        reviewStatus: "committed",
        dedupGroupId: groupId,
        dedupResolution: "pending",
      })
      .returning();
    const [b] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 50000,
        date: "2026-10-27",
        vendorRaw: "Starbucks Coffee",
        vendorNormalized: "starbucks coffee",
        category: "Coffee",
        source: "statement_import",
        provenance: "{}",
        reviewStatus: "committed",
        dedupGroupId: groupId,
        dedupResolution: "pending",
      })
      .returning();
    return { a, b };
  }

  test("POST /:id/resolve-dedup with action=kept marks this row kept and soft-deletes its counterpart as discarded", async () => {
    const db = drizzle(env.DB);
    const { a, b } = await seedDedupPair(db, userId);

    const res = await transactionsRoutes.request(
      `/${a.id}/resolve-dedup`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
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
    const { a, b } = await seedDedupPair(db, userId);

    await transactionsRoutes.request(
      `/${a.id}/resolve-dedup`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "discarded" }) },
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
    const { a, b } = await seedDedupPair(db, userId);

    await transactionsRoutes.request(
      `/${a.id}/resolve-dedup`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirmed_distinct" }) },
      env
    );

    const [updatedA] = await db.select().from(transactions).where(eq(transactions.id, a.id));
    const [updatedB] = await db.select().from(transactions).where(eq(transactions.id, b.id));
    expect(updatedA.dedupResolution).toBe("confirmed_distinct");
    expect(updatedA.deletedAt).toBeNull();
    expect(updatedB.dedupResolution).toBe("confirmed_distinct");
    expect(updatedB.deletedAt).toBeNull();
  });

  test("[C1] resolving the same pair a second time returns 409 and does not touch either row again", async () => {
    const db = drizzle(env.DB);
    const { a, b } = await seedDedupPair(db, userId);

    await transactionsRoutes.request(
      `/${a.id}/resolve-dedup`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
      env
    );

    // Someone changes their mind, or double-clicks, or the frontend
    // targets the other side of the pair -- re-resolving must not be
    // able to soft-delete both halves of a real transaction.
    const secondRes = await transactionsRoutes.request(
      `/${b.id}/resolve-dedup`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
      env
    );

    expect(secondRes.status).toBe(409);
    const [updatedA] = await db.select().from(transactions).where(eq(transactions.id, a.id));
    const [updatedB] = await db.select().from(transactions).where(eq(transactions.id, b.id));
    expect(updatedA.dedupResolution).toBe("kept");
    expect(updatedA.deletedAt).toBeNull();
    expect(updatedB.dedupResolution).toBe("discarded");
    expect(updatedB.deletedAt).not.toBeNull();
  });

  test("POST /:id/resolve-dedup on a transaction with no dedup_group_id returns 400, not a crash", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId); // no dedupGroupId

    const res = await transactionsRoutes.request(
      `/${row.id}/resolve-dedup`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("[I3] POST /:id/resolve-dedup with malformed JSON returns 400, not a 500", async () => {
    const db = drizzle(env.DB);
    const { a } = await seedDedupPair(db, userId);

    const res = await transactionsRoutes.request(
      `/${a.id}/resolve-dedup`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "not json" },
      env
    );

    expect(res.status).toBe(400);
  });

  test("POST /:id/resolve-dedup with an invalid action returns 400", async () => {
    const db = drizzle(env.DB);
    const { a } = await seedDedupPair(db, userId);

    const res = await transactionsRoutes.request(
      `/${a.id}/resolve-dedup`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "maybe" }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("PATCH /:id edits vendorRaw, amount, date, and category together", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ vendorRaw: "Starbucks Coffee", amount: 1250, date: "2026-10-05", category: "Coffee" }) },
      env
    );

    expect(res.status).toBe(200);
    const [updated] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    expect(updated).toMatchObject({ vendorRaw: "Starbucks Coffee", amount: 1250, date: "2026-10-05", category: "Coffee" });
  });

  test("PATCH /:id rejects a non-positive-integer amount", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId);

    const res = await transactionsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ amount: -5 }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("PATCH /:id rejects a malformed date", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId);

    const res = await transactionsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ date: "2026-02-31" }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("PATCH /999 returns 404", async () => {
    const res = await transactionsRoutes.request(
      "/999",
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ amount: 100 }) },
      env
    );
    expect(res.status).toBe(404);
  });

  test("[Review Focus] resolve-review commit re-runs the dedup check and reports a match", async () => {
    const db = drizzle(env.DB);
    // An already-committed statement-sourced row with no pair yet.
    await seed(db, userId, {
      amount: 500, date: "2026-10-10", vendorRaw: "Daraz", vendorNormalized: "daraz",
      category: "Shopping", source: "statement_import", reviewStatus: "committed",
    });
    // A quarantined gmail-sourced row that matches it on amount/date/vendor once committed.
    const quarantined = await seed(db, userId, {
      amount: 500, date: "2026-10-11", vendorRaw: "Daraz", vendorNormalized: "daraz",
      category: "Shopping", source: "gmail_email", reviewStatus: "pending_review",
    });

    const res = await transactionsRoutes.request(
      `/${quarantined.id}/resolve-review`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
      env
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { resolved: string; matched: boolean };
    expect(body).toEqual({ resolved: "commit", matched: true });
    const [updated] = await db.select().from(transactions).where(eq(transactions.id, quarantined.id));
    expect(updated.reviewStatus).toBe("committed");
    expect(updated.dedupGroupId).not.toBeNull();
  });

  test("resolve-review commit with no dedup match reports matched: false", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request(
      `/${row.id}/resolve-review`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
      env
    );

    const body = (await res.json()) as { matched: boolean };
    expect(body.matched).toBe(false);
  });

  test("resolve-review reject soft-deletes without committing", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request(
      `/${row.id}/resolve-review`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject" }) },
      env
    );

    expect(res.status).toBe(200);
    const [updated] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    expect(updated.reviewStatus).toBe("pending_review");
    expect(updated.deletedAt).not.toBeNull();
  });

  test("resolve-review on an already-committed row returns 400", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { reviewStatus: "committed" });

    const res = await transactionsRoutes.request(
      `/${row.id}/resolve-review`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("resolve-review with an invalid action returns 400", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request(
      `/${row.id}/resolve-review`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("resolve-review commit on a zero-amount (still-quarantined-placeholder) row returns 400", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, userId, { amount: 0, reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request(
      `/${row.id}/resolve-review`,
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
      env
    );

    expect(res.status).toBe(400);
    const [unchanged] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    expect(unchanged.reviewStatus).toBe("pending_review");
  });

  test("resolve-review on a nonexistent id returns 404", async () => {
    const res = await transactionsRoutes.request(
      "/999/resolve-review",
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
      env
    );
    expect(res.status).toBe(404);
  });
});

describe("transaction ownership", () => {
  test("[Review Focus] GET /:id 404s for a transaction owned by a different user", async () => {
    const db = drizzle(env.DB);
    const a = await seedUserAndSession(db);
    const b = await seedUserAndSession(db);
    const row = await seed(db, b.userId);
    const res = await transactionsRoutes.request(`/${row.id}`, { headers: { Cookie: a.cookie } }, env);
    expect(res.status).toBe(404);
  });

  test("[Review Focus] PATCH /:id cannot modify another user's transaction", async () => {
    const db = drizzle(env.DB);
    const a = await seedUserAndSession(db);
    const b = await seedUserAndSession(db);
    const row = await seed(db, b.userId);
    const res = await transactionsRoutes.request(`/${row.id}`, {
      method: "PATCH", headers: { Cookie: a.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 123, vendorRaw: "Changed", category: "Changed", date: "2026-01-01" }),
    }, env);
    expect(res.status).toBe(404);
    expect(await db.select().from(transactions).where(eq(transactions.id, row.id))).toEqual([row]);
  });

  test.each(["commit", "reject"])("[Review Focus] POST /:id/resolve-review cannot resolve another user's transaction (%s)", async (action) => {
    const db = drizzle(env.DB);
    const a = await seedUserAndSession(db);
    const b = await seedUserAndSession(db);
    const row = await seed(db, b.userId, { reviewStatus: "pending_review" });
    const res = await transactionsRoutes.request(`/${row.id}/resolve-review`, {
      method: "POST", headers: { Cookie: a.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }, env);
    expect(res.status).toBe(404);
    expect(await db.select().from(transactions).where(eq(transactions.id, row.id))).toEqual([row]);
  });

  test.each(["", "?reviewStatus=committed"])("GET / only returns the authenticated user's own transactions (%s)", async (query) => {
    const db = drizzle(env.DB);
    const a = await seedUserAndSession(db);
    const b = await seedUserAndSession(db);
    const own = await seed(db, a.userId);
    await seed(db, b.userId);
    const res = await transactionsRoutes.request(`/${query}`, { headers: { Cookie: a.cookie } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([own]);
  });

  test("POST /recategorize and POST /fix-sign-convention only touch the authenticated user's own rows", async () => {
    const db = drizzle(env.DB);
    const a = await seedUserAndSession(db);
    const b = await seedUserAndSession(db);
    const own = await seed(db, a.userId, { vendorNormalized: "kfc" });
    const other = await seed(db, b.userId, { vendorNormalized: "kfc" });
    for (const path of ["/recategorize", "/fix-sign-convention"]) {
      const res = await transactionsRoutes.request(path, { method: "POST", headers: { Cookie: a.cookie } }, env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(path === "/recategorize" ? { recategorized: 1 } : { fixed: 1 });
      expect(await db.select().from(transactions).where(eq(transactions.id, other.id))).toEqual([other]);
    }
    expect(await db.select().from(transactions).where(eq(transactions.id, own.id)))
      .toEqual([{ ...own, category: "Food & Dining", amount: -50000 }]);
  });

  test.each(["category", "resolve-dedup"])("[Review Focus] /:id/%s cannot modify another user's transaction", async (endpoint) => {
    const db = drizzle(env.DB);
    const a = await seedUserAndSession(db);
    const b = await seedUserAndSession(db);
    const row = await seed(db, b.userId, { dedupGroupId: "foreign-group", dedupResolution: "pending" });
    const res = await transactionsRoutes.request(`/${row.id}/${endpoint}`, {
      method: endpoint === "category" ? "PATCH" : "POST",
      headers: { Cookie: a.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ category: "Changed", action: "kept" }),
    }, env);
    expect(res.status).toBe(404);
    expect(await db.select().from(transactions).where(eq(transactions.id, row.id))).toEqual([row]);
  });

  test("resolve-dedup never changes a foreign counterpart sharing the group ID", async () => {
    const db = drizzle(env.DB);
    const a = await seedUserAndSession(db);
    const b = await seedUserAndSession(db);
    const own = await seed(db, a.userId, { dedupGroupId: "shared-group", dedupResolution: "pending" });
    const other = await seed(db, b.userId, { dedupGroupId: "shared-group", dedupResolution: "pending" });
    const res = await transactionsRoutes.request(`/${own.id}/resolve-dedup`, {
      method: "POST", headers: { Cookie: a.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "kept" }),
    }, env);
    expect(res.status).toBe(400);
    expect(await db.select().from(transactions).where(eq(transactions.id, own.id))).toEqual([own]);
    expect(await db.select().from(transactions).where(eq(transactions.id, other.id))).toEqual([other]);
  });
});
