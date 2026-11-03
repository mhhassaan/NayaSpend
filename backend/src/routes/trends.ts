import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { getMonthlyTrends } from "../services/trendsService";

type Env = {
  DB: D1Database;
};

export const trendsRoutes = new Hono<{ Bindings: Env }>();

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

trendsRoutes.get("/", async (c) => {
  const monthParam = c.req.query("month");
  const month = monthParam ?? new Date().toISOString().slice(0, 7);

  if (!MONTH_PATTERN.test(month)) {
    return c.text("month must be in YYYY-MM format", 400);
  }

  const db = drizzle(c.env.DB);
  const result = await getMonthlyTrends(db, month);
  return c.json(result);
});
