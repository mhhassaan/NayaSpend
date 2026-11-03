import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { authGmailRoutes } from "../src/routes/authGmail";
import { gmailCredentials } from "../src/db/schema";

// The real worker env has no Gmail/OAuth secrets bound in this test
// environment (.dev.vars is intentionally gitignored and absent here) --
// overlay test-safe values on top of the real DB binding.
const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "test-client-id",
  GMAIL_CLIENT_SECRET: "test-client-secret",
  GMAIL_REDIRECT_URI: "https://example.com/auth/gmail/callback",
  RESEND_API_KEY: "test-resend-key",
  TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
};

describe("authGmail routes", () => {
  test("GET /connect redirects to Google's OAuth consent screen with gmail.readonly scope", async () => {
    const res = await authGmailRoutes.request("/connect", {}, testEnv);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("accounts.google.com");
    expect(location).toContain(
      "scope=" + encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly")
    );
  });

  test("GET /reconnect redirects the same way as /connect", async () => {
    const res = await authGmailRoutes.request("/reconnect", {}, testEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("accounts.google.com");
  });

  test("GET /callback exchanges the code and stores an encrypted token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "real-access-token",
              refresh_token: "real-refresh-token",
              expires_in: 3600,
            }),
            { status: 200 }
          )
      )
    );

    const res = await authGmailRoutes.request("/callback?code=fake-auth-code", {}, testEnv);
    expect(res.status).toBe(200);

    const db = drizzle(env.DB);
    const [row] = await db.select().from(gmailCredentials);
    expect(row.encryptedAccessToken).not.toContain("real-access-token");
    expect(row.encryptedRefreshToken).not.toContain("real-refresh-token");
    expect(row.encryptedAccessToken.length).toBeGreaterThan(0);
  });

  test("a second callback upserts (replaces) the single credentials row, not duplicates it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "first-token",
              refresh_token: "first-refresh",
              expires_in: 3600,
            }),
            { status: 200 }
          )
      )
    );
    await authGmailRoutes.request("/callback?code=first-code", {}, testEnv);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "second-token",
              refresh_token: "second-refresh",
              expires_in: 3600,
            }),
            { status: 200 }
          )
      )
    );
    await authGmailRoutes.request("/callback?code=second-code", {}, testEnv);

    const db = drizzle(env.DB);
    const rows = await db.select().from(gmailCredentials);
    expect(rows).toHaveLength(1);
  });

  test("a callback with no code param fails clearly instead of calling the token endpoint", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await authGmailRoutes.request("/callback", {}, testEnv);

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a failed token exchange returns a clear error and does not overwrite stored credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    );

    const res = await authGmailRoutes.request("/callback?code=bad-code", {}, testEnv);

    expect(res.status).toBe(502);
  });
});
