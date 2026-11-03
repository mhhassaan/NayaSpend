import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { captureRuns } from "./db/schema";
import { GmailApiError } from "./adapters/gmailClient";
import { runCaptureScheduler } from "./services/captureScheduler";
import { checkCaptureHealth } from "./services/watchdog";
import { getGmailClient } from "./services/gmailCredentialStore";
import { evaluateBudgets } from "./services/budgetAlertTrigger";
import { evaluateBills } from "./services/billReminderTrigger";
import type { ConfigEnv } from "./config";
import { transactionsRoutes } from "./routes/transactions";
import { missedTransactionsRoutes } from "./routes/missedTransactions";
import { budgetsRoutes } from "./routes/budgets";
import { billsRoutes } from "./routes/bills";
import { trendsRoutes } from "./routes/trends";
import { statementsRoutes } from "./routes/statements";
import { captureRoutes } from "./routes/capture";
import { authGmailRoutes } from "./routes/authGmail";

type Env = ConfigEnv & {
  DB: D1Database;
  CAPTURE_RETRY_QUEUE: Queue;
};

const CAPTURE_CRON = "0 * * * *";
const WATCHDOG_CRON = "30 * * * *";

const app = new Hono<{ Bindings: Env }>();
app.route("/transactions", transactionsRoutes);
app.route("/missed-transactions", missedTransactionsRoutes);
app.route("/budgets", budgetsRoutes);
app.route("/bills", billsRoutes);
app.route("/trends", trendsRoutes);
app.route("/statements", statementsRoutes);
app.route("/capture", captureRoutes);
app.route("/auth/gmail", authGmailRoutes);

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
    client = await getGmailClient(drizzle(env.DB), env);
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
        // Every-6-hours budget/bill evaluation cron.
        const db = drizzle(env.DB);
        await evaluateBudgets(db, env);
        await evaluateBills(db, env);
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
          client = await getGmailClient(db, env);
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
