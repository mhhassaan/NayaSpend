import { seedUserAndSession } from "./helpers/authedRequest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test } from "vitest";
import { getMonthlyTrends, getTrendsHistory } from "../src/services/trendsService";
import { transactions } from "../src/db/schema";

async function seed(db: ReturnType<typeof drizzle>, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  await db.insert(transactions).values({ userId,
    amount: -5000,
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

let userId: number;
beforeEach(async () => {
  ({ userId } = await seedUserAndSession(drizzle(env.DB)));
});

describe("getMonthlyTrends", () => {
  test("returns the single largest spend's raw vendor and negative amount", async () => {
    const db = drizzle(env.DB);
    await seed(db, { amount: -5000, vendorRaw: "Coffee shop" });
    await seed(db, { amount: -20000, vendorRaw: "Imtiaz" });
    await seed(db, { amount: -8000, vendorRaw: "Petrol" });
    await seed(db, { amount: 90000, vendorRaw: "Salary" });
    await seed(db, { amount: -100000, date: "2026-09-30", vendorRaw: "Other month" });
    await seed(db, { amount: -100000, reviewStatus: "pending_review" });
    await seed(db, { amount: -100000, deletedAt: new Date().toISOString() });
    await seed(db, { amount: -100000, dedupResolution: "pending", dedupGroupId: "g1" });
    const other = await seedUserAndSession(db);
    await seed(db, { amount: -100000, userId: other.userId });

    expect((await getMonthlyTrends(db, "2026-10", userId)).biggestPurchase)
      .toEqual({ vendorRaw: "Imtiaz", amountCents: -20000 });
  });

  test("returns no biggest purchase for a month with only inflows", async () => {
    const db = drizzle(env.DB);
    await seed(db, { amount: 20000 });
    expect((await getMonthlyTrends(db, "2026-10", userId)).biggestPurchase).toBeNull();
  });

  test("returns no biggest purchase for a month with zero transactions", async () => {
    expect((await getMonthlyTrends(drizzle(env.DB), "2026-10", userId)).biggestPurchase).toBeNull();
  });
  test("sums committed transactions by category for the given month", async () => {
    const db = drizzle(env.DB);
    await seed(db, { amount: -5000, category: "Coffee" });
    await seed(db, { amount: -3000, category: "Coffee" });
    await seed(db, { amount: -2000, category: "Groceries" });

    const result = await getMonthlyTrends(db, "2026-10", userId);

    expect(result.spentCents).toBe(10000);
    expect(result.receivedCents).toBe(0);
    expect(result.hasData).toBe(true);
    expect(result.byCategory).toEqual(
      expect.arrayContaining([{ category: "Coffee", totalCents: 8000 }, { category: "Groceries", totalCents: 2000 }])
    );
  });

  test("separates spend and received money within the same category", async () => {
    const db = drizzle(env.DB);
    await seed(db, { amount: -5000, category: "Transfers" });
    await seed(db, { amount: 12000, category: "Transfers" });
    await seed(db, { amount: 3000, category: "Salary" });
    const result = await getMonthlyTrends(db, "2026-10", userId);
    expect(result.spentCents).toBe(5000);
    expect(result.receivedCents).toBe(15000);
    expect(result.hasData).toBe(true);
    expect(result.byCategory).toEqual([{ category: "Transfers", totalCents: 5000 }]);
  });

  test("an income-only month has no spend data but retains received money", async () => {
    const db = drizzle(env.DB);
    await seed(db, { amount: 12000, category: "Salary" });
    const result = await getMonthlyTrends(db, "2026-10", userId);
    expect(result.spentCents).toBe(0);
    expect(result.receivedCents).toBe(12000);
    expect(result.hasData).toBe(false);
    expect(result.byCategory).toEqual([]);
  });

  test("excludes a transaction outside the requested month", async () => {
    const db = drizzle(env.DB);
    await seed(db, { date: "2026-09-30" });

    const result = await getMonthlyTrends(db, "2026-10", userId);

    expect(result.hasData).toBe(false);
    expect(result.spentCents).toBe(0);
  });

  test("excludes pending_review, soft-deleted, and dedup-pending transactions", async () => {
    const db = drizzle(env.DB);
    await seed(db, { reviewStatus: "pending_review" });
    await seed(db, { deletedAt: new Date().toISOString() });
    await seed(db, { dedupGroupId: "g1", dedupResolution: "pending" });

    const result = await getMonthlyTrends(db, "2026-10", userId);

    expect(result.hasData).toBe(false);
  });

  test("a month with zero matching transactions reports hasData: false instead of a misleadingly empty chart", async () => {
    const db = drizzle(env.DB);

    const result = await getMonthlyTrends(db, "2026-10", userId);

    expect(result.hasData).toBe(false);
    expect(result.byCategory).toEqual([]);
  });
});

describe("getTrendsHistory", () => {
  test("returns monthsCount entries, oldest to newest, ending at the current month", async () => {
    const db = drizzle(env.DB);
    const result = await getTrendsHistory(db, 3, userId);
    expect(result.months).toHaveLength(3);
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    expect(result.months[2].month).toBe(currentMonth);
  });

  test("aggregates each month independently from one range query", async () => {
    const db = drizzle(env.DB);
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    await db.insert(transactions).values({ userId,
      amount: -1000, date: `${thisMonth}-05`, vendorRaw: "x", vendorNormalized: "x", category: "Coffee",
      source: "manual_missed", provenance: "{}", reviewStatus: "committed",
    });

    await seed(db, { amount: 2500, date: `${thisMonth}-06` });

    const result = await getTrendsHistory(db, 2, userId);

    expect(result.months[1].spentCents).toBe(1000);
    expect(result.months[1].receivedCents).toBe(2500);
    expect(result.months[1].byCategory).toEqual([{ category: "Coffee", totalCents: 1000 }]);
    expect(result.months[1].hasData).toBe(true);
    expect(result.months[0].hasData).toBe(false);
  });
});

test("[Review Focus] getMonthlyTrends/getTrendsHistory never include another user's transactions", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  const month = new Date().toISOString().slice(0, 7);
  await seed(db, { date: `${month}-05`, amount: -1000 });
  await seed(db, { date: `${month}-06`, amount: 2000 });
  await seed(db, { userId: other.userId, date: `${month}-05`, amount: -9000, category: "Other" });
  await seed(db, { userId: other.userId, date: `${month}-06`, amount: 8000 });
  const expected = { month, spentCents: 1000, receivedCents: 2000, byCategory: [{ category: "Coffee", totalCents: 1000 }], hasData: true };
  expect(await getMonthlyTrends(db, month, userId)).toEqual({ ...expected, biggestPurchase: { vendorRaw: "x", amountCents: -1000 } });
  expect(await getTrendsHistory(db, 1, userId)).toEqual({ months: [expected] });
});
