import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import worker from "../src/index";
import { captureRuns, gmailCredentials } from "../src/db/schema";
import { encryptToken } from "../src/security";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a",
  GMAIL_CLIENT_SECRET: "b",
  GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key",
  TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
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

  test("the watchdog cron actually calls the notification engine when capture_runs shows a failure", async () => {
    const db = drizzle(env.DB);
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

  test("the budget/bill cron is still a documented no-op (Phase 7 not built yet)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const controller = { cron: "0 */6 * * *", scheduledTime: Date.now() } as ScheduledController;
    const ctx = createExecutionContext();

    await worker.scheduled!(controller, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
