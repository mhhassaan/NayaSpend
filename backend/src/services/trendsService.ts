import { and, gte, like, lt } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { committedNotPendingDedup } from "./budgetAlertTrigger";

export type MonthlyTrends = {
  month: string;
  totalCents: number;
  byCategory: { category: string; totalCents: number }[];
  hasData: boolean;
};

export async function getMonthlyTrends(db: DrizzleD1Database, month: string): Promise<MonthlyTrends> {
  const rows = await db
    .select({ category: transactions.category, amount: transactions.amount })
    .from(transactions)
    .where(and(like(transactions.date, `${month}%`), committedNotPendingDedup()));

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.amount);
  }

  const byCategory = Array.from(totals, ([category, totalCents]) => ({ category, totalCents }));
  const totalCents = byCategory.reduce((sum, c) => sum + c.totalCents, 0);

  return { month, totalCents, byCategory, hasData: rows.length > 0 };
}

function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = month0 + delta;
  return { year: year + Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

function monthKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

/**
 * Last `monthsCount` months (oldest to newest), ending at the current UTC
 * month. One query across the whole range, grouped in JS -- consistent
 * with getMonthlyTrends's own established approach at this data scale --
 * rather than monthsCount separate round trips to the single-month query.
 */
export async function getTrendsHistory(
  db: DrizzleD1Database,
  monthsCount: number
): Promise<{ months: MonthlyTrends[] }> {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth0 = now.getUTCMonth();

  const monthKeys: string[] = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const { year, month0 } = shiftMonth(currentYear, currentMonth0, -i);
    monthKeys.push(monthKey(year, month0));
  }

  const earliest = shiftMonth(currentYear, currentMonth0, -(monthsCount - 1));
  const afterLatest = shiftMonth(currentYear, currentMonth0, 1);
  const earliestDate = `${monthKey(earliest.year, earliest.month0)}-01`;
  const afterLatestDate = `${monthKey(afterLatest.year, afterLatest.month0)}-01`;

  const rows = await db
    .select({ date: transactions.date, category: transactions.category, amount: transactions.amount })
    .from(transactions)
    .where(and(gte(transactions.date, earliestDate), lt(transactions.date, afterLatestDate), committedNotPendingDedup()));

  const byMonth = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, new Map());
    const totals = byMonth.get(key)!;
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.amount);
  }

  const months = monthKeys.map((month) => {
    const totals = byMonth.get(month);
    const byCategory = totals ? Array.from(totals, ([category, totalCents]) => ({ category, totalCents })) : [];
    const totalCents = byCategory.reduce((sum, c) => sum + c.totalCents, 0);
    return { month, totalCents, byCategory, hasData: byCategory.length > 0 };
  });

  return { months };
}
