import { and, like } from "drizzle-orm";
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
