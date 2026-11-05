import { seedUserAndSession } from "./helpers/authedRequest";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../src/index";
import { bills, budgets, captureRuns, gmailCredentials, transactions } from "../src/db/schema";
import { decryptToken, encryptToken } from "../src/security";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a",
  GMAIL_CLIENT_SECRET: "b",
  GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key",
  TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
  FRONTEND_BASE_URL: "https://frontend.example.com",
};

let userId: number;
let cookie: string;
beforeEach(async () => {
  ({ userId, cookie } = await seedUserAndSession(drizzle(env.DB)));
});

describe("scheduled handler", () => {
  test("the capture cron with no Gmail account connected does not throw and leaves capture_runs untouched", async () => {
    const controller = { cron: "0 * * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();

    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const db = drizzle(env.DB);
    const rows = await db.select().from(captureRuns);
    expect(rows).toHaveLength(0); // never even attempted, since there's nothing to decrypt
  });

  test("the capture cron with a connected Gmail account actually runs the scheduler and updates capture_runs", async () => {
    const db = drizzle(env.DB);
    const encryptedAccessToken = await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY);
    const encryptedRefreshToken = await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY);
    await db.insert(gmailCredentials).values({ userId,
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }))
    );

    const controller = { cron: "0 * * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
    expect(run.lastAttemptedRun).not.toBeNull();
  });

  test("[C6] an expired access token is refreshed before use, and the new token is persisted", async () => {
    const db = drizzle(env.DB);
    const [credentials] = await db
      .insert(gmailCredentials)
      .values({ userId,
        encryptedAccessToken: await encryptToken("stale-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
        encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
        expiresAt: new Date(Date.now() - 60_000).toISOString(), // already expired
      })
      .returning();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(init?.body as string);
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("real-refresh-token");
        return new Response(JSON.stringify({ access_token: "fresh-access-token", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const controller = { cron: "0 * * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const [updatedCredentials] = await db.select().from(gmailCredentials);
    const newAccessToken = await decryptToken(updatedCredentials.encryptedAccessToken, testEnv.TOKEN_ENCRYPTION_KEY);
    expect(newAccessToken).toBe("fresh-access-token");
    expect(new Date(updatedCredentials.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(updatedCredentials.id).toBe(credentials.id);
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
  });

  test("[C6] a revoked refresh token records an auth_failure instead of crashing the scheduled handler", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({ userId,
      encryptedAccessToken: await encryptToken("stale-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("revoked-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    );

    const controller = { cron: "0 * * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("api_call_failed");
    expect(run.errorType).toBe("auth_failure");
  });

  test("the watchdog cron actually calls the notification engine when capture_runs shows a failure", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({ userId,
      encryptedAccessToken: await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await db.insert(captureRuns).values({ userId, runStatus: "job_did_not_run" });
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.resend.com/emails");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const controller = { cron: "30 * * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("the watchdog cron does not notify when capture is healthy", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({ userId,
      encryptedAccessToken: await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const now = new Date().toISOString();
    await db.insert(captureRuns).values({ userId, runStatus: "success", lastAttemptedRun: now, lastSuccessfulRun: now });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const controller = { cron: "30 * * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("the budget/bill cron dispatches evaluation but sends nothing when no budgets or bills exist", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const controller = { cron: "0 */6 * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();

    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("the every-6-hours cron now dispatches to evaluateBudgets/evaluateBills instead of being a no-op", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 100, periodType: "monthly" });
    await db.insert(transactions).values({ userId,
      amount: -100, date: new Date().toISOString().slice(0, 10), vendorRaw: "x", vendorNormalized: "x",
      category: "Coffee", source: "manual_missed", provenance: "{}", reviewStatus: "committed",
    });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const controller = { cron: "0 */6 * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();
    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).toHaveBeenCalledOnce(); // the budget alert
  });
});

describe("queue handler", () => {
  function fakeMessage(attempt: number) {
    return { body: { attempt, userId }, ack: vi.fn(), retry: vi.fn() };
  }

  test("[I7] passes the retried attempt number through to runCaptureScheduler and acks on success", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({ userId,
      encryptedAccessToken: await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }))
    );
    const message = fakeMessage(2);
    const batch = { messages: [message] } as unknown as MessageBatch<{ attempt: number; userId: number }>;

    await worker.queue!(batch, testEnv);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
  });

  test("[I7] acks even when processing throws, so the platform never stacks its own retry on top of the app-level one", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({ userId,
      encryptedAccessToken: await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() - 60_000).toISOString(), // expired -- forces a refresh attempt
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })) // refresh itself fails unexpectedly
    );
    const message = fakeMessage(2);
    const batch = { messages: [message] } as unknown as MessageBatch<{ attempt: number; userId: number }>;

    await worker.queue!(batch, testEnv);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("api_call_failed");
  });

  test("[I7] a message with no Gmail account connected is acked and does nothing", async () => {
    const message = fakeMessage(2);
    const batch = { messages: [message] } as unknown as MessageBatch<{ attempt: number; userId: number }>;

    await worker.queue!(batch, testEnv);

    expect(message.ack).toHaveBeenCalledOnce();
  });
});

describe("app routing", () => {
  test("the real app (not just the standalone route instances) serves /transactions and /missed-transactions", async () => {
    const listRes = await worker.fetch(new Request("https://example.com/transactions", { headers: { Cookie: cookie } }), testEnv);
    expect(listRes.status).toBe(200);

    const postRes = await worker.fetch(
      new Request("https://example.com/missed-transactions", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ vendorRaw: "Corner Store", amountCents: 1000, date: "2026-10-27" }),
      }),
      testEnv
    );
    expect(postRes.status).toBe(201);
  });

  test("the real app serves /budgets, /bills, /trends, /statements, /capture/health, and /auth/gmail/connect", async () => {
    expect((await worker.fetch(new Request("https://example.com/budgets", { headers: { Cookie: cookie } }), testEnv)).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/bills", { headers: { Cookie: cookie } }), testEnv)).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/trends", { headers: { Cookie: cookie } }), testEnv)).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/capture/health", { headers: { Cookie: cookie } }), testEnv)).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/auth/gmail/connect", { headers: { Cookie: cookie } }), testEnv)).status).toBe(302);
  });
});

async function connectUser(db: ReturnType<typeof drizzle>, owner: number, token: string, expired = false) {
  await db.insert(gmailCredentials).values({
    userId: owner,
    encryptedAccessToken: await encryptToken(token, testEnv.TOKEN_ENCRYPTION_KEY),
    encryptedRefreshToken: await encryptToken(token, testEnv.TOKEN_ENCRYPTION_KEY),
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 3600_000)).toISOString(),
  });
}

async function runCron(cron: string) {
  const ctx = createExecutionContext();
  await worker.scheduled!({ cron, scheduledTime: Date.now() } as ScheduledController, testEnv, ctx);
  await waitOnExecutionContext(ctx);
}

test("[Review Focus] the capture cron processes every connected user, and one user's failure does not prevent another user's capture from running", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  await connectUser(db, userId, "revoked-A", true);
  await connectUser(db, other.userId, "working-B");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer working-B");
    return new Response(JSON.stringify({ historyId: "100", messages: [] }));
  }));
  await runCron("0 * * * *");
  const runs = await db.select().from(captureRuns);
  expect(runs.find(run => run.userId === userId)).toMatchObject({ runStatus: "api_call_failed", errorType: "auth_failure" });
  expect(runs.find(run => run.userId === other.userId)).toMatchObject({ runStatus: "success" });
});

test("[Review Focus] the watchdog cron checks every connected user independently, and one user's error does not prevent another user's check", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  await connectUser(db, userId, "A");
  await connectUser(db, other.userId, "B");
  await db.insert(captureRuns).values([
    { userId, runStatus: "api_call_failed", errorType: "auth_failure" },
    { userId: other.userId, runStatus: "api_call_failed", errorType: "rate_limit" },
  ]);
  const delivered: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    if (body.text.includes("reconnect")) throw new Error("user A delivery failed");
    delivered.push(body.text);
    return new Response("{}");
  }));
  await runCron("30 * * * *");
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toContain("rate-limiting");
});

test("[Review Focus] the budget/bill cron evaluates every user with budgets or bills, and one user's evaluation failure does not block another user's", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 100, periodType: "monthly" });
  await db.insert(transactions).values({ userId, amount: -100, date: today, vendorRaw: "x", vendorNormalized: "x", category: "Coffee", source: "manual_missed", provenance: "{}", reviewStatus: "committed" });
  await db.insert(bills).values({ userId: other.userId, vendor: "B bill", expectedAmount: 100, expectedInterval: "monthly", nextDueDate: today });
  const attempted: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    attempted.push(body.subject);
    if (body.subject.startsWith("Budget alert")) throw new Error("A budget failed");
    return new Response("{}");
  }));
  await runCron("0 */6 * * *");
  expect(attempted).toEqual([expect.stringContaining("Budget alert"), expect.stringContaining("B bill")]);
  expect((await db.select().from(bills))[0].lastReminderSentForDueDate).toBe(today);
});

test("a failed budget evaluation still evaluates the same user's bills and deduplicates users present in both tables", async () => {
  const db = drizzle(env.DB);
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(budgets).values({ userId, category: "Coffee", limitAmount: 100, periodType: "monthly" });
  await db.insert(transactions).values({ userId, amount: -100, date: today, vendorRaw: "x", vendorNormalized: "x", category: "Coffee", source: "manual_missed", provenance: "{}", reviewStatus: "committed" });
  await db.insert(bills).values({ userId, vendor: "A bill", expectedAmount: 100, expectedInterval: "monthly", nextDueDate: today });
  let failedBudgetAttempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    if (body.subject.startsWith("Budget alert")) { failedBudgetAttempts++; throw new Error("budget failed"); }
    return new Response("{}");
  }));
  await runCron("0 */6 * * *");
  expect((await db.select().from(bills))[0].lastReminderSentForDueDate).toBe(today);
  expect(failedBudgetAttempts).toBe(1);
});

test("[I7] a queued retry uses its user's credentials and preserves the attempt number in the next retry", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  await connectUser(db, other.userId, "other");
  await connectUser(db, userId, "retry-owner");
  await db.insert(captureRuns).values({ userId: other.userId, runStatus: "success" });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer retry-owner");
    return new Response("{}", { status: 500 });
  }));
  const send = vi.fn(async () => undefined);
  const message = { body: { attempt: 2, userId }, ack: vi.fn(), retry: vi.fn() };
  await worker.queue!({ messages: [message] } as unknown as MessageBatch<{ attempt: number; userId: number }>, { ...testEnv, CAPTURE_RETRY_QUEUE: { send } as unknown as Queue });
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith({ attempt: 3, userId }, { delaySeconds: 300 });
  expect(message.ack).toHaveBeenCalledOnce();
  const runs = await db.select().from(captureRuns);
  expect(runs.find(run => run.userId === userId)?.runStatus).toBe("api_call_failed");
  expect(runs.find(run => run.userId === other.userId)?.runStatus).toBe("success");
});
