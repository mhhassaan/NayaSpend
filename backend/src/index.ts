import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { gmailCredentials } from "./db/schema";
import { createGmailClient } from "./adapters/gmailClient";
import { runCaptureScheduler } from "./services/captureScheduler";
import { checkCaptureHealth } from "./services/watchdog";
import { loadConfig, type ConfigEnv } from "./config";
import { decryptToken } from "./security";

type Env = ConfigEnv & {
  DB: D1Database;
  CAPTURE_RETRY_QUEUE: Queue;
};

const CAPTURE_CRON = "0 * * * *";
const WATCHDOG_CRON = "30 * * * *";

const app = new Hono<{ Bindings: Env }>();

async function buildGmailClientFromStoredCredentials(env: Env) {
  const db = drizzle(env.DB);
  const [credentials] = await db.select().from(gmailCredentials);
  if (!credentials) return null;

  const config = loadConfig(env);
  const accessToken = await decryptToken(credentials.encryptedAccessToken, config.tokenEncryptionKey);
  return createGmailClient(accessToken);
}

async function dispatchCapture(env: Env) {
  const client = await buildGmailClientFromStoredCredentials(env);
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
    for (const message of batch.messages) {
      const client = await buildGmailClientFromStoredCredentials(env);
      if (!client) continue;
      const db = drizzle(env.DB);
      await runCaptureScheduler(db, client, env.CAPTURE_RETRY_QUEUE, message.body.attempt);
    }
  },
};
