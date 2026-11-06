import { drizzle } from "drizzle-orm/d1";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { validateSession } from "../services/sessionStore";

export type AuthUser = { id: number; email: string; displayName: string };

type Env = { DB: D1Database };

export const requireAuth: MiddlewareHandler<{
  Bindings: Env;
  Variables: { user: AuthUser };
}> = async (c, next) => {
  const token = getCookie(c, "session");
  if (!token) return c.text("Unauthorized", 401);

  const user = await validateSession(drizzle(c.env.DB), token);
  if (!user) return c.text("Unauthorized", 401);

  c.set("user", user);
  await next();
};
