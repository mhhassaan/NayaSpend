import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireAuth } from "./middleware/auth";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { bills, budgets, captureRuns, gmailCredentials } from "./db/schema";
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
import { authGoogleRoutes } from "./routes/authGoogle";

type Env = ConfigEnv & {
  DB: D1Database;
  CAPTURE_RETRY_QUEUE: Queue;
};

const CAPTURE_CRON = "0 * * * *";
const WATCHDOG_CRON = "30 * * * *";

const globalAuthGate: typeof requireAuth = (c, next) => {
  if (["/auth/google/login", "/auth/google/callback", "/auth/gmail/callback"].includes(c.req.path)) {
    return next();
  }
  return requireAuth(c, next);
};

// Chained (not separate statements) so `typeof app` carries every route's
// merged type -- each `.route()` call returns a new, more-specifically
// typed instance rather than mutating `app` in place. Separate statements
// would leave AppType reflecting only the instance before any route was
// attached, and hc<AppType>() would silently infer no routes at all.
const app = new Hono<{ Bindings: Env }>()
  .use("*", cors({ origin: (_origin, c) => c.env.FRONTEND_BASE_URL, credentials: true }))
  .use("*", globalAuthGate)
  .route("/transactions", transactionsRoutes)
  .route("/missed-transactions", missedTransactionsRoutes)
  .route("/budgets", budgetsRoutes)
  .route("/bills", billsRoutes)
  .route("/trends", trendsRoutes)
  .route("/statements", statementsRoutes)
  .route("/capture", captureRoutes)
  .route("/auth/gmail", authGmailRoutes)
  .route("/auth/google", authGoogleRoutes);

export type AppType = typeof app;

async function recordDispatchFailure(env: Env, err: unknown, userId: number) {
  const db = drizzle(env.DB);
  const [existing] = await db.select().from(captureRuns).where(eq(captureRuns.userId, userId));
  const values = {
    userId,
    lastAttemptedRun: new Date().toISOString(),
    runStatus: "api_call_failed" as const,
    errorType: err instanceof GmailApiError ? err.errorType : "unknown",
  };
  if (existing) {
    await db.update(captureRuns).set(values).where(and(eq(captureRuns.id, existing.id), eq(captureRuns.userId, userId)));
  } else {
    await db.insert(captureRuns).values(values);
  }
}

async function dispatchCapture(env: Env, ctx: ExecutionContext) {
  const db = drizzle(env.DB);
  const credentialRows = await db.select({ userId: gmailCredentials.userId }).from(gmailCredentials);
  for (const { userId } of credentialRows) {
    try {
      let client;
      try {
        client = await getGmailClient(db, env, userId);
      } catch (err) {
        // Credential failures happen before the scheduler can record them.
        await recordDispatchFailure(env, err, userId);
        throw err;
      }
      if (client) await runCaptureScheduler(db, client, env.CAPTURE_RETRY_QUEUE, userId, 1, { env, waitUntil: task => ctx.waitUntil(task) });
    } catch (err) {
      console.error(`capture dispatch failed for user ${userId}:`, err);
    }
  }
}

async function dispatchWatchdog(env: Env) {
  const db = drizzle(env.DB);
  const credentialRows = await db.select({ userId: gmailCredentials.userId }).from(gmailCredentials);
  for (const { userId } of credentialRows) {
    try {
      await checkCaptureHealth(db, env, userId);
    } catch (err) {
      console.error(`watchdog dispatch failed for user ${userId}:`, err);
    }
  }
}

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    try {
      if (event.cron === CAPTURE_CRON) {
        await dispatchCapture(env, _ctx);
      } else if (event.cron === WATCHDOG_CRON) {
        await dispatchWatchdog(env);
      } else {
        // Every-6-hours budget/bill evaluation cron.
        const db = drizzle(env.DB);
        const budgetRows = await db.select({ userId: budgets.userId }).from(budgets);
        const billRows = await db.select({ userId: bills.userId }).from(bills);
        const userIds = new Set([...budgetRows, ...billRows].map(row => row.userId));
        for (const userId of userIds) {
          try {
            await evaluateBudgets(db, env, userId);
          } catch (err) {
            console.error(`budget evaluation failed for user ${userId}:`, err);
          }
          try {
            await evaluateBills(db, env, userId);
          } catch (err) {
            console.error(`bill evaluation failed for user ${userId}:`, err);
          }
        }
      }
    } catch (err) {
      // A missing/invalid config (e.g. no Gmail connected, bad secrets)
      // must never crash the scheduled invocation itself.
      console.error(`scheduled handler failed for cron ${event.cron}:`, err);
    }
  },

  async queue(batch: MessageBatch<{ attempt: number; userId: number }>, env: Env, ctx?: ExecutionContext) {
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
          client = await getGmailClient(db, env, message.body.userId);
        } catch (err) {
          await recordDispatchFailure(env, err, message.body.userId);
          continue;
        }
        if (!client) continue;
        await runCaptureScheduler(db, client, env.CAPTURE_RETRY_QUEUE, message.body.userId, message.body.attempt, { env, waitUntil: ctx ? task => ctx.waitUntil(task) : undefined });
      } catch (err) {
        console.error("queue message processing failed:", err);
      } finally {
        message.ack();
      }
    }
  },
};
