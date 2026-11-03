import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { evaluateBudgets } from "../src/services/budgetAlertTrigger";
import { budgets, transactions } from "../src/db/schema";

const testEnv = { RESEND_API_KEY: "test-resend-key", NOTIFICATION_EMAIL: "user@example.com" };

// The trigger evaluates against the real current month (`new Date()`), so a
// transaction must be dated within it regardless of when the suite runs.
function currentMonthDay(day: number): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function seedTransaction(db: ReturnType<typeof drizzle>, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  await db.insert(transactions).values({
    amount: 10000,
    date: currentMonthDay(15),
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
