import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { logMissedTransaction, ValidationError } from "../adapters/manualAdapter";

type Env = {
  DB: D1Database;
};

export const missedTransactionsRoutes = new Hono<{ Bindings: Env }>();

missedTransactionsRoutes.post("/", async (c) => {
  let body: { vendorRaw?: unknown; amountCents?: unknown; date?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.text("Request body must be valid JSON", 400);
  }

  const db = drizzle(c.env.DB);
  try {
    const result = await logMissedTransaction(db, {
      vendorRaw: String(body.vendorRaw ?? ""),
      amountCents: Number(body.amountCents),
      date: String(body.date ?? ""),
    });
    return c.json(result, 201);
  } catch (err) {
    // Only a validation failure is the caller's fault (400) -- anything
    // else (a D1 error, a bug in categorize) is a real server error and
    // must not be reported, or mistaken for, a bad request.
    if (err instanceof ValidationError) {
      return c.text(err.message, 400);
    }
    throw err;
  }
});
