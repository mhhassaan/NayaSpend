import type { DrizzleD1Database } from "drizzle-orm/d1";
import { captureRuns, gmailCredentials } from "../db/schema";
import { sendNotification } from "./notificationEngine";
import type { ConfigEnv } from "../config";

const MISSED_RUN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 consecutive hourly runs

function reasonFor(run: { runStatus: string; errorType: string | null }): string {
  if (run.runStatus === "job_did_not_run") {
    return "The Gmail sync job didn't run.";
  }
  switch (run.errorType) {
    case "auth_failure":
      return "Gmail access expired — reconnect your account.";
    case "rate_limit":
      return "Gmail is rate-limiting requests.";
    case "network_timeout":
      return "Gmail sync is failing due to a network timeout.";
    default:
      return "Gmail sync is failing for an unknown reason.";
  }
}

/**
 * Watches the capture mechanism's own health (did the scheduled job run,
 * did its Gmail API call succeed) -- never whether any matching email was
 * found. A successful run with zero new messages is healthy.
 */
export async function checkCaptureHealth(
  db: DrizzleD1Database,
  env: Partial<ConfigEnv>
): Promise<{ escalated: boolean }> {
  const [run] = await db.select().from(captureRuns);
  const [credentials] = await db.select().from(gmailCredentials);

  // Nothing connected yet -- there is no job that should be running, so
  // silence is healthy, not an error.
  if (!credentials) {
    return { escalated: false };
  }

  const now = Date.now();
  const lastAttempted = run?.lastAttemptedRun ? new Date(run.lastAttemptedRun).getTime() : null;
  const attemptsAreStale = lastAttempted === null || now - lastAttempted >= MISSED_RUN_THRESHOLD_MS;

  if (!run || run.runStatus === "success") {
    // A connected account means capture should be attempting a run every
    // hour, success or failure -- lastAttemptedRun is updated on every
    // single path through runBackfill/runOngoingPoll/the scheduler's own
    // failure handling. A frozen "success" looks healthy by status alone,
    // so this is the only way to tell the cron has actually stopped
    // firing entirely rather than just not finding anything new.
    if (attemptsAreStale) {
      await sendNotification(env, {
        subject: "NayaSpend: Gmail capture issue",
        body: "The Gmail sync job hasn't run recently.",
      });
      return { escalated: true };
    }
    return { escalated: false };
  }

  const lastSuccessful = run.lastSuccessfulRun ? new Date(run.lastSuccessfulRun).getTime() : null;
  const missedTwoConsecutiveRuns =
    lastSuccessful === null || now - lastSuccessful >= MISSED_RUN_THRESHOLD_MS;

  if (!missedTwoConsecutiveRuns) {
    // Only one run has failed so far -- within the 2-consecutive-miss
    // window, not yet an escalation.
    return { escalated: false };
  }

  await sendNotification(env, {
    subject: "NayaSpend: Gmail capture issue",
    body: reasonFor(run),
  });

  return { escalated: true };
}
