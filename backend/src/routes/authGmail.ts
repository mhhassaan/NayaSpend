import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { loadConfig } from "../config";
import { gmailCredentials } from "../db/schema";
import { decryptToken, encryptToken } from "../security";

type Env = {
  DB: D1Database;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REDIRECT_URI: string;
  RESEND_API_KEY: string;
  TOKEN_ENCRYPTION_KEY: string;
  FRONTEND_BASE_URL: string;
};

const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const NONCE_COOKIE_NAME = "gmail_oauth_nonce";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomNonce(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

async function hmacSha256(message: string, base64Key: string): Promise<Uint8Array> {
  const keyBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Stateless, time-boxed OAuth CSRF token -- no server-side session, no new
 * secret (reuses TOKEN_ENCRYPTION_KEY, already high-entropy and already a
 * Worker secret, purely as an HMAC key here, unrelated to its AES use in
 * security.ts).
 *
 * [Final review I2] An HMAC over just a timestamp proves only that this
 * server issued the state recently -- it says nothing about which browser
 * started the flow, since /connect is public and unauthenticated. Without
 * a browser binding, an attacker can run /connect themselves, consent
 * with their own Google account, and hand a victim (or the API directly)
 * a fully valid state+code pair that replaces the victim's Gmail
 * connection with the attacker's. Binding the state to a random nonce
 * that only travels in an HttpOnly cookie (double-submit pattern) ties
 * the state to the browser that received it, without any server-side
 * session storage.
 */
export async function signState(timestampMs: number, nonce: string, key: string): Promise<string> {
  const timestampPart = bytesToBase64Url(new TextEncoder().encode(String(timestampMs)));
  const noncePart = bytesToBase64Url(new TextEncoder().encode(nonce));
  const mac = await hmacSha256(`${timestampMs}.${nonce}`, key);
  return `${timestampPart}.${noncePart}.${bytesToBase64Url(mac)}`;
}

async function verifyState(state: string, cookieNonce: string | undefined, key: string): Promise<boolean> {
  if (!cookieNonce) return false;

  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [timestampPart, noncePart, macPart] = parts;

  let timestampMs: number;
  let nonce: string;
  try {
    const padded = timestampPart.replace(/-/g, "+").replace(/_/g, "/");
    timestampMs = Number(atob(padded));
    nonce = new TextDecoder().decode(Uint8Array.from(atob(noncePart.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  if (!Number.isFinite(timestampMs)) return false;
  if (!timingSafeEqual(nonce, cookieNonce)) return false;

  const expected = await signState(timestampMs, nonce, key);
  if (!timingSafeEqual(expected, `${timestampPart}.${noncePart}.${macPart}`)) return false;

  return Date.now() - timestampMs <= STATE_MAX_AGE_MS;
}

function consentUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function redirectToConsent(c: Context<{ Bindings: Env }>) {
  const config = loadConfig(c.env);
  const nonce = randomNonce();
  const state = await signState(Date.now(), nonce, config.tokenEncryptionKey);

  setCookie(c, NONCE_COOKIE_NAME, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: STATE_MAX_AGE_MS / 1000,
    path: "/auth/gmail",
  });

  // setCookie writes its header onto c.res -- returning a brand-new
  // Response here (rather than c.body/c.redirect) would discard it, so
  // the redirect is built through the context too.
  c.header("Location", consentUrl(config.gmailClientId, config.gmailRedirectUri, state));
  return c.body(null, 302);
}

// Every outcome of /callback -- success or any failure -- redirects into
// the SPA's CaptureHealth page instead of returning a bare Worker
// response, so the reconnect round trip (CaptureHealth -> Google -> back)
// always lands the user back inside the app.
function redirectToFrontend(c: Context<{ Bindings: Env }>, frontendBaseUrl: string, path: string) {
  c.header("Location", `${frontendBaseUrl}${path}`);
  return c.body(null, 302);
}

// [Phase 8 Task 5] Chained so `typeof authGmailRoutes` carries every
// route's schema -- see the identical fix/explanation in index.ts.
export const authGmailRoutes = new Hono<{ Bindings: Env }>()
  .get("/connect", (c) => redirectToConsent(c))
  .get("/reconnect", (c) => redirectToConsent(c))
  .get("/callback", async (c) => {
  const config = loadConfig(c.env);
  const toFrontend = (path: string) => redirectToFrontend(c, config.frontendBaseUrl, path);

  const state = c.req.query("state");
  const cookieNonce = getCookie(c, NONCE_COOKIE_NAME);
  if (!state || !(await verifyState(state, cookieNonce, config.tokenEncryptionKey))) {
    return toFrontend("/capture-health?error=invalid_state");
  }

  const code = c.req.query("code");
  if (!code) {
    return toFrontend("/capture-health?error=missing_code");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.gmailClientId,
      client_secret: config.gmailClientSecret,
      grant_type: "authorization_code",
      redirect_uri: config.gmailRedirectUri,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    return toFrontend("/capture-health?error=exchange_failed");
  }

  const tokenJson = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // Google's token response isn't guaranteed to be well-formed from our
  // side's perspective -- validate before encrypting/storing anything, so
  // a malformed response can never overwrite a working credential with a
  // broken one (e.g. an empty access token, or a NaN expiry).
  if (!tokenJson.access_token) {
    return toFrontend("/capture-health?error=missing_access_token");
  }
  if (typeof tokenJson.expires_in !== "number" || !Number.isFinite(tokenJson.expires_in)) {
    return toFrontend("/capture-health?error=invalid_expiry");
  }

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(gmailCredentials);

  // Google omits refresh_token on some reconnects (it only issues a new
  // one when the user re-consents) -- keep the existing one rather than
  // overwriting it with an empty value.
  let refreshTokenToStore: string;
  if (tokenJson.refresh_token) {
    refreshTokenToStore = tokenJson.refresh_token;
  } else if (existing) {
    refreshTokenToStore = await decryptToken(existing.encryptedRefreshToken, config.tokenEncryptionKey);
  } else {
    return toFrontend("/capture-health?error=missing_refresh_token");
  }

  const encryptedAccessToken = await encryptToken(tokenJson.access_token, config.tokenEncryptionKey);
  const encryptedRefreshToken = await encryptToken(refreshTokenToStore, config.tokenEncryptionKey);
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();

  if (existing) {
    await db
      .update(gmailCredentials)
      .set({ encryptedAccessToken, encryptedRefreshToken, expiresAt })
      .where(eq(gmailCredentials.id, existing.id));
  } else {
    await db.insert(gmailCredentials).values({ encryptedAccessToken, encryptedRefreshToken, expiresAt });
  }

  return toFrontend("/capture-health?connected=1");
  });
