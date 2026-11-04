import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { getMonthlyTrends, getTrendsHistory } from "../services/trendsService";

type Env = {
  DB: D1Database;
};

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DEFAULT_HISTORY_MONTHS = 6;
const MAX_HISTORY_MONTHS = 24;

// [Phase 8 Task 5] Chained so `typeof trendsRoutes` carries every route's
// schema -- see the identical fix/explanation in index.ts.
export const trendsRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const monthParam = c.req.query("month");
    const month = monthParam ?? new Date().toISOString().slice(0, 7);

    if (!MONTH_PATTERN.test(month)) {
      return c.text("month must be in YYYY-MM format", 400);
    }

    const db = drizzle(c.env.DB);
    const result = await getMonthlyTrends(db, month);
    return c.json(result);
  })
  .get("/history", async (c) => {
    const monthsParam = c.req.query("months");
    const months = monthsParam === undefined ? DEFAULT_HISTORY_MONTHS : Number(monthsParam);

    if (!Number.isInteger(months) || months < 1 || months > MAX_HISTORY_MONTHS) {
      return c.text(`months must be an integer between 1 and ${MAX_HISTORY_MONTHS}`, 400);
    }

    const db = drizzle(c.env.DB);
    const result = await getTrendsHistory(db, months);
    return c.json(result);
  });
