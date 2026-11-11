import type { SuggestionOptions } from "./llmSuggestionService";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { captureRuns } from "../db/schema";
import { runBackfill, runOngoingPoll } from "../adapters/gmailAdapter";
import { GmailApiError } from "../adapters/gmailClient";
import type { GmailClient } from "../adapters/gmailClient";

export type QueueSender = {
  // Cloudflare's real Queue.send() resolves with a QueueSendResponse;
  // the fake queues used in tests resolve with undefined. Neither value
  // is used by the caller.
  send(message: unknown, options: { delaySeconds: number }): Promise<unknown>;
};

const MAX_RETRIES = 3; // 3 retries on top of the original attempt -- 4 total runs
const RETRY_DELAYS_SECONDS = [60, 300, 900]; // 1 min, 5 min, 15 min

/**
 * Hourly cron entrypoint. Chooses backfill-vs-ongoing-poll based on
 * whether backfill has completed, then calls the matching gmailAdapter
 * function (which already updates capture_runs itself). On a Gmail API
 * failure, retries via a Cloudflare Queue message with exponential
 * backoff -- never an in-process sleep -- up to 3 attempts; beyond that,
 * the already-recorded api_call_failed state is left for the Watchdog's
 * own cron to find.
 */
export async function runCaptureScheduler(
  db: DrizzleD1Database,
  client: GmailClient,
  queue: QueueSender,
  userId: number,
  attempt = 1,
  suggestions?: SuggestionOptions
): Promise<void> {
  const [run] = await db.select().from(captureRuns).where(eq(captureRuns.userId, userId));

  try {
    if (run?.backfillCompletedAt) {
      await runOngoingPoll(db, client, userId, suggestions);
    } else {
      await runBackfill(db, client, userId, suggestions);
    }
  } catch (err) {
    // runBackfill/runOngoingPoll already catch and record every Gmail API
    // failure internally (per Phase 2/Task 3) rather than throwing -- this
    // catch is for the genuinely unexpected case (e.g. getCurrentHistoryId
    // throwing while seeding, a D1 error, a bug in categorize/parse). Those
    // must still be recorded here: left unrecorded, run_status keeps its
    // previous value, so neither the retry below nor the Watchdog's own
    // staleness check would ever see this run as having failed.
    const [existing] = await db.select().from(captureRuns).where(eq(captureRuns.userId, userId));
    if (existing) {
      await db
        .update(captureRuns)
        .set({
          lastAttemptedRun: new Date().toISOString(),
          runStatus: "api_call_failed",
          errorType: err instanceof GmailApiError ? err.errorType : "unknown",
        })
        .where(and(eq(captureRuns.id, existing.id), eq(captureRuns.userId, userId)));
    }
  }

  const [refreshed] = await db.select().from(captureRuns).where(eq(captureRuns.userId, userId));
  if (refreshed?.runStatus !== "api_call_failed") {
    return; // succeeded -- nothing to retry
  }

  if (refreshed.errorType === "auth_failure") {
    // The credential itself is broken (expired/revoked refresh token, or
    // access-token refresh failed) -- retrying with the same broken
    // credential cannot succeed. Go straight to the Watchdog rather than
    // spending 3 retries finding that out.
    return;
  }

  if (attempt > MAX_RETRIES) {
    return; // Watchdog's own cron picks this up from here
  }

  await queue.send({ attempt: attempt + 1, userId }, { delaySeconds: RETRY_DELAYS_SECONDS[attempt - 1] });
}
