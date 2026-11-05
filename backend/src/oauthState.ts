const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomNonce(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

export async function hmacSha256(message: string, base64Key: string): Promise<Uint8Array> {
  const keyBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

export function timingSafeEqual(a: string, b: string): boolean {
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

export async function verifyState(state: string, cookieNonce: string | undefined, key: string): Promise<boolean> {
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

