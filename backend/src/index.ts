import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { captureRuns, gmailCredentials } from "./db/schema";
import { createGmailClient, GmailApiError } from "./adapters/gmailClient";
import { runCaptureScheduler } from "./services/captureScheduler";
import { checkCaptureHealth } from "./services/watchdog";
import { refreshAccessToken } from "./services/gmailTokenRefresh";
import { loadConfig, type ConfigEnv } from "./config";
import { decryptToken, encryptToken } from "./security";
import { transactionsRoutes } from "./routes/transactions";
import { missedTransactionsRoutes } from "./routes/missedTransactions";

type Env = ConfigEnv & {
  DB: D1Database;
  CAPTURE_RETRY_QUEUE: Queue;
};

const CAPTURE_CRON = "0 * * * *";
const WATCHDOG_CRON = "30 * * * *";
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000; // refresh a few minutes before Google would reject it

async function buildGmailClientFromStoredCredentials(env: Env) {
  const db = drizzle(env.DB);
  const [credentials] = await db.select().from(gmailCredentials);
  if (!credentials) return null;

  const config = loadConfig(env);
  const expiresAt = new Date(credentials.expiresAt).getTime();

  // Google access tokens last ~1 hour -- without this, every poll past
  // the first would fail with 401 the moment the stored token expires.
  if (Date.now() >= expiresAt - TOKEN_EXPIRY_SKEW_MS) {
    const refreshToken = await decryptToken(credentials.encryptedRefreshToken, config.tokenEncryptionKey);
    const refreshed = await refreshAccessToken(
      { gmailClientId: config.gmailClientId, gmailClientSecret: config.gmailClientSecret },
      refreshToken
    );
    const encryptedAccessToken = await encryptToken(refreshed.accessToken, config.tokenEncryptionKey);
    await db
      .update(gmailCredentials)
      .set({ encryptedAccessToken, expiresAt: refreshed.expiresAt })
      .where(eq(gmailCredentials.id, credentials.id));
    return createGmailClient(refreshed.accessToken);
  }

  const accessToken = await decryptToken(credentials.encryptedAccessToken, config.tokenEncryptionKey);
  return createGmailClient(accessToken);
}

const app = new Hono<{ Bindings: Env }>();
app.route("/transactions", transactionsRoutes);
app.route("/missed-transactions", missedTransactionsRoutes);

async function recordDispatchFailure(env: Env, err: unknown) {
  const db = drizzle(env.DB);
  const [existing] = await db.select().from(captureRuns);
  const values = {
    lastAttemptedRun: new Date().toISOString(),
    runStatus: "api_call_failed" as const,
    errorType: err instanceof GmailApiError ? err.errorType : "unknown",
  };
  if (existing) {
    await db.update(captureRuns).set(values).where(eq(captureRuns.id, existing.id));
  } else {
    await db.insert(captureRuns).values(values);
  }
}

async function dispatchCapture(env: Env) {
  let client;
  try {
    client = await buildGmailClientFromStoredCredentials(env);
  } catch (err) {
    // A broken refresh (revoked/expired refresh_token, Gmail outage) must
    // still be recorded -- this happens before runCaptureScheduler's own
    // error handling ever runs, so nothing else will record it.
    await recordDispatchFailure(env, err);
    return;
  }
  if (!client) {
    // No Gmail account connected yet -- nothing to poll. Not an error
    // (CUJ 1 hasn't happened yet for this user).
    return;
  }
  const db = drizzle(env.DB);
  await runCaptureScheduler(db, client, env.CAPTURE_RETRY_QUEUE);
}

async function dispatchWatchdog(env: Env) {
  const db = drizzle(env.DB);
  await checkCaptureHealth(db, env);
}

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    try {
      if (event.cron === CAPTURE_CRON) {
        await dispatchCapture(env);
      } else if (event.cron === WATCHDOG_CRON) {
        await dispatchWatchdog(env);
      } else {
        // Every-6-hours budget/bill evaluation cron: intentionally a
        // no-op until Phase 7 builds budgetAlertTrigger/billReminderTrigger.
      }
    } catch (err) {
      // A missing/invalid config (e.g. no Gmail connected, bad secrets)
      // must never crash the scheduled invocation itself.
      console.error(`scheduled handler failed for cron ${event.cron}:`, err);
    }
  },

  async queue(batch: MessageBatch<{ attempt: number }>, env: Env) {
    const db = drizzle(env.DB);
    for (const message of batch.messages) {
      // Each message is acked regardless of outcome: runCaptureScheduler
      // (and recordDispatchFailure before it) already owns the
      // application-level retry chain via its own queue.send calls with
      // explicit backoff. Leaving a message unacked would let Cloudflare's
      // platform-level queue retry stack a second, uncoordinated retry
      // chain on top of that one.
      try {
        let client;
        try {
          client = await buildGmailClientFromStoredCredentials(env);
        } catch (err) {
          await recordDispatchFailure(env, err);
          continue;
        }
        if (!client) continue;
        await runCaptureScheduler(db, client, env.CAPTURE_RETRY_QUEUE, message.body.attempt);
      } catch (err) {
        console.error("queue message processing failed:", err);
      } finally {
        message.ack();
      }
    }
  },
};
