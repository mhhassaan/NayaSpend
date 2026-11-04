import { Hono } from "hono";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { correctCategory, normalize } from "../services/categorizationEngine";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Same round-trip-through-Date validation manualAdapter.ts/bills.ts use --
// the regex alone accepts calendar-impossible values like "2026-02-31".
function isValidIsoDate(date: unknown): date is string {
  if (typeof date !== "string" || !ISO_DATE_PATTERN.test(date)) return false;
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

const DEDUP_ACTIONS = ["kept", "discarded", "confirmed_distinct"] as const;
type DedupAction = (typeof DEDUP_ACTIONS)[number];

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

transactionsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));

  if (!row) {
    return c.text("not found", 404);
  }

  let body: { vendorRaw?: unknown; amount?: unknown; date?: unknown; category?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.text("Request body must be valid JSON", 400);
  }

  const updates: Partial<typeof transactions.$inferInsert> = {};
  if (body.vendorRaw !== undefined) {
    const vendorRaw = typeof body.vendorRaw === "string" ? body.vendorRaw.trim() : "";
    if (!vendorRaw) {
      return c.text("vendorRaw must be a non-empty string", 400);
    }
    updates.vendorRaw = vendorRaw;
    updates.vendorNormalized = normalize(vendorRaw);
  }
  if (body.amount !== undefined) {
    if (!isPositiveInteger(body.amount)) {
      return c.text("amount must be a positive integer", 400);
    }
    updates.amount = body.amount;
  }
  if (body.date !== undefined) {
    if (!isValidIsoDate(body.date)) {
      return c.text("date must be a valid ISO YYYY-MM-DD calendar date", 400);
    }
    updates.date = body.date;
  }
  if (body.category !== undefined) {
    const category = typeof body.category === "string" ? body.category.trim() : "";
    if (!category) {
      return c.text("category must be a non-empty string", 400);
    }
    updates.category = category;
  }

  await db.update(transactions).set(updates).where(eq(transactions.id, id));
  const [updated] = await db.select().from(transactions).where(eq(transactions.id, id));
  return c.json(updated);
});

transactionsRoutes.patch("/:id/category", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));

  if (!row) {
    return c.text("not found", 404);
  }

  let body: { category?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.text("Request body must be valid JSON", 400);
  }
  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!category) {
    return c.text("category must be a non-empty string", 400);
  }

  await db.update(transactions).set({ category }).where(eq(transactions.id, id));
  await correctCategory(db, row.vendorNormalized, category);

  return c.json({ id, category });
});

transactionsRoutes.post("/:id/resolve-dedup", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);

  let body: { action?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.text("Request body must be valid JSON", 400);
  }
  const action = body.action;
  if (!DEDUP_ACTIONS.includes(action as DedupAction)) {
    return c.text(`action must be one of: ${DEDUP_ACTIONS.join(", ")}`, 400);
  }

  const [target] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!target) {
    return c.text("not found", 404);
  }
  if (!target.dedupGroupId) {
    return c.text("transaction has no dedup_group_id to resolve", 400);
  }
  if (target.dedupResolution !== "pending") {
    // Already resolved one way or another -- re-resolving (a double
    // submission, a changed mind, or the frontend targeting the other
    // side of the same pair) must never be allowed to silently
    // overwrite a settled outcome. Without this guard, resolving the
    // *other* side of an already-resolved pair can soft-delete both
    // rows (e.g. kept->kept on each side in turn discards both).
    return c.text("this dedup pair has already been resolved", 409);
  }

  const [counterpart] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.dedupGroupId, target.dedupGroupId), ne(transactions.id, target.id)));
  if (!counterpart) {
    // runDedupCheck always writes a dedup_group_id to exactly two rows --
    // a missing counterpart means the data is already inconsistent, not
    // something this request can fix.
    return c.text("no paired counterpart found for this dedup_group_id", 400);
  }

  const now = new Date().toISOString();
  const resolution = action as DedupAction;

  // kept/discarded are complementary: one side is kept, the other
  // soft-deleted as the duplicate. confirmed_distinct writes the same
  // value to both sides and deletes neither -- "not actually duplicates,
  // keep both, stop asking."
  const [targetUpdate, counterpartUpdate] =
    resolution === "kept"
      ? [{ dedupResolution: "kept" as const }, { dedupResolution: "discarded" as const, deletedAt: now }]
      : resolution === "discarded"
        ? [{ dedupResolution: "discarded" as const, deletedAt: now }, { dedupResolution: "kept" as const }]
        : [{ dedupResolution: "confirmed_distinct" as const }, { dedupResolution: "confirmed_distinct" as const }];

  await db.batch([
    db.update(transactions).set(targetUpdate).where(eq(transactions.id, target.id)),
    db.update(transactions).set(counterpartUpdate).where(eq(transactions.id, counterpart.id)),
  ]);

  return c.json({ resolved: resolution });
});
