import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { captureRuns } from "../src/db/schema";
import { checkCaptureHealth } from "../src/services/watchdog";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a",
  GMAIL_CLIENT_SECRET: "b",
  GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key",
  TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
};

describe("checkCaptureHealth", () => {
  test("a successful run with zero new messages is healthy, not escalated", async () => {
    const db = drizzle(env.DB);
    const now = new Date().toISOString();
    await db.insert(captureRuns).values({ runStatus: "success", lastAttemptedRun: now, lastSuccessfulRun: now });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv);

    expect(result.escalated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a recent single failure within the 2-run window is not yet escalated", async () => {
    const db = drizzle(env.DB);
    const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    await db.insert(captureRuns).values({
      runStatus: "api_call_failed",
      errorType: "network_timeout",
      lastAttemptedRun: fortyMinutesAgo,
      lastSuccessfulRun: fortyMinutesAgo,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv);

    expect(result.escalated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("2 consecutive non-successful runs escalate with the specific error_type", async () => {
    const db = drizzle(env.DB);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.insert(captureRuns).values({
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

    const result = await checkCaptureHealth(db, testEnv);

    expect(result.escalated).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("2 consecutive rate_limit failures escalate naming rate-limiting specifically", async () => {
    const db = drizzle(env.DB);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.insert(captureRuns).values({
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

    const result = await checkCaptureHealth(db, testEnv);

    expect(result.escalated).toBe(true);
  });

  test("a job that simply never ran (job_did_not_run, no lastSuccessfulRun ever) escalates with that specific reason", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "job_did_not_run" });
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("didn't run");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkCaptureHealth(db, testEnv);

    expect(result.escalated).toBe(true);
  });
});
