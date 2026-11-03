import type { DrizzleD1Database } from "drizzle-orm/d1";
import { captureRuns } from "../db/schema";
import { runBackfill, runOngoingPoll } from "../adapters/gmailAdapter";
import type { GmailClient } from "../adapters/gmailClient";

export type QueueSender = {
  // Cloudflare's real Queue.send() resolves with a QueueSendResponse;
  // the fake queues used in tests resolve with undefined. Neither value
  // is used by the caller.
  send(message: unknown, options: { delaySeconds: number }): Promise<unknown>;
};

const MAX_ATTEMPTS = 3;
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
  attempt = 1
): Promise<void> {
  const [run] = await db.select().from(captureRuns);

  try {
    if (run?.backfillCompletedAt) {
      await runOngoingPoll(db, client);
    } else {
      await runBackfill(db, client);
    }
  } catch {
    // runBackfill/runOngoingPoll already catch and record GmailApiError
    // internally (per Phase 2/Task 3) rather than throwing -- this catch
    // only guards against an unexpected error escaping that handling.
  }

  const [refreshed] = await db.select().from(captureRuns);
  if (refreshed?.runStatus !== "api_call_failed") {
    return; // succeeded -- nothing to retry
  }

  if (attempt > MAX_ATTEMPTS) {
    return; // Watchdog's own cron picks this up from here
  }

  await queue.send({ attempt: attempt + 1 }, { delaySeconds: RETRY_DELAYS_SECONDS[attempt - 1] });
}
