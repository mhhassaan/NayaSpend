import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { getGmailClient } from "../src/services/gmailCredentialStore";
import { gmailCredentials, users } from "../src/db/schema";
import { encryptToken, decryptToken } from "../src/security";

const testEnv = {
  ...env,
  GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key", TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com", FRONTEND_BASE_URL: "https://frontend.example.com",
};

describe("getGmailClient", () => {
  test("getGmailClient scoped to one user does not return another user's credentials", async () => {
    const db = drizzle(env.DB);
    const [userA, userB] = await db.insert(users).values([
      { email: "a@example.com", displayName: "A", createdAt: new Date().toISOString() },
      { email: "b@example.com", displayName: "B", createdAt: new Date().toISOString() },
    ]).returning();
    const tokens = {
      encryptedAccessToken: await encryptToken("own-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    await db.insert(gmailCredentials).values({ ...tokens, userId: userB.id });
    expect(await getGmailClient(db, testEnv, userA.id)).toBeNull();
    await db.insert(gmailCredentials).values({ ...tokens, userId: userA.id });
    const client = await getGmailClient(db, testEnv, userA.id);
    expect(client).not.toBeNull();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await client!.listMessages(undefined, 10);
    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), { headers: { Authorization: "Bearer own-token" } });
  });
  test("returns null when nothing is connected", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({ email: "a@example.com", displayName: "A", createdAt: new Date().toISOString() }).returning();
    expect(await getGmailClient(db, testEnv, user.id)).toBeNull();
  });

  test("returns a client built from the stored, non-expired access token", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({ email: "a@example.com", displayName: "A", createdAt: new Date().toISOString() }).returning();
    await db.insert(gmailCredentials).values({
      userId: user.id,
      encryptedAccessToken: await encryptToken("real-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const client = await getGmailClient(db, testEnv, user.id);

    expect(client).not.toBeNull();
  });

  test("refreshes and persists an expiring token before returning the client", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({ email: "a@example.com", displayName: "A", createdAt: new Date().toISOString() }).returning();
    await db.insert(gmailCredentials).values({
      userId: user.id,
      encryptedAccessToken: await encryptToken("stale-token", testEnv.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: await encryptToken("real-refresh", testEnv.TOKEN_ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), { status: 200 }))
    );

    await getGmailClient(db, testEnv, user.id);

    const [row] = await db.select().from(gmailCredentials);
    expect(await decryptToken(row.encryptedAccessToken, testEnv.TOKEN_ENCRYPTION_KEY)).toBe("fresh-token");
  });
});
