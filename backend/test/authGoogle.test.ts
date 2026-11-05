import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { authGoogleRoutes } from "../src/routes/authGoogle";
import { authIdentities, gmailCredentials, sessions, users } from "../src/db/schema";
import { validateSession } from "../src/services/sessionStore";

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
const profile = { sub: "google-sub", email: "a@example.com", name: "Alice", picture: "https://example.com/avatar" };
function cookieHeaderFrom(res: Response): string {
  return res.headers.get("Set-Cookie")!.split(";")[0];
}
async function freshFlow() {
  const res = await authGoogleRoutes.request("/login", {}, testEnv);
  return { state: new URL(res.headers.get("Location")!).searchParams.get("state")!, cookie: cookieHeaderFrom(res) };
}
function callback(query: string, cookie?: string) {
  return authGoogleRoutes.request(`/callback?${query}`, cookie ? { headers: { Cookie: cookie } } : {}, testEnv);
}
function mockGoogle(userinfo: object = profile) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      expect(new URLSearchParams(String(init?.body)).get("redirect_uri")).toBe("https://example.com/auth/google/callback");
      return new Response(JSON.stringify({ access_token: "identity-token" }));
    }
    if (url.includes("userinfo")) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer identity-token");
      return new Response(JSON.stringify(userinfo));
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
async function signIn() {
  const { state, cookie } = await freshFlow();
  return callback(`code=fake-code&state=${encodeURIComponent(state)}`, cookie);
}
describe("authGoogle routes", () => {
  test("[Review Focus] /login's consent URL requests only openid email profile, never gmail.readonly", async () => {
    const res = await authGoogleRoutes.request("/login", {}, testEnv);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location")!);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("scope")).not.toContain("gmail");
    expect(url.searchParams.has("access_type")).toBe(false);
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/auth/google/callback");
    expect(res.headers.get("Set-Cookie")).toContain("Path=/auth/google");
  });
  test("[Review Focus] a successful callback never writes to gmailCredentials", async () => {
    mockGoogle();
    expect((await signIn()).headers.get("Location")).toBe(testEnv.FRONTEND_BASE_URL);
    expect(await drizzle(env.DB).select().from(gmailCredentials)).toHaveLength(0);
  });
  test("a first-time Google sign-in creates a user, an auth_identities row, and a live session cookie", async () => {
    const spy = mockGoogle();
    const res = await signIn();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(testEnv.FRONTEND_BASE_URL);
    const db = drizzle(env.DB);
    // migration 0004 seeds a sentinel "Unmigrated data" user (id 1) into
    // every fresh database, so `users` is never actually empty beforehand
    // -- filter by email rather than assuming this signup is the first row.
    const [user] = await db.select().from(users).where(eq(users.email, profile.email));
    expect(user).toMatchObject({ email: profile.email, displayName: profile.name, avatarUrl: profile.picture });
    expect(await db.select().from(authIdentities)).toEqual([expect.objectContaining({ userId: user.id, provider: "google", providerAccountId: profile.sub })]);
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toContain("session=");
    for (const flag of ["HttpOnly", "Secure", "SameSite=None", "Path=/", "Max-Age="]) expect(cookie).toContain(flag);
    const token = cookie.match(/session=([^; ,]+)/)![1];
    expect(await validateSession(db, token)).toMatchObject({ id: user.id });
    expect(await db.select().from(sessions)).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  test("a returning user (same Google sub) logs into the SAME users row, not a duplicate", async () => {
    mockGoogle();
    await signIn();
    const db = drizzle(env.DB);
    const [first] = await db.select().from(users).where(eq(users.email, profile.email));
    await signIn();
    expect(await db.select().from(users).where(eq(users.email, profile.email))).toEqual([first]);
    expect(await db.select().from(authIdentities)).toHaveLength(1);
    expect((await db.select().from(sessions)).map(row => row.userId)).toEqual([first.id, first.id]);
  });
  test("an invalid or replayed state is rejected the same way authGmail.ts's /callback already is", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const { state } = await freshFlow();
    const res = await callback(`code=fake&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`${testEnv.FRONTEND_BASE_URL}/login?error=invalid_state`);
    expect(spy).not.toHaveBeenCalled();
  });
  test("a userinfo response missing email redirects with an error and creates no identity", async () => {
    mockGoogle({ sub: profile.sub });
    const res = await signIn();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`${testEnv.FRONTEND_BASE_URL}/login?error=invalid_userinfo`);
    const db = drizzle(env.DB);
    // migration 0004 seeds a sentinel "Unmigrated data" user (id 1) into
    // every fresh database -- assert no NEW row was added by this failed
    // signup attempt, not that the table is literally empty.
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(authIdentities)).toHaveLength(0);
  });
});
