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
