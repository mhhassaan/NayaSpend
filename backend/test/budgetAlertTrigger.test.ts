import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { evaluateBudgets } from "../src/services/budgetAlertTrigger";
import { budgets, transactions } from "../src/db/schema";
import { seedUserAndSession } from "./helpers/authedRequest";

const testEnv = { RESEND_API_KEY: "test-resend-key", NOTIFICATION_EMAIL: "user@example.com" };

// The trigger evaluates against the real current month (`new Date()`), so a
// transaction must be dated within it regardless of when the suite runs.
function currentMonthDay(day: number): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function transactionValues(userId: number, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  return {
    userId,
    amount: -10000,
    date: currentMonthDay(15),
    vendorRaw: "x",
    vendorNormalized: "x",
    category: "Coffee",
    source: "manual_missed",
    provenance: "{}",
    reviewStatus: "committed",
    ...overrides,
  };
}

async function seedTransaction(db: ReturnType<typeof drizzle>, userId: number, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  await db.insert(transactions).values(transactionValues(userId, overrides));
}

async function seedAndReturnTransaction(db: ReturnType<typeof drizzle>, userId: number, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  return db.insert(transactions).values(transactionValues(userId, overrides)).returning();
}

describe("evaluateBudgets", () => {
  let userId: number;
  beforeEach(async () => {
    ({ userId } = await seedUserAndSession(drizzle(env.DB)));
  });

  test("alerts once when spending crosses 100% of the monthly limit", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, userId, { amount: -10000 });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv, userId);

    expect(result.alerted).toEqual(["Coffee"]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("does not re-alert on a second run within the same month at the same threshold", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, userId, { amount: -10000 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await evaluateBudgets(db, testEnv, userId);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await evaluateBudgets(db, testEnv, userId);

    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("[Review Focus] excludes a transaction whose dedup_resolution is pending from the spent total", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, userId, { amount: -10000, dedupGroupId: "g1", dedupResolution: "pending" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv, userId);

    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("excludes a soft-deleted transaction from the spent total", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, userId, { amount: -10000, deletedAt: new Date().toISOString() });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv, userId);

    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does not alert below the 80% threshold", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, userId, { amount: -7000 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv, userId);

    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("received money in a budgeted category does not count as spending", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, userId, { amount: -7000 });
    await seedTransaction(db, userId, { amount: 20000 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await evaluateBudgets(db, testEnv, userId);
    expect(result.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // [Final review I3] the original equality check ("same threshold as last
  // time") let spending escalate from 80% to 100% without a second alert,
  // contradicting the plan's own debounce ruling, which is about not
  // re-alerting the *same* crossing -- not suppressing a *new, higher* one.
  test("[I3] escalating from 80% to 100% within the same month alerts again at the higher threshold", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    await seedTransaction(db, userId, { amount: -8000 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const firstRun = await evaluateBudgets(db, testEnv, userId);
    expect(firstRun.alerted).toEqual(["Coffee"]);

    await seedTransaction(db, userId, { amount: -2000 }); // total now 10000 = 100%
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const secondRun = await evaluateBudgets(db, testEnv, userId);

    expect(secondRun.alerted).toEqual(["Coffee"]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  // [Final review I3] after alerting at 100%, a later drop back down to
  // 80% (a refund, a recategorization) must not re-alert at the lower
  // threshold within the same month -- escalation-only, not equality-only.
  test("[I3] does not re-alert at a lower threshold after already alerting at a higher one this month", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    const [tx] = await seedAndReturnTransaction(db, userId, { amount: -10000 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const firstRun = await evaluateBudgets(db, testEnv, userId);
    expect(firstRun.alerted).toEqual(["Coffee"]);

    // Simulate spend dropping to 80% (e.g. a refund soft-deletes the
    // original transaction, replaced by a smaller one).
    await db.update(transactions).set({ deletedAt: new Date().toISOString() }).where(eq(transactions.id, tx.id));
    await seedTransaction(db, userId, { amount: -8000 });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const secondRun = await evaluateBudgets(db, testEnv, userId);

    expect(secondRun.alerted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("[Review Focus] evaluateBudgets scoped to one user never alerts on another user's spending", async () => {
    const db = drizzle(env.DB);
    const userB = await seedUserAndSession(db);
    const [own] = await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" }).returning();
    const [other] = await db.insert(budgets).values({ userId: userB.userId, category: "Coffee", limitAmount: 10000, periodType: "monthly" }).returning();
    await seedTransaction(db, userId, { amount: -8000 });
    await seedTransaction(db, userB.userId, { amount: -10000 });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBudgets(db, testEnv, userId);

    expect(result.alerted).toEqual(["Coffee"]);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [updated] = await db.select().from(budgets).where(eq(budgets.id, own.id));
    expect(updated.lastAlertedThreshold).toBe("80");
    expect(updated.lastAlertedPeriodStart).toBe(currentMonthDay(1));
    expect(await db.select().from(budgets).where(eq(budgets.id, other.id))).toEqual([other]);
  });
});
