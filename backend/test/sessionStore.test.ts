import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { sessions, users } from "../src/db/schema";
import { createSession, deleteSession, validateSession } from "../src/services/sessionStore";

describe("session store", () => {
  test("createSession writes a row and returns a token that validateSession resolves back to the user", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "a@example.com", displayName: "A", createdAt: new Date().toISOString(),
    }).returning();
    const before = Date.now();
    const { token, expiresAt } = await createSession(db, user.id, "Session test");
    const after = Date.now();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, token));
    expect(row).toMatchObject({ id: token, userId: user.id, expiresAt, userAgent: "Session test" });
    expect(new Date(row.createdAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(row.createdAt).getTime()).toBeLessThanOrEqual(after);
    expect(new Date(expiresAt).getTime() - new Date(row.createdAt).getTime()).toBe(2_592_000_000);
    expect(await validateSession(db, token)).toEqual({ id: user.id, email: "a@example.com", displayName: "A" });
  });

  test("validateSession returns null for an unknown token", async () => {
    const db = drizzle(env.DB);
    expect(await validateSession(db, "not-a-real-token")).toBeNull();
  });

  test("[Review Focus] validateSession returns null for an expired session", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "b@example.com", displayName: "B", createdAt: new Date().toISOString(),
    }).returning();
    await db.insert(sessions).values({
      id: "expired-token", userId: user.id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(await validateSession(db, "expired-token")).toBeNull();
  });

  test("deleteSession removes the row so a later validateSession call returns null", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "c@example.com", displayName: "C", createdAt: new Date().toISOString(),
    }).returning();
    const { token } = await createSession(db, user.id);
    expect(await validateSession(db, token)).toEqual({ id: user.id, email: "c@example.com", displayName: "C" });
    await deleteSession(db, token);
    expect(await validateSession(db, token)).toBeNull();
  });

  test("deleteSession on an unknown token does not throw", async () => {
    const db = drizzle(env.DB);
    await expect(deleteSession(db, "not-a-real-token")).resolves.toBeUndefined();
  });
});
