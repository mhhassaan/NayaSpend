import type { DrizzleD1Database } from "drizzle-orm/d1";
import { users } from "../../src/db/schema";
import { createSession } from "../../src/services/sessionStore";

export async function seedUserAndSession(
  db: DrizzleD1Database,
): Promise<{ userId: number; cookie: string }> {
  const [user] = await db.insert(users).values({
    email: `${crypto.randomUUID()}@example.com`,
    displayName: "Test User",
    createdAt: new Date().toISOString(),
  }).returning();
  const { token } = await createSession(db, user.id);
  return { userId: user.id, cookie: `session=${token}` };
}
