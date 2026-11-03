import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { getGmailClient } from "../src/services/gmailCredentialStore";
import { gmailCredentials } from "../src/db/schema";
import { encryptToken, decryptToken } from "../src/security";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key", TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
};

describe("getGmailClient", () => {
  test("returns null when nothing is connected", async () => {
    const db = drizzle(env.DB);
    expect(await getGmailClient(db, testEnv)).toBeNull();
  });

  test("returns a client built from the stored, non-expired access token", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("real-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const client = await getGmailClient(db, testEnv);

    expect(client).not.toBeNull();
  });

  test("refreshes and persists an expiring token before returning the client", async () => {
    const db = drizzle(env.DB);
    await db.insert(gmailCredentials).values({
      encryptedAccessToken: await encryptToken("stale-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), { status: 200 }))
    );

    await getGmailClient(db, testEnv);

    const [row] = await db.select().from(gmailCredentials);
    expect(await decryptToken(row.encryptedAccessToken, testEnv.TOKEN_ENCRYPTION_KEY)).toBe("fresh-token");
  });
});
