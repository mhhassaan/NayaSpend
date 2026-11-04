import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { budgets } from "../db/schema";

type Env = {
  DB: D1Database;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// [Phase 8 Task 5] Chained so `typeof budgetsRoutes` carries every route's
// schema -- see the identical fix/explanation in index.ts.
export const budgetsRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(budgets);
    return c.json(rows);
  })
  .post("/", async (c) => {
  let body: { category?: unknown; limitAmount?: unknown; periodType?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.text("Request body must be valid JSON", 400);
  }

  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!category) {
    return c.text("category must be a non-empty string", 400);
  }
  if (!isPositiveInteger(body.limitAmount)) {
    return c.text("limitAmount must be a positive integer", 400);
  }
  if (body.periodType !== "monthly") {
    return c.text('periodType must be "monthly"', 400);
  }

  const db = drizzle(c.env.DB);
  const [row] = await db
    .insert(budgets)
    .values({ category, limitAmount: body.limitAmount, periodType: body.periodType })
    .returning();

  return c.json(row, 201);
  })
  .patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(budgets).where(eq(budgets.id, id));
  if (!row) {
    return c.text("not found", 404);
  }

  let body: { category?: unknown; limitAmount?: unknown; periodType?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.text("Request body must be valid JSON", 400);
  }

  const updates: Partial<typeof budgets.$inferInsert> = {};
  if (body.category !== undefined) {
    const category = typeof body.category === "string" ? body.category.trim() : "";
    if (!category) {
      return c.text("category must be a non-empty string", 400);
    }
    updates.category = category;
  }
  if (body.limitAmount !== undefined) {
    if (!isPositiveInteger(body.limitAmount)) {
      return c.text("limitAmount must be a positive integer", 400);
    }
    updates.limitAmount = body.limitAmount;
  }
  if (body.periodType !== undefined) {
    if (body.periodType !== "monthly") {
      return c.text('periodType must be "monthly"', 400);
    }
    updates.periodType = body.periodType;
  }

  await db.update(budgets).set(updates).where(eq(budgets.id, id));
  const [updated] = await db.select().from(budgets).where(eq(budgets.id, id));
  return c.json(updated);
  })
  .delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(budgets).where(eq(budgets.id, id));
  if (!row) {
    return c.text("not found", 404);
  }

  await db.delete(budgets).where(eq(budgets.id, id));
    return c.body(null, 204);
  });
