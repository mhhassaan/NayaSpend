import { seedUserAndSession } from "./helpers/authedRequest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { captureRoutes } from "../src/routes/capture";
import { captureRuns, gmailCredentials } from "../src/db/schema";
import { encryptToken } from "../src/security";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key", TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com", FRONTEND_BASE_URL: "https://frontend.example.com",
};

let userId: number;
let cookie: string;
beforeEach(async () => {
  ({ userId, cookie } = await seedUserAndSession(drizzle(env.DB)));
});

describe("capture routes", () => {
  test("GET /health returns the current capture_runs row", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ userId, runStatus: "success", lastSuccessfulRun: new Date().toISOString() });

    const res = await captureRoutes.request("/health", { headers: { Cookie: cookie } }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { runStatus: string };
    expect(body.runStatus).toBe("success");
  });

  test("GET /health with no capture_runs row yet returns a healthy 'never run' shape, not a 404 or crash", async () => {
    const res = await captureRoutes.request("/health", { headers: { Cookie: cookie } }, testEnv);
    expect(res.status).toBe(200);
  });

  test("POST /backfill with no Gmail account connected returns 409, not a crash", async () => {
    const res = await captureRoutes.request("/backfill", { method: "POST", headers: { Cookie: cookie } }, testEnv);
    expect(res.status).toBe(409);
  });

  test("POST /backfill with a connected account runs a backfill chunk", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({ userId,
      encryptedAccessToken: await encryptToken("real-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 })));

    const res = await captureRoutes.request("/backfill", { method: "POST", headers: { Cookie: cookie } }, testEnv);

    expect(res.status).toBe(200);
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
  });
});

test("[Review Focus] GET /health only returns the authenticated user's own capture_runs row", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  await db.insert(captureRuns).values({ userId: other.userId, runStatus: "api_call_failed", errorType: "auth_failure" });
  const res = await captureRoutes.request("/health", { headers: { Cookie: cookie } }, testEnv);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ runStatus: "job_did_not_run", lastAttemptedRun: null, lastSuccessfulRun: null, errorType: null });
});
test("[Review Focus] POST /backfill with no Gmail account connected for this user still returns 409 even if another user has one connected", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  await db.insert(gmailCredentials).values({ userId: other.userId, encryptedAccessToken: "other", encryptedRefreshToken: "other", expiresAt: "2099-01-01" });
  const res = await captureRoutes.request("/backfill", { method: "POST", headers: { Cookie: cookie } }, testEnv);
  expect(res.status).toBe(409);
});
