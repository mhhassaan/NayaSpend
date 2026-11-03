import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { captureRuns, transactions } from "../db/schema";
import { categorize, normalize } from "../services/categorizationEngine";
import { runDedupCheck } from "../services/dedupEngine";
import { GmailApiError, NAYAPAY_QUERY } from "./gmailClient";
import type { GmailClient, GmailMessage } from "./gmailClient";
import { parseNayaPayEmail } from "./parseNayaPayEmail";

const DEFAULT_MAX_MESSAGES_PER_CHUNK = 50;
const BODY_EXCERPT_LENGTH = 500;

type TransactionInsert = typeof transactions.$inferInsert;

async function getOrCreateCaptureRun(db: DrizzleD1Database) {
  const [existing] = await db.select().from(captureRuns);
  if (existing) return existing;

  await db.insert(captureRuns).values({ runStatus: "job_did_not_run" });
  const [created] = await db.select().from(captureRuns);
  return created;
}

function buildCommittedRow(message: GmailMessage, category: string, parsed: {
  amountCents: number;
  date: string;
  vendorRaw: string;
}): TransactionInsert {
  return {
    amount: parsed.amountCents,
    date: parsed.date,
    vendorRaw: parsed.vendorRaw,
    vendorNormalized: normalize(parsed.vendorRaw),
    category,
    source: "gmail_email",
    reviewStatus: "committed",
    gmailMessageId: message.id,
    provenance: JSON.stringify({
      gmailMessageId: message.id,
      threadId: message.threadId,
      parserVersion: 1,
      subject: message.subject,
      bodyExcerpt: message.bodyText.slice(0, BODY_EXCERPT_LENGTH),
    }),
  };
}

function buildQuarantinedRow(message: GmailMessage, reason: string): TransactionInsert {
  return {
    amount: 0,
    date: new Date(Number(message.internalDate)).toISOString().slice(0, 10),
    vendorRaw: message.from,
    vendorNormalized: normalize(message.from),
    category: "Uncategorized",
    source: "gmail_email",
    reviewStatus: "pending_review",
    gmailMessageId: message.id,
    provenance: JSON.stringify({
      gmailMessageId: message.id,
      threadId: message.threadId,
      parserVersion: 1,
      quarantineReason: reason,
      subject: message.subject,
      bodyExcerpt: message.bodyText.slice(0, BODY_EXCERPT_LENGTH),
    }),
  };
}

export async function runBackfill(
  db: DrizzleD1Database,
  client: GmailClient,
  options?: { maxMessagesPerChunk?: number }
): Promise<{ processed: number; nextPageToken: string | null }> {
  const maxMessagesPerChunk = options?.maxMessagesPerChunk ?? DEFAULT_MAX_MESSAGES_PER_CHUNK;

  const run = await getOrCreateCaptureRun(db);

  // backfillPageToken alone can't distinguish "backfill finished" from
  // "backfill never started" -- both leave it null. backfillCompletedAt
  // is the authoritative marker; once set, never contact Gmail again.
  if (run.backfillCompletedAt) {
    return { processed: 0, nextPageToken: null };
  }

  const currentToken = run.backfillPageToken ?? undefined;
  const attemptedAt = new Date().toISOString();

  let listResult: { messages: { id: string }[]; nextPageToken?: string };
  try {
    listResult = await client.listMessages(currentToken, maxMessagesPerChunk);
  } catch (err) {
    // Checkpoint is left untouched -- a retry resumes from the same page
    // rather than silently treating an auth/rate-limit failure as "no
    // more mail, backfill done".
    await db
      .update(captureRuns)
      .set({
        lastAttemptedRun: attemptedAt,
        runStatus: "api_call_failed",
        errorType: err instanceof GmailApiError ? err.errorType : "unknown",
      })
      .where(eq(captureRuns.id, run.id));
    return { processed: 0, nextPageToken: currentToken ?? null };
  }

  const { messages, nextPageToken } = listResult;

  // Build every row to write entirely in memory first; nothing is written
  // to D1 until the single batch call below, so a Worker crash partway
  // through this loop leaves zero partial writes and an unmoved checkpoint
  // -- a retry simply redoes this chunk from scratch, not from a
  // half-written state.
  const rowsToInsert: TransactionInsert[] = [];
  let committedCount = 0;
  let quarantinedCount = 0;
  let fetchFailedCount = 0;

  for (const { id } of messages) {
    let message: GmailMessage;
    try {
      message = await client.getMessage(id);
    } catch {
      // A single message failing to fetch (deleted, transient error) must
      // not abort the rest of the chunk. No row is written for it -- it
      // was never fetched, so there is nothing yet to quarantine.
      fetchFailedCount++;
      continue;
    }

    const parsed = parseNayaPayEmail(message);

    if (parsed.confidence === "high") {
      const category = await categorize(db, parsed.vendorRaw);
      rowsToInsert.push(buildCommittedRow(message, category, parsed));
      committedCount++;
    } else {
      rowsToInsert.push(buildQuarantinedRow(message, parsed.reason));
      quarantinedCount++;
    }
  }

  const backfillFinished = !nextPageToken;
  const resolvedNextPageToken = nextPageToken ?? null;

  const checkpointUpdate = db
    .update(captureRuns)
    .set({
      backfillPageToken: resolvedNextPageToken,
      backfillCompletedAt: backfillFinished ? attemptedAt : null,
      lastAttemptedRun: attemptedAt,
      lastSuccessfulRun: attemptedAt,
      runStatus: "success",
      errorType: null,
    })
    .where(eq(captureRuns.id, run.id));

  // Idempotent on gmail_message_id: a retried chunk that re-inserts an
  // already-committed message is a no-op, never a duplicate transaction.
  // .returning() lets us dedup-check exactly the rows actually inserted
  // (onConflictDoNothing means a given statement may insert nothing).
  const insertStatements = rowsToInsert.map((values) =>
    db
      .insert(transactions)
      .values(values)
      .onConflictDoNothing({ target: transactions.gmailMessageId })
      .returning({ id: transactions.id, reviewStatus: transactions.reviewStatus })
  );

  if (insertStatements.length > 0) {
    const batchResults = await db.batch([insertStatements[0], ...insertStatements.slice(1), checkpointUpdate]);
    const insertResults = batchResults.slice(0, insertStatements.length) as { id: number; reviewStatus: string }[][];

    // Dedup-checking happens after the batch commits (it reads already-
    // durable committed rows, per the spec's "only compares committed
    // against committed" rule) and only for rows this call actually
    // inserted, never for a quarantined row or one skipped as a duplicate.
    for (const rows of insertResults) {
      for (const row of rows) {
        if (row.reviewStatus === "committed") {
          await runDedupCheck(db, row.id);
        }
      }
    }
  } else {
    await checkpointUpdate;
  }

  // Diagnostic trail only (not an automated alert) -- lets a developer
  // later tell a NayaPay template/sender change from normal inactivity.
  console.log(
    JSON.stringify({
      query: NAYAPAY_QUERY,
      scanned: messages.length,
      committed: committedCount,
      quarantined: quarantinedCount,
      fetchFailed: fetchFailedCount,
    })
  );

  return { processed: committedCount + quarantinedCount, nextPageToken: resolvedNextPageToken };
}
