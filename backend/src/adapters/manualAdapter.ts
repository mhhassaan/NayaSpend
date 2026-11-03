import type { DrizzleD1Database } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { categorize, normalize } from "../services/categorizationEngine";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type MissedTransactionInput = {
  vendorRaw: string;
  amountCents: number;
  date: string;
};

// Distinguishes "the caller sent something this function won't accept"
// from an unexpected failure (a D1 error, a bug) -- the route layer maps
// only this one to a 400; everything else is a real server error.
export class ValidationError extends Error {}

function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE_PATTERN.test(date)) return false;
  // The regex alone accepts calendar-impossible values like
  // "2026-02-31" or "2026-13-01" -- JS's Date normalizes rather than
  // rejecting those (e.g. rolling Feb 31 into March), so round-tripping
  // through it and comparing catches what the regex can't.
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

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
    throw new ValidationError("vendorRaw is required");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ValidationError("amountCents must be a positive integer");
  }
  if (!isValidIsoDate(input.date)) {
    throw new ValidationError("date must be a valid ISO YYYY-MM-DD calendar date");
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
