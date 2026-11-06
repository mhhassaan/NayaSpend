import { and, eq, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { budgets, transactions } from "../db/schema";
import { sendNotification } from "./notificationEngine";
import type { ConfigEnv } from "../config";

// Shared by budgetAlertTrigger and trendsService (Plan-Level Rulings): a
// transaction that is pending_review, soft-deleted, or one side of an
// unresolved dedup pair must never count toward a spent total or trend.
//
// dedupResolution is NULL for every non-dedup-checked row (manual_missed,
// and any committed row the dedup engine never paired) -- `!= 'pending'`
// alone excludes those rows too, since SQL's `NULL != 'pending'` is NULL,
// not true. The explicit isNull() keeps them included.
export function committedNotPendingDedup() {
  return and(
    eq(transactions.reviewStatus, "committed"),
    isNull(transactions.deletedAt),
    or(isNull(transactions.dedupResolution), ne(transactions.dedupResolution, "pending"))
  );
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// [Final review I3] thresholds are ranked, not just compared for equality:
// the debounce must suppress re-alerting the *same* crossing again, not
// suppress a *new, higher* crossing within the same month, and must not
// re-fire a *lower* one after spending drops back down.
const THRESHOLD_RANK: Record<string, number> = { "80": 1, "100": 2 };

function alreadyAlertedAtOrAbove(threshold: string, lastAlertedThreshold: string | null): boolean {
  if (!lastAlertedThreshold) return false;
  return THRESHOLD_RANK[lastAlertedThreshold] >= THRESHOLD_RANK[threshold];
}

export async function evaluateBudgets(
  db: DrizzleD1Database,
  env: Partial<ConfigEnv>,
  userId: number
): Promise<{ alerted: string[] }> {
  const monthStart = currentMonthStart();
  const monthPrefix = monthStart.slice(0, 7); // "YYYY-MM"
  const alerted: string[] = [];

  const allBudgets = await db.select().from(budgets).where(eq(budgets.userId, userId));

  for (const budget of allBudgets) {
    const spentRows = await db
      .select({ total: sql<number>`coalesce(sum(-${transactions.amount}), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.category, budget.category),
          like(transactions.date, `${monthPrefix}%`),
          committedNotPendingDedup(),
          lt(transactions.amount, 0)
        )
      );
    const spent = spentRows[0]?.total ?? 0;
    const percent = spent / budget.limitAmount;

    const threshold = percent >= 1 ? "100" : percent >= 0.8 ? "80" : null;
    if (threshold === null) continue;
    const sameMonth = monthStart === budget.lastAlertedPeriodStart;
    if (sameMonth && alreadyAlertedAtOrAbove(threshold, budget.lastAlertedThreshold)) continue;

    await sendNotification(env, {
      subject: `Budget alert: ${budget.category} at ${threshold}% of limit`,
      body: `You've spent ${spent} cents of your ${budget.limitAmount}-cent monthly budget for ${budget.category} (${threshold}% reached).`,
    });

    await db
      .update(budgets)
      .set({ lastAlertedThreshold: threshold, lastAlertedPeriodStart: monthStart })
      .where(eq(budgets.id, budget.id));

    alerted.push(budget.category);
  }

  return { alerted };
}
