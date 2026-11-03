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

// Ongoing polling's history.list has no `q` filter (unlike listMessages,
// which already scopes server-side via NAYAPAY_QUERY) -- this re-checks
// the same sender/subject condition per-message so a poll never stores a
// row for unrelated mail that happens to land in the inbox.
function matchesNayaPayScope(message: GmailMessage): boolean {
  return (
    message.from.toLowerCase().includes("nayapay.com") &&
    message.subject.toLowerCase().includes("you spent")
  );
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

type FetchAndBuildResult = {
  rows: TransactionInsert[];
  committedCount: number;
  quarantinedCount: number;
  fetchFailedCount: number;
  skippedCount: number;
};

// Shared by runBackfill and runOngoingPoll: fetch each message id, parse
// it, and build the row it should become. Never writes to D1 itself --
// callers insert `rows` as part of their own atomic checkpoint batch.
async function fetchAndBuildRows(
  db: DrizzleD1Database,
  client: GmailClient,
  ids: string[],
  options?: { enforceScope?: boolean }
): Promise<FetchAndBuildResult> {
  const rows: TransactionInsert[] = [];
  let committedCount = 0;
  let quarantinedCount = 0;
  let fetchFailedCount = 0;
  let skippedCount = 0;

  for (const id of ids) {
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

    if (options?.enforceScope && !matchesNayaPayScope(message)) {
      // Ongoing polling's history.list returns every added message in
      // the inbox, not just NayaPay mail -- skip anything else outright,
      // write no row, so the review queue never fills with unrelated mail.
      skippedCount++;
      continue;
    }

    const parsed = parseNayaPayEmail(message);

    if (parsed.confidence === "high") {
      const category = await categorize(db, parsed.vendorRaw);
      rows.push(buildCommittedRow(message, category, parsed));
      committedCount++;
    } else {
      rows.push(buildQuarantinedRow(message, parsed.reason));
      quarantinedCount++;
    }
  }

  return { rows, committedCount, quarantinedCount, fetchFailedCount, skippedCount };
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

  async function recordFailure(err: unknown, resumeToken: string | null) {
    await db
      .update(captureRuns)
      .set({
        lastAttemptedRun: attemptedAt,
        runStatus: "api_call_failed",
        errorType: err instanceof GmailApiError ? err.errorType : "unknown",
      })
      .where(eq(captureRuns.id, run.id));
    return { processed: 0, nextPageToken: resumeToken };
  }

  // Seeded once, on this row's very first-ever call, *before* the first
  // page is listed -- not at backfill completion. Backfill can span many
  // hourly chunks; seeding only at the end would miss any mail that
  // arrived during those chunks (the gap this historyId is supposed to
  // close). Seeding up front means ongoing polling, once it takes over,
  // naturally re-covers that whole window -- overlap, never a gap, and
  // the gmail_message_id idempotency key absorbs the overlap for free.
  let seededPollingHistoryId: string | undefined;
  if (run.pollingHistoryId == null) {
    try {
      seededPollingHistoryId = await client.getCurrentHistoryId();
    } catch (err) {
      // Checkpoint is left untouched -- a retry resumes from the same page
      // rather than silently treating an auth/rate-limit failure as "no
      // more mail, backfill done".
      return recordFailure(err, currentToken ?? null);
    }
  }

  let listResult: { messages: { id: string }[]; nextPageToken?: string };
  try {
    listResult = await client.listMessages(currentToken, maxMessagesPerChunk);
  } catch (err) {
    return recordFailure(err, currentToken ?? null);
  }

  const { messages, nextPageToken } = listResult;

  // Build every row to write entirely in memory first; nothing is written
  // to D1 until the single batch call below, so a Worker crash partway
  // through this loop leaves zero partial writes and an unmoved checkpoint
  // -- a retry simply redoes this chunk from scratch, not from a
  // half-written state.
  const { rows: rowsToInsert, committedCount, quarantinedCount, fetchFailedCount } = await fetchAndBuildRows(
    db,
    client,
    messages.map((m) => m.id)
  );

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
      ...(seededPollingHistoryId !== undefined ? { pollingHistoryId: seededPollingHistoryId } : {}),
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
    // A failure here (e.g. a transient D1 error) must not undo or lose
    // the capture itself -- the transaction rows and checkpoint are
    // already durably committed above, so a dedup-check failure is
    // logged and skipped, not thrown.
    for (const rows of insertResults) {
      for (const row of rows) {
        if (row.reviewStatus === "committed") {
          try {
            await runDedupCheck(db, row.id);
          } catch (err) {
            console.error(`dedup check failed for transaction ${row.id}:`, err);
          }
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

/**
 * Forward (ongoing) polling via Gmail's historyId watermark -- a
 * completely separate mechanism from runBackfill's backward pageToken
 * paging. Shares the same row-building, idempotency (gmail_message_id),
 * batching, and dedup-check-after-batch structure.
 */
export async function runOngoingPoll(
  db: DrizzleD1Database,
  client: GmailClient,
  options?: { maxMessagesPerChunk?: number }
): Promise<{ processed: number }> {
  const maxMessagesPerChunk = options?.maxMessagesPerChunk ?? DEFAULT_MAX_MESSAGES_PER_CHUNK;

  const run = await getOrCreateCaptureRun(db);
  const attemptedAt = new Date().toISOString();

  async function recordFailure(err: unknown) {
    await db
      .update(captureRuns)
      .set({
        lastAttemptedRun: attemptedAt,
        runStatus: "api_call_failed",
        errorType: err instanceof GmailApiError ? err.errorType : "unknown",
      })
      .where(eq(captureRuns.id, run.id));
    return { processed: 0 };
  }

  if (!run.pollingHistoryId) {
    // Self-heal: a pre-existing row from before this watermark column
    // existed can have backfillCompletedAt set with pollingHistoryId
    // still null. Seed it now rather than silently never polling again
    // -- lastAttemptedRun is still updated either way, so the Watchdog's
    // staleness check always has a fresh timestamp to look at.
    try {
      const pollingHistoryId = await client.getCurrentHistoryId();
      await db
        .update(captureRuns)
        .set({ pollingHistoryId, lastAttemptedRun: attemptedAt, runStatus: "success", errorType: null })
        .where(eq(captureRuns.id, run.id));
      return { processed: 0 };
    } catch (err) {
      return recordFailure(err);
    }
  }

  // Page through every history record, not just the first maxResults --
  // a gap of more than one page would otherwise be skipped permanently
  // the moment the watermark jumps to the response's historyId.
  let addedMessageIds: string[] = [];
  let newHistoryId = run.pollingHistoryId;
  try {
    let pageToken: string | undefined;
    do {
      const page = await client.listHistory(run.pollingHistoryId, maxMessagesPerChunk, pageToken);
      addedMessageIds = addedMessageIds.concat(page.addedMessageIds);
      newHistoryId = page.newHistoryId;
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err) {
    if (err instanceof GmailApiError && err.errorType === "history_expired") {
      // The watermark is too old for Gmail to resolve (a long outage).
      // Reseed to the current historyId so polling isn't stuck forever;
      // anything from the gap is not recoverable via history and relies
      // on the statement-import backstop (a CSV import of the same
      // period will dedup-match anything Gmail already captured).
      try {
        const reseededHistoryId = await client.getCurrentHistoryId();
        await db
          .update(captureRuns)
          .set({
            pollingHistoryId: reseededHistoryId,
            lastAttemptedRun: attemptedAt,
            runStatus: "api_call_failed",
            errorType: "history_expired",
          })
          .where(eq(captureRuns.id, run.id));
        return { processed: 0 };
      } catch (reseedErr) {
        return recordFailure(reseedErr);
      }
    }
    return recordFailure(err);
  }

  const { rows: rowsToInsert, committedCount, quarantinedCount, fetchFailedCount, skippedCount } =
    await fetchAndBuildRows(db, client, addedMessageIds, { enforceScope: true });

  // If any message in this batch failed to fetch, do not advance the
  // watermark past it -- Gmail has no later page to bring it back on,
  // unlike backfill. Leaving the watermark unchanged means the next poll
  // asks for the same history range again; gmail_message_id idempotency
  // absorbs the messages already committed this run.
  const nextPollingHistoryId = fetchFailedCount > 0 ? run.pollingHistoryId : newHistoryId;

  const checkpointUpdate = db
    .update(captureRuns)
    .set({
      pollingHistoryId: nextPollingHistoryId,
      lastAttemptedRun: attemptedAt,
      lastSuccessfulRun: attemptedAt,
      runStatus: "success",
      errorType: null,
    })
    .where(eq(captureRuns.id, run.id));

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

    for (const rows of insertResults) {
      for (const row of rows) {
        if (row.reviewStatus === "committed") {
          try {
            await runDedupCheck(db, row.id);
          } catch (err) {
            console.error(`dedup check failed for transaction ${row.id}:`, err);
          }
        }
      }
    }
  } else {
    await checkpointUpdate;
  }

  console.log(
    JSON.stringify({
      query: NAYAPAY_QUERY,
      scanned: addedMessageIds.length,
      committed: committedCount,
      quarantined: quarantinedCount,
      fetchFailed: fetchFailedCount,
      skipped: skippedCount,
    })
  );

  return { processed: committedCount + quarantinedCount };
}
