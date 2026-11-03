import type { DrizzleD1Database } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { categorize, normalize } from "../services/categorizationEngine";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type MissedTransactionInput = {
  vendorRaw: string;
  amountCents: number;
  date: string;
};

// The "log a missed transaction" fallback (CUJ 3) -- anything neither
// automated channel (Gmail, statement import) ever sees. Writes straight
// to committed with no idempotency key and no dedup check: the whole
// point of this action is to cover a gap those channels didn't.
export async function logMissedTransaction(
  db: DrizzleD1Database,
  input: MissedTransactionInput
): Promise<{ id: number; category: string }> {
  const vendorRaw = input.vendorRaw.trim();
  if (!vendorRaw) {
    throw new Error("vendorRaw is required");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }
  if (!ISO_DATE_PATTERN.test(input.date)) {
    throw new Error("date must be an ISO YYYY-MM-DD string");
  }

  const vendorNormalized = normalize(vendorRaw);
  const category = await categorize(db, vendorNormalized);

  const [row] = await db
    .insert(transactions)
    .values({
      amount: input.amountCents,
      date: input.date,
      vendorRaw,
      vendorNormalized,
      category,
      source: "manual_missed",
      provenance: "{}",
      reviewStatus: "committed",
    })
    .returning({ id: transactions.id, category: transactions.category });

  return row;
}
