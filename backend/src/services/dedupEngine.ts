import { and, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { diceCoefficient } from "../utils/stringSimilarity";

const DATE_TOLERANCE_DAYS = 3;
const VENDOR_SIMILARITY_THRESHOLD = 0.5;
const CANDIDATE_LIMIT = 200; // bounds the comparison for backfill-scale data

const OTHER_SOURCE: Record<string, string | undefined> = {
  gmail_email: "statement_import",
  statement_import: "gmail_email",
};

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export async function runDedupCheck(
  db: DrizzleD1Database,
  transactionId: number
): Promise<{ matched: boolean; dedupGroupId: string | null }> {
  const [subject] = await db.select().from(transactions).where(eq(transactions.id, transactionId));

  const otherSource = subject ? OTHER_SOURCE[subject.source] : undefined;
  if (
    !subject ||
    subject.reviewStatus !== "committed" ||
    !otherSource ||
    subject.deletedAt !== null ||
    // Already matched (or already resolved by the user) -- never
    // re-grouped. Re-grouping an already-matched row would silently
    // orphan its original partner and could overwrite a user's
    // dedup_resolution decision.
    subject.dedupGroupId !== null
  ) {
    return { matched: false, dedupGroupId: null };
  }

  const earliestDate = shiftIsoDate(subject.date, -DATE_TOLERANCE_DAYS);
  const latestDate = shiftIsoDate(subject.date, DATE_TOLERANCE_DAYS);

  const candidates = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, subject.userId),
        eq(transactions.source, otherSource),
        eq(transactions.reviewStatus, "committed"),
        eq(transactions.amount, subject.amount),
        gte(transactions.date, earliestDate),
        lte(transactions.date, latestDate),
        ne(transactions.id, subject.id),
        isNull(transactions.dedupGroupId),
        isNull(transactions.deletedAt)
      )
    )
    // Closest date first, so the most plausible match wins when several
    // candidates fall inside the tolerance window.
    .orderBy(sql`ABS(julianday(${transactions.date}) - julianday(${subject.date}))`, transactions.id)
    .limit(CANDIDATE_LIMIT);

  const match = candidates.find(
    (candidate) =>
      diceCoefficient(subject.vendorNormalized, candidate.vendorNormalized) >= VENDOR_SIMILARITY_THRESHOLD
  );

  if (!match) {
    return { matched: false, dedupGroupId: null };
  }

  const dedupGroupId = crypto.randomUUID();
  await db.batch([
    db
      .update(transactions)
      .set({ dedupGroupId, dedupResolution: "pending" })
      .where(eq(transactions.id, subject.id)),
    db
      .update(transactions)
      .set({ dedupGroupId, dedupResolution: "pending" })
      .where(eq(transactions.id, match.id)),
  ]);

  return { matched: true, dedupGroupId };
}
