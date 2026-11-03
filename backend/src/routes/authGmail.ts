import { Hono } from "hono";
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
};

export const authGmailRoutes = new Hono<{ Bindings: Env }>();

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(message: string, base64Key: string): Promise<Uint8Array> {
  const keyBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

// Stateless, time-boxed OAuth CSRF token: no server-side session, no new
// secret -- reuses TOKEN_ENCRYPTION_KEY (already high-entropy, already a
// Worker secret) purely as an HMAC key here, unrelated to its AES use in
// security.ts.
export async function signState(timestampMs: number, key: string): Promise<string> {
  const timestampPart = bytesToBase64Url(new TextEncoder().encode(String(timestampMs)));
  const mac = await hmacSha256(String(timestampMs), key);
  return `${timestampPart}.${bytesToBase64Url(mac)}`;
}

async function verifyState(state: string, key: string): Promise<boolean> {
  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const [timestampPart, macPart] = parts;

  let timestampMs: number;
  try {
    const padded = timestampPart.replace(/-/g, "+").replace(/_/g, "/");
    timestampMs = Number(atob(padded));
  } catch {
    return false;
  }
  if (!Number.isFinite(timestampMs)) return false;

  const expected = await signState(timestampMs, key);
  if (expected !== `${timestampPart}.${macPart}`) return false;

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

async function redirectToConsent(c: { env: Env }) {
  const config = loadConfig(c.env);
  const state = await signState(Date.now(), config.tokenEncryptionKey);
  return new Response(null, {
    status: 302,
    headers: { Location: consentUrl(config.gmailClientId, config.gmailRedirectUri, state) },
  });
}

authGmailRoutes.get("/connect", (c) => redirectToConsent(c));
authGmailRoutes.get("/reconnect", (c) => redirectToConsent(c));

authGmailRoutes.get("/callback", async (c) => {
  const config = loadConfig(c.env);

  const state = c.req.query("state");
  if (!state || !(await verifyState(state, config.tokenEncryptionKey))) {
    return c.text("Missing or invalid state parameter", 400);
  }

  const code = c.req.query("code");
  if (!code) {
    return c.text("Missing required query parameter: code", 400);
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
    return c.text("Gmail token exchange failed", 502);
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
    return c.text("Gmail token exchange response is missing access_token", 502);
  }
  if (typeof tokenJson.expires_in !== "number" || !Number.isFinite(tokenJson.expires_in)) {
    return c.text("Gmail token exchange response is missing a valid expires_in", 502);
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
    return c.text("Gmail token exchange response is missing refresh_token for a first-time connection", 502);
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

  return c.text("Gmail account connected.", 200);
});
