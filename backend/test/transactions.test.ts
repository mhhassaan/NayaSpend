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
