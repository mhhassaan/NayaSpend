import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { bills } from "../db/schema";
import { sendNotification } from "./notificationEngine";
import type { ConfigEnv } from "../config";

const LOOKAHEAD_DAYS = 3;
const MS_PER_DAY = 86_400_000;

function startOfTodayUtcMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export async function evaluateBills(
  db: DrizzleD1Database,
  env: Partial<ConfigEnv>
): Promise<{ reminded: string[] }> {
  const todayUtcMs = startOfTodayUtcMs();
  const reminded: string[] = [];

  const allBills = await db.select().from(bills);

  for (const bill of allBills) {
    const dueMs = Date.parse(bill.nextDueDate);
    const daysUntilDue = (dueMs - todayUtcMs) / MS_PER_DAY;

    if (daysUntilDue < 0 || daysUntilDue > LOOKAHEAD_DAYS) continue;
    if (bill.lastReminderSentForDueDate === bill.nextDueDate) continue;

    await sendNotification(env, {
      subject: `Bill reminder: ${bill.vendor} due ${bill.nextDueDate}`,
      body: `${bill.vendor} is due on ${bill.nextDueDate} for approximately ${bill.expectedAmount} cents.`,
    });

    await db
      .update(bills)
      .set({ lastReminderSentForDueDate: bill.nextDueDate })
      .where(eq(bills.id, bill.id));

    reminded.push(bill.vendor);
  }

  return { reminded };
}
