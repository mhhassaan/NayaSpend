import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { bills } from "../db/schema";

type Env = {
  DB: D1Database;
};

export const billsRoutes = new Hono<{ Bindings: Env }>();

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// Same round-trip-through-Date validation manualAdapter.ts uses -- the
// regex alone accepts calendar-impossible values like "2026-02-31".
function isValidIsoDate(date: unknown): date is string {
  if (typeof date !== "string" || !ISO_DATE_PATTERN.test(date)) return false;
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

billsRoutes.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(bills);
  return c.json(rows);
});

billsRoutes.post("/", async (c) => {
  let body: { vendor?: unknown; expectedAmount?: unknown; expectedInterval?: unknown; nextDueDate?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.text("Request body must be valid JSON", 400);
  }

  const vendor = typeof body.vendor === "string" ? body.vendor.trim() : "";
  if (!vendor) {
    return c.text("vendor must be a non-empty string", 400);
  }
  if (!isPositiveInteger(body.expectedAmount)) {
    return c.text("expectedAmount must be a positive integer", 400);
  }
  const expectedInterval = typeof body.expectedInterval === "string" ? body.expectedInterval.trim() : "";
  if (!expectedInterval) {
    return c.text("expectedInterval must be a non-empty string", 400);
  }
  if (!isValidIsoDate(body.nextDueDate)) {
    return c.text("nextDueDate must be a valid ISO YYYY-MM-DD calendar date", 400);
  }

  const db = drizzle(c.env.DB);
  const [row] = await db
    .insert(bills)
    .values({ vendor, expectedAmount: body.expectedAmount, expectedInterval, nextDueDate: body.nextDueDate })
    .returning();

  return c.json(row, 201);
});

billsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(bills).where(eq(bills.id, id));
  if (!row) {
    return c.text("not found", 404);
  }

  let body: { vendor?: unknown; expectedAmount?: unknown; expectedInterval?: unknown; nextDueDate?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.text("Request body must be valid JSON", 400);
  }

  const updates: Partial<typeof bills.$inferInsert> = {};
  if (body.vendor !== undefined) {
    const vendor = typeof body.vendor === "string" ? body.vendor.trim() : "";
    if (!vendor) {
      return c.text("vendor must be a non-empty string", 400);
    }
    updates.vendor = vendor;
  }
  if (body.expectedAmount !== undefined) {
    if (!isPositiveInteger(body.expectedAmount)) {
      return c.text("expectedAmount must be a positive integer", 400);
    }
    updates.expectedAmount = body.expectedAmount;
  }
  if (body.expectedInterval !== undefined) {
    const expectedInterval = typeof body.expectedInterval === "string" ? body.expectedInterval.trim() : "";
    if (!expectedInterval) {
      return c.text("expectedInterval must be a non-empty string", 400);
    }
    updates.expectedInterval = expectedInterval;
  }
  if (body.nextDueDate !== undefined) {
    if (!isValidIsoDate(body.nextDueDate)) {
      return c.text("nextDueDate must be a valid ISO YYYY-MM-DD calendar date", 400);
    }
    updates.nextDueDate = body.nextDueDate;
  }

  await db.update(bills).set(updates).where(eq(bills.id, id));
  const [updated] = await db.select().from(bills).where(eq(bills.id, id));
  return c.json(updated);
});

billsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(bills).where(eq(bills.id, id));
  if (!row) {
    return c.text("not found", 404);
  }

  await db.delete(bills).where(eq(bills.id, id));
  return c.body(null, 204);
});
