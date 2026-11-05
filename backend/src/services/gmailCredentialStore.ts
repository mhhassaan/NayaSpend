import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { gmailCredentials } from "../db/schema";
import { createGmailClient, type GmailClient } from "../adapters/gmailClient";
import { refreshAccessToken } from "./gmailTokenRefresh";
import { loadConfig, type ConfigEnv } from "../config";
import { decryptToken, encryptToken } from "../security";

const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000; // refresh a few minutes before Google would reject it

/**
 * Shared by index.ts's cron/queue dispatch and capture.ts's manual-backfill
 * route (Phase 7) -- extracted from index.ts's original
 * buildGmailClientFromStoredCredentials so both consumers share Phase 5's
 * already-reviewed refresh logic instead of duplicating it.
 */
export async function getGmailClient(
  db: DrizzleD1Database,
  env: Partial<ConfigEnv>,
  userId: number
): Promise<GmailClient | null> {
  const [credentials] = await db.select().from(gmailCredentials).where(eq(gmailCredentials.userId, userId));
  if (!credentials) return null;

  const config = loadConfig(env);
  const expiresAt = new Date(credentials.expiresAt).getTime();

  if (Date.now() >= expiresAt - TOKEN_EXPIRY_SKEW_MS) {
    const refreshToken = await decryptToken(credentials.encryptedRefreshToken, config.tokenEncryptionKey);
    const refreshed = await refreshAccessToken(
      { gmailClientId: config.gmailClientId, gmailClientSecret: config.gmailClientSecret },
      refreshToken
    );
    const encryptedAccessToken = await encryptToken(refreshed.accessToken, config.tokenEncryptionKey);
    await db
      .update(gmailCredentials)
      .set({ encryptedAccessToken, expiresAt: refreshed.expiresAt })
      .where(eq(gmailCredentials.id, credentials.id));
    return createGmailClient(refreshed.accessToken);
  }

  const accessToken = await decryptToken(credentials.encryptedAccessToken, config.tokenEncryptionKey);
  return createGmailClient(accessToken);
}
