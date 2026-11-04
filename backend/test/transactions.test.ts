import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
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
    const body = (await res.json()) as { date: string }[];
    expect(body).toHaveLength(2);
    expect(body[0].date).toBe("2026-10-27");
    expect(body[1].date).toBe("2026-10-01");
  });

  test("GET /?reviewStatus=pending_review filters to only that status", async () => {
    const db = drizzle(env.DB);
    await seed(db, { reviewStatus: "committed" });
    await seed(db, { reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request("/?reviewStatus=pending_review", {}, env);

    const body = (await res.json()) as { reviewStatus: string }[];
    expect(body).toHaveLength(1);
    expect(body[0].reviewStatus).toBe("pending_review");
  });

  test("GET /:id returns the transaction, including a soft-deleted one", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, { deletedAt: new Date().toISOString() });

    const res = await transactionsRoutes.request(`/${row.id}`, {}, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number };
    expect(body.id).toBe(row.id);
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

  test("[I3] PATCH /:id/category with malformed JSON returns 400, not a 500", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db);

    const res = await transactionsRoutes.request(
      `/${row.id}/category`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "not json" },
      env
    );

    expect(res.status).toBe(400);
  });

  test("[I4] PATCH /:id/category with an empty or missing category returns 400 and changes nothing", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, { category: "Uncategorized" });

    const emptyRes = await transactionsRoutes.request(
      `/${row.id}/category`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "   " }) },
      env
    );
    const missingRes = await transactionsRoutes.request(
      `/${row.id}/category`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      env
    );

    expect(emptyRes.status).toBe(400);
    expect(missingRes.status).toBe(400);
    const [unchanged] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    expect(unchanged.category).toBe("Uncategorized");
  });

  async function seedDedupPair(db: ReturnType<typeof drizzle>) {
    const groupId = "test-group-1";
    const [a] = await db
      .insert(transactions)
      .values({
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

  test("[C1] resolving the same pair a second time returns 409 and does not touch either row again", async () => {
    const db = drizzle(env.DB);
    const { a, b } = await seedDedupPair(db);

    await transactionsRoutes.request(
      `/${a.id}/resolve-dedup`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
      env
    );

    // Someone changes their mind, or double-clicks, or the frontend
    // targets the other side of the pair -- re-resolving must not be
    // able to soft-delete both halves of a real transaction.
    const secondRes = await transactionsRoutes.request(
      `/${b.id}/resolve-dedup`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
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
    const row = await seed(db); // no dedupGroupId

    const res = await transactionsRoutes.request(
      `/${row.id}/resolve-dedup`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kept" }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("[I3] POST /:id/resolve-dedup with malformed JSON returns 400, not a 500", async () => {
    const db = drizzle(env.DB);
    const { a } = await seedDedupPair(db);

    const res = await transactionsRoutes.request(
      `/${a.id}/resolve-dedup`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
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

  test("PATCH /:id edits vendorRaw, amount, date, and category together", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db, { reviewStatus: "pending_review" });

    const res = await transactionsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorRaw: "Starbucks Coffee", amount: 1250, date: "2026-10-05", category: "Coffee" }) },
      env
    );

    expect(res.status).toBe(200);
    const [updated] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    expect(updated).toMatchObject({ vendorRaw: "Starbucks Coffee", amount: 1250, date: "2026-10-05", category: "Coffee" });
  });

  test("PATCH /:id rejects a non-positive-integer amount", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db);

    const res = await transactionsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: -5 }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("PATCH /:id rejects a malformed date", async () => {
    const db = drizzle(env.DB);
    const row = await seed(db);

    const res = await transactionsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "2026-02-31" }) },
      env
    );

    expect(res.status).toBe(400);
  });

  test("PATCH /999 returns 404", async () => {
    const res = await transactionsRoutes.request(
      "/999",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 100 }) },
      env
    );
    expect(res.status).toBe(404);
  });
});
