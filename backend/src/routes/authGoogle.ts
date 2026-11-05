import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { loadConfig, type ConfigEnv } from "../config";
import { authIdentities, users } from "../db/schema";
import { randomNonce, signState, verifyState } from "../oauthState";
import { createSession } from "../services/sessionStore";

type Env = ConfigEnv & { DB: D1Database };
const NONCE_COOKIE_NAME = "google_oauth_nonce";
const STATE_MAX_AGE_SECONDS = 10 * 60;

// [Phase 8 Task 5] Chained so `typeof authGoogleRoutes` carries every
// route's schema -- see the identical fix/explanation in index.ts.
export const authGoogleRoutes = new Hono<{ Bindings: Env }>()
  .get("/login", async (c) => {
    const config = loadConfig(c.env);
    const nonce = randomNonce();
    const state = await signState(Date.now(), nonce, config.tokenEncryptionKey);
    setCookie(c, NONCE_COOKIE_NAME, nonce, {
      httpOnly: true, secure: true, sameSite: "Lax",
      maxAge: STATE_MAX_AGE_SECONDS, path: "/auth/google",
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.gmailClientId);
    url.searchParams.set("redirect_uri", new URL("/auth/google/callback", config.gmailRedirectUri).toString());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    c.header("Location", url.toString());
    return c.body(null, 302);
  })
  .get("/callback", async (c) => {
    const config = loadConfig(c.env);
    const toFrontend = (path: string) => {
      c.header("Location", `${config.frontendBaseUrl}${path}`);
      return c.body(null, 302);
    };
    const state = c.req.query("state");
    if (!state || !(await verifyState(state, getCookie(c, NONCE_COOKIE_NAME), config.tokenEncryptionKey))) {
      return toFrontend("/login?error=invalid_state");
    }
    const code = c.req.query("code");
    if (!code) return toFrontend("/login?error=missing_code");

    // Trust Google's authenticated userinfo response rather than decoding
    // an unverified id_token. The access token is used only for this call.
    let userinfo: { sub?: unknown; email?: unknown; name?: unknown; picture?: unknown };
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code, client_id: config.gmailClientId, client_secret: config.gmailClientSecret,
          grant_type: "authorization_code",
          redirect_uri: new URL("/auth/google/callback", config.gmailRedirectUri).toString(),
        }).toString(),
      });
      if (!tokenResponse.ok) return toFrontend("/login?error=exchange_failed");
      const token = await tokenResponse.json() as { access_token?: unknown };
      if (typeof token?.access_token !== "string" || !token.access_token.trim()) {
        return toFrontend("/login?error=missing_access_token");
      }
      const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!response.ok) return toFrontend("/login?error=userinfo_failed");
      userinfo = await response.json();
    } catch {
      return toFrontend("/login?error=oauth_failed");
    }
    if (!userinfo || typeof userinfo.sub !== "string" || !userinfo.sub.trim() ||
        typeof userinfo.email !== "string" || !userinfo.email.trim()) {
      return toFrontend("/login?error=invalid_userinfo");
    }
    const db = drizzle(c.env.DB);
    const [identity] = await db.select().from(authIdentities).where(and(
      eq(authIdentities.provider, "google"), eq(authIdentities.providerAccountId, userinfo.sub),
    ));
    let userId = identity?.userId;
    try {
      if (userId === undefined) {
        const now = new Date().toISOString();
        // D1 batch executes both inserts atomically; the identity resolves
        // the new user's id inside the same batch without a partial signup.
        const [created] = await db.batch([
          db.insert(users).values({
            email: userinfo.email,
            displayName: typeof userinfo.name === "string" && userinfo.name ? userinfo.name : userinfo.email,
            avatarUrl: typeof userinfo.picture === "string" ? userinfo.picture : null,
            createdAt: now,
          }).returning({ id: users.id }),
          db.insert(authIdentities).values({
            userId: sql`(SELECT id FROM users WHERE email = ${userinfo.email})`,
            provider: "google", providerAccountId: userinfo.sub, createdAt: now,
          }),
        ]);
        userId = created[0].id;
      }
      const session = await createSession(db, userId);
      setCookie(c, "session", session.token, {
        httpOnly: true, secure: true, sameSite: "None", path: "/",
        maxAge: Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000)),
      });
    } catch {
      return toFrontend("/login?error=login_failed");
    }
    return toFrontend("");
  });
