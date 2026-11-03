import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { correctCategory } from "../services/categorizationEngine";

type Env = {
  DB: D1Database;
};

export const transactionsRoutes = new Hono<{ Bindings: Env }>();

transactionsRoutes.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const reviewStatus = c.req.query("reviewStatus");

  const rows = await db
    .select()
    .from(transactions)
    .where(
      reviewStatus
        ? and(isNull(transactions.deletedAt), eq(transactions.reviewStatus, reviewStatus))
        : isNull(transactions.deletedAt)
    )
    .orderBy(desc(transactions.date));

  return c.json(rows);
});

transactionsRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));

  if (!row) {
    return c.text("not found", 404);
  }
  return c.json(row);
});

transactionsRoutes.patch("/:id/category", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));

  if (!row) {
    return c.text("not found", 404);
  }

  const { category } = await c.req.json<{ category: string }>();
  await db.update(transactions).set({ category }).where(eq(transactions.id, id));
  await correctCategory(db, row.vendorNormalized, category);

  return c.json({ id, category });
});
