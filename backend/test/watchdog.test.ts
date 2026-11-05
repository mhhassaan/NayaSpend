import { seedUserAndSession } from "./helpers/authedRequest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { captureRuns, gmailCredentials } from "../src/db/schema";
import { checkCaptureHealth } from "../src/services/watchdog";

async function connectGmail(db: ReturnType<typeof drizzle>) {
  await db.insert(gmailCredentials).values({ userId,
    encryptedAccessToken: "fake",
    encryptedRefreshToken: "fake",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
}

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a",
  GMAIL_CLIENT_SECRET: "b",
  GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key",
  TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
};

let userId: number;
beforeEach(async () => {
  ({ userId } = await seedUserAndSession(drizzle(env.DB)));
});

describe("checkCaptureHealth", () => {
  test("no Gmail account connected yet is healthy, not escalated -- there is no job that should be running", async () => {
    const db = drizzle(env.DB);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv, userId);

    expect(result.escalated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a successful run with zero new messages is healthy, not escalated", async () => {
    const db = drizzle(env.DB);
    await connectGmail(db);
    const now = new Date().toISOString();
    await db.insert(captureRuns).values({ userId, runStatus: "success", lastAttemptedRun: now, lastSuccessfulRun: now });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv, userId);

    expect(result.escalated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a recent single failure within the 2-run window is not yet escalated", async () => {
    const db = drizzle(env.DB);
    await connectGmail(db);
    const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    await db.insert(captureRuns).values({ userId,
      runStatus: "api_call_failed",
      errorType: "network_timeout",
      lastAttemptedRun: fortyMinutesAgo,
      lastSuccessfulRun: fortyMinutesAgo,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv, userId);

    expect(result.escalated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("2 consecutive non-successful runs escalate with the specific error_type", async () => {
    const db = drizzle(env.DB);
    await connectGmail(db);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.insert(captureRuns).values({ userId,
      runStatus: "api_call_failed",
      errorType: "auth_failure",
      lastAttemptedRun: twoHoursAgo,
      lastSuccessfulRun: null,
    });
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.subject).toContain("Gmail");
      expect(body.text).toContain("reconnect");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv, userId);

    expect(result.escalated).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("2 consecutive rate_limit failures escalate naming rate-limiting specifically", async () => {
    const db = drizzle(env.DB);
    await connectGmail(db);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.insert(captureRuns).values({ userId,
      runStatus: "api_call_failed",
      errorType: "rate_limit",
      lastAttemptedRun: twoHoursAgo,
      lastSuccessfulRun: null,
    });
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.text.toLowerCase()).toContain("rate");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv, userId);

    expect(result.escalated).toBe(true);
  });

  test("a job that simply never ran (job_did_not_run, no lastSuccessfulRun ever) escalates with that specific reason", async () => {
    const db = drizzle(env.DB);
    await connectGmail(db);
    await db.insert(captureRuns).values({ userId, runStatus: "job_did_not_run" });
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("didn't run");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv, userId);

    expect(result.escalated).toBe(true);
  });

  test("[C4] a stale 'success' row (the cron itself stopped firing) escalates even though runStatus looks healthy", async () => {
    const db = drizzle(env.DB);
    await connectGmail(db);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await db.insert(captureRuns).values({ userId,
      runStatus: "success",
      lastAttemptedRun: threeHoursAgo,
      lastSuccessfulRun: threeHoursAgo,
    });
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("hasn't run recently");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv, userId);

    expect(result.escalated).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("[C4] a connected account with no capture_runs row at all (cron never fired even once) escalates", async () => {
    const db = drizzle(env.DB);
    await connectGmail(db);
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("hasn't run recently");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv, userId);

    expect(result.escalated).toBe(true);
  });
});

test("[Review Focus] watchdog compares only the requested user's credentials and capture state", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  await db.insert(gmailCredentials).values({ userId: other.userId, encryptedAccessToken: "fake", encryptedRefreshToken: "fake", expiresAt: new Date().toISOString() });
  await db.insert(captureRuns).values({ userId: other.userId, runStatus: "api_call_failed", errorType: "auth_failure" });
  const fetchSpy = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchSpy);
  expect(await checkCaptureHealth(db, testEnv, userId)).toEqual({ escalated: false });
  expect(fetchSpy).not.toHaveBeenCalled();
  await connectGmail(db);
  const now = new Date().toISOString();
  await db.insert(captureRuns).values({ userId, runStatus: "success", lastAttemptedRun: now, lastSuccessfulRun: now });
  expect(await checkCaptureHealth(db, testEnv, userId)).toEqual({ escalated: false });
  expect(fetchSpy).not.toHaveBeenCalled();
});
