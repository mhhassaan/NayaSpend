import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { sessions, users } from "../src/db/schema";
import { requireAuth, type AuthUser } from "../src/middleware/auth";
import { createSession } from "../src/services/sessionStore";

type Env = { DB: D1Database };

function createApp() {
  return new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>()
    .use(requireAuth)
    .get("/", (c) => c.json(c.get("user")));
}

describe("requireAuth", () => {
  test("rejects a request with no session cookie", async () => {
    const res = await createApp().request("/", {}, env);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  test("rejects a request with an invalid session cookie", async () => {
    const res = await createApp().request("/", {
      headers: { Cookie: "session=not-a-real-token" },
    }, env);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  test("[Review Focus] rejects a request with an expired session cookie", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "expired@example.com", displayName: "Expired", createdAt: new Date().toISOString(),
    }).returning();
    await db.insert(sessions).values({
      id: "expired-token", userId: user.id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await createApp().request("/", {
      headers: { Cookie: "session=expired-token" },
    }, env);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  test("attaches the resolved user to context for a valid session", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "valid@example.com", displayName: "Valid", createdAt: new Date().toISOString(),
    }).returning();
    const { token } = await createSession(db, user.id);

    const res = await createApp().request("/", {
      headers: { Cookie: `session=${token}` },
    }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: user.id, email: user.email, displayName: user.displayName,
    });
  });
});
