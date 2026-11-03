import { GmailApiError } from "../adapters/gmailClient";

export type RefreshedToken = { accessToken: string; expiresAt: string };

/**
 * Exchanges a stored refresh_token for a new access_token via the same
 * OAuth token endpoint authGmail.ts uses for the initial exchange, just
 * with grant_type=refresh_token. Google access tokens last ~1 hour, so
 * this must run on every capture dispatch, not just at initial connect.
 */
export async function refreshAccessToken(
  config: { gmailClientId: string; gmailClientSecret: string },
  refreshToken: string
): Promise<RefreshedToken> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.gmailClientId,
      client_secret: config.gmailClientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    // A revoked/expired refresh_token comes back 400 invalid_grant -- the
    // credential itself is broken, not a transient Gmail API blip, so it
    // gets classified the same as every other auth failure (reconnect).
    const errorType = response.status === 400 || response.status === 401 ? "auth_failure" : "unknown";
    throw new GmailApiError(response.status, errorType, `Gmail token refresh failed with status ${response.status}`);
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };

  if (!json.access_token || typeof json.expires_in !== "number" || !Number.isFinite(json.expires_in)) {
    throw new GmailApiError(
      response.status,
      "unknown",
      "Gmail token refresh response is missing access_token or expires_in"
    );
  }

  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}
