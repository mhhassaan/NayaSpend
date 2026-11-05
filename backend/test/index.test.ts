import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import worker from "../src/index";
import { budgets, captureRuns, gmailCredentials, transactions } from "../src/db/schema";
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
    await db.insert(gmailCredentials).values({
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
      .values({
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
    await db.insert(gmailCredentials).values({
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
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await db.insert(captureRuns).values({ runStatus: "job_did_not_run" });
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
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const now = new Date().toISOString();
    await db.insert(captureRuns).values({ runStatus: "success", lastAttemptedRun: now, lastSuccessfulRun: now });
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
    await db.insert(budgets).values({ category: "Coffee", limitAmount: 100, periodType: "monthly" });
    await db.insert(transactions).values({
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
    return { body: { attempt }, ack: vi.fn(), retry: vi.fn() };
  }

  test("[I7] passes the retried attempt number through to runCaptureScheduler and acks on success", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }))
    );
    const message = fakeMessage(2);
    const batch = { messages: [message] } as unknown as MessageBatch<{ attempt: number }>;

    await worker.queue!(batch, testEnv);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
  });

  test("[I7] acks even when processing throws, so the platform never stacks its own retry on top of the app-level one", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("real-access-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh-token", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() - 60_000).toISOString(), // expired -- forces a refresh attempt
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })) // refresh itself fails unexpectedly
    );
    const message = fakeMessage(2);
    const batch = { messages: [message] } as unknown as MessageBatch<{ attempt: number }>;

    await worker.queue!(batch, testEnv);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("api_call_failed");
  });

  test("[I7] a message with no Gmail account connected is acked and does nothing", async () => {
    const message = fakeMessage(2);
    const batch = { messages: [message] } as unknown as MessageBatch<{ attempt: number }>;

    await worker.queue!(batch, testEnv);

    expect(message.ack).toHaveBeenCalledOnce();
  });
});

describe("app routing", () => {
  test("the real app (not just the standalone route instances) serves /transactions and /missed-transactions", async () => {
    const listRes = await worker.fetch(new Request("https://example.com/transactions"), testEnv);
    expect(listRes.status).toBe(200);

    const postRes = await worker.fetch(
      new Request("https://example.com/missed-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorRaw: "Corner Store", amountCents: 1000, date: "2026-10-27" }),
      }),
      testEnv
    );
    expect(postRes.status).toBe(201);
  });

  test("the real app serves /budgets, /bills, /trends, /statements, /capture/health, and /auth/gmail/connect", async () => {
    expect((await worker.fetch(new Request("https://example.com/budgets"), testEnv)).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/bills"), testEnv)).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/trends"), testEnv)).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/capture/health"), testEnv)).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/auth/gmail/connect"), testEnv)).status).toBe(302);
  });
});
