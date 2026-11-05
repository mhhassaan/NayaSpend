import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { authGmailRoutes } from "../src/routes/authGmail";
import { gmailCredentials, users } from "../src/db/schema";
import { createSession } from "../src/services/sessionStore";
import { decryptToken } from "../src/security";

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
  NOTIFICATION_EMAIL: "user@example.com",
  FRONTEND_BASE_URL: "https://frontend.example.com",
};

let sessionCookie: string;
let userId: number;

function cookieHeaderFrom(connectRes: Response): string {
  // Hono test requests don't carry a cookie jar across calls like a real
  // browser -- extract the Set-Cookie's name=value pair and forward it
  // explicitly on the next request, exactly as a browser would.
  const setCookie = connectRes.headers.get("Set-Cookie")!;
  return setCookie.split(";")[0];
}

// Every real callback goes through /connect first to get a signed state
// AND its matching nonce cookie -- tests that aren't specifically about
// the state/nonce check itself thread a real one through so they keep
// testing what they originally tested.
async function freshFlow(): Promise<{ state: string; cookie: string }> {
  const res = await authGmailRoutes.request("/connect", { headers: { Cookie: sessionCookie } }, testEnv);
  const state = new URL(res.headers.get("Location")!).searchParams.get("state")!;
  return { state, cookie: cookieHeaderFrom(res) };
}

function callback(query: string, cookie?: string) {
  return authGmailRoutes.request(`/callback?${query}`, { headers: { Cookie: cookie ? `${sessionCookie}; ${cookie}` : sessionCookie } }, testEnv);
}

describe("authGmail routes", () => {
  beforeEach(async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({ email: "a@example.com", displayName: "A", createdAt: new Date().toISOString() }).returning();
    userId = user.id;
    const { token } = await createSession(db, user.id);
    sessionCookie = `session=${token}`;
  });

  test("[Review Focus] /connect requires a session, rejecting an unauthenticated request", async () => {
    const res = await authGmailRoutes.request("/connect", {}, testEnv);
    expect(res.status).toBe(401);
  });

  test("[Review Focus] /reconnect requires a session, rejecting an unauthenticated request", async () => {
    const res = await authGmailRoutes.request("/reconnect", {}, testEnv);
    expect(res.status).toBe(401);
  });

  test("/callback without a valid session redirects to capture-health with an error, before any token exchange", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { state, cookie } = await freshFlow();
    const nonceCookie = cookie.split("; ").find((part) => part.startsWith("gmail_oauth_nonce="))!;
    const res = await authGmailRoutes.request(`/callback?code=fake-code&state=${encodeURIComponent(state)}`, { headers: { Cookie: nonceCookie } }, testEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=not_authenticated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a successful callback stores the credentials scoped to the authenticated user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 })));
    const { state, cookie } = await freshFlow();
    const res = await callback(`code=good-code&state=${encodeURIComponent(state)}`, cookie);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?connected=1");
    const [row] = await drizzle(env.DB).select().from(gmailCredentials);
    expect(row.userId).toBe(userId);
  });

  test("GET /connect redirects to Google's OAuth consent screen with gmail.readonly scope", async () => {
    const res = await authGmailRoutes.request("/connect", { headers: { Cookie: sessionCookie } }, testEnv);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("accounts.google.com");
    expect(location).toContain(
      "scope=" + encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly")
    );
  });

  test("GET /reconnect redirects the same way as /connect", async () => {
    const res = await authGmailRoutes.request("/reconnect", { headers: { Cookie: sessionCookie } }, testEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("accounts.google.com");
  });

  test("GET /connect includes a state parameter in the consent URL", async () => {
    const res = await authGmailRoutes.request("/connect", { headers: { Cookie: sessionCookie } }, testEnv);
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  // [Final review I2] An HMAC
  // over just a timestamp proves only "this server issued it recently" --
  // not "this browser started the flow". Without a browser-bound nonce, an
  // attacker can run /connect themselves, consent with their own Google
  // account, and hand the victim (or the API) a fully valid state+code
  // pair that replaces the victim's Gmail connection with the attacker's.
  test("[I2] GET /connect sets an HttpOnly nonce cookie alongside the state parameter", async () => {
    const res = await authGmailRoutes.request("/connect", { headers: { Cookie: sessionCookie } }, testEnv);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
  });

  // [Phase 8 Task 4] /callback now redirects into the SPA on every outcome
  // (success or failure) instead of returning a bare Worker response, so
  // CaptureHealth's reconnect action round-trips back into the app.
  test("[I2] GET /callback with a valid, fresh state but no nonce cookie redirects to capture-health with an error", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { state } = await freshFlow();

    const res = await callback(`code=fake-code&state=${encodeURIComponent(state)}`, undefined);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=invalid_state");
  });

  test("[I2] GET /callback with a state from a different /connect call than the cookie redirects with an error", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const flowA = await freshFlow();
    const flowB = await freshFlow();

    // The attack this closes: an attacker's own /connect+/callback state
    // (flowA) replayed against a victim's browser, which only carries its
    // own nonce cookie (flowB's).
    const res = await callback(`code=fake-code&state=${encodeURIComponent(flowA.state)}`, flowB.cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=invalid_state");
  });

  test("GET /callback with a tampered state parameter redirects with an error", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { state, cookie } = await freshFlow();
    const tampered = state.slice(0, -1) + (state.endsWith("A") ? "B" : "A");

    const res = await callback(`code=fake-code&state=${tampered}`, cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=invalid_state");
  });

  test("GET /callback with a valid state and cookie, successful exchange, redirects to capture-health?connected=1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 }))
    );
    const { state, cookie } = await freshFlow();

    const res = await callback(`code=fake-code&state=${encodeURIComponent(state)}`, cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?connected=1");
  });

  test("GET /callback with an expired (>10 minutes old) state redirects with an error", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { signState } = await import("../src/oauthState");
    const nonce = "test-nonce";
    const staleState = await signState(Date.now() - 11 * 60 * 1000, nonce, testEnv.TOKEN_ENCRYPTION_KEY);

    const res = await callback(`code=fake-code&state=${encodeURIComponent(staleState)}`, `gmail_oauth_nonce=${nonce}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=invalid_state");
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

    const { state, cookie } = await freshFlow();
    const res = await callback(`code=fake-auth-code&state=${encodeURIComponent(state)}`, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?connected=1");

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
    const flow1 = await freshFlow();
    await callback(`code=first-code&state=${encodeURIComponent(flow1.state)}`, flow1.cookie);

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
    const flow2 = await freshFlow();
    await callback(`code=second-code&state=${encodeURIComponent(flow2.state)}`, flow2.cookie);

    const db = drizzle(env.DB);
    const rows = await db.select().from(gmailCredentials);
    expect(rows).toHaveLength(1);
    expect(await decryptToken(rows[0].encryptedAccessToken, testEnv.TOKEN_ENCRYPTION_KEY)).toBe(
      "second-token"
    );
  });

  test("a callback with no code param redirects with a missing_code error, without calling the token endpoint", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { state, cookie } = await freshFlow();

    const res = await callback(`state=${encodeURIComponent(state)}`, cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=missing_code");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a failed token exchange redirects to capture-health with an error, and does not overwrite stored credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ access_token: "working-token", refresh_token: "working-refresh", expires_in: 3600 }),
            { status: 200 }
          )
      )
    );
    const flow1 = await freshFlow();
    await callback(`code=good-code&state=${encodeURIComponent(flow1.state)}`, flow1.cookie);
    const db = drizzle(env.DB);
    const [before] = await db.select().from(gmailCredentials);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    );
    const flow2 = await freshFlow();
    const res = await callback(`code=bad-code&state=${encodeURIComponent(flow2.state)}`, flow2.cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=exchange_failed");
    const [after] = await db.select().from(gmailCredentials);
    expect(after.encryptedAccessToken).toBe(before.encryptedAccessToken);
  });

  test("a token response missing access_token redirects with an error, not stored as an empty credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ refresh_token: "r", expires_in: 3600 }), { status: 200 })
      )
    );
    const { state, cookie } = await freshFlow();

    const res = await callback(`code=weird-code&state=${encodeURIComponent(state)}`, cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=missing_access_token");
    const db = drizzle(env.DB);
    const rows = await db.select().from(gmailCredentials);
    expect(rows).toHaveLength(0);
  });

  test("a token response missing expires_in redirects with an error, not stored with an invalid expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }), { status: 200 })
      )
    );
    const { state, cookie } = await freshFlow();

    const res = await callback(`code=weird-code&state=${encodeURIComponent(state)}`, cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=invalid_expiry");
  });

  test("a token response with no refresh_token (e.g. a reconnect Google doesn't re-issue one for) keeps the existing refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ access_token: "initial-access", refresh_token: "initial-refresh", expires_in: 3600 }),
            { status: 200 }
          )
      )
    );
    const flow1 = await freshFlow();
    await callback(`code=first&state=${encodeURIComponent(flow1.state)}`, flow1.cookie);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: "renewed-access", expires_in: 3600 }), { status: 200 })
      )
    );
    const flow2 = await freshFlow();
    const res = await callback(`code=second&state=${encodeURIComponent(flow2.state)}`, flow2.cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?connected=1");
    const db = drizzle(env.DB);
    const [row] = await db.select().from(gmailCredentials);
    expect(await decryptToken(row.encryptedAccessToken, testEnv.TOKEN_ENCRYPTION_KEY)).toBe("renewed-access");
    expect(await decryptToken(row.encryptedRefreshToken, testEnv.TOKEN_ENCRYPTION_KEY)).toBe("initial-refresh");
  });

  test("a callback with no refresh_token on a first-time connection (no existing credential) redirects with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }), { status: 200 }))
    );
    const { state, cookie } = await freshFlow();

    const res = await callback(`code=fake-code&state=${encodeURIComponent(state)}`, cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=missing_refresh_token");
  });
});
