import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { captureRoutes } from "../src/routes/capture";
import { captureRuns, gmailCredentials } from "../src/db/schema";
import { encryptToken } from "../src/security";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key", TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
};

describe("capture routes", () => {
  test("GET /health returns the current capture_runs row", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", lastSuccessfulRun: new Date().toISOString() });

    const res = await captureRoutes.request("/health", {}, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { runStatus: string };
    expect(body.runStatus).toBe("success");
  });

  test("GET /health with no capture_runs row yet returns a healthy 'never run' shape, not a 404 or crash", async () => {
    const res = await captureRoutes.request("/health", {}, testEnv);
    expect(res.status).toBe(200);
  });

  test("POST /backfill with no Gmail account connected returns 409, not a crash", async () => {
    const res = await captureRoutes.request("/backfill", { method: "POST" }, testEnv);
    expect(res.status).toBe(409);
  });

  test("POST /backfill with a connected account runs a backfill chunk", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("real-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 })));

    const res = await captureRoutes.request("/backfill", { method: "POST" }, testEnv);

    expect(res.status).toBe(200);
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
  });
});
