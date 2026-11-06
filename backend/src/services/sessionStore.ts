import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sessions, users } from "../db/schema";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(
  db: DrizzleD1Database,
  userId: number,
  userAgent?: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.insert(sessions).values({
    id: token,
    userId,
    userAgent,
    createdAt: now.toISOString(),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function validateSession(
  db: DrizzleD1Database,
  token: string,
): Promise<{ id: number; email: string; displayName: string } | null> {
  const [row] = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    expiresAt: sessions.expiresAt,
  }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token));

  if (!row || new Date(row.expiresAt) <= new Date()) return null;
  return { id: row.id, email: row.email, displayName: row.displayName };
}

export async function deleteSession(db: DrizzleD1Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}
