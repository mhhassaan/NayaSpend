import { Hono } from "hono";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { correctCategory } from "../services/categorizationEngine";

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

transactionsRoutes.post("/:id/resolve-dedup", async (c) => {
  const id = Number(c.req.param("id"));
  const db = drizzle(c.env.DB);

  const { action } = await c.req.json<{ action: string }>();
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
