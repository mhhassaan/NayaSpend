import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { transactions } from "../src/db/schema";
import { runDedupCheck } from "../src/services/dedupEngine";
import { seedUserAndSession } from "./helpers/authedRequest";
import { diceCoefficient } from "../src/utils/stringSimilarity";

describe("diceCoefficient", () => {
  test("near-identical vendor spellings score highly", () => {
    expect(diceCoefficient("starbucks #4521", "starbucks coffee")).toBeGreaterThan(0.5);
  });

  test("unrelated strings score low", () => {
    expect(diceCoefficient("starbucks", "electric company")).toBeLessThan(0.3);
  });

  test("identical strings score 1", () => {
    expect(diceCoefficient("starbucks", "starbucks")).toBe(1);
  });

  test("handles strings shorter than 2 characters without dividing by zero", () => {
    expect(diceCoefficient("a", "a")).toBe(1);
    expect(diceCoefficient("a", "b")).toBe(0);
    expect(diceCoefficient("", "")).toBe(1);
  });
});

describe("runDedupCheck", () => {
  test("flags a true cross-channel duplicate (same date, same amount, similar vendor)", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    const [emailTx] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 125000,
        date: "2026-10-27",
        vendorRaw: "STARBUCKS #4521",
        vendorNormalized: "starbucks #4521",
        category: "Coffee",
        source: "gmail_email",
        provenance: "{}",
        reviewStatus: "committed",
      })
      .returning();
    const [stmtTx] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 125000,
        date: "2026-10-27",
        vendorRaw: "Starbucks Coffee",
        vendorNormalized: "starbucks coffee",
        category: "Coffee",
        source: "statement_import",
        provenance: "{}",
        reviewStatus: "committed",
      })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(true);
    const [refreshedEmail] = await db.select().from(transactions).where(eq(transactions.id, emailTx.id));
    const [refreshedStmt] = await db.select().from(transactions).where(eq(transactions.id, stmtTx.id));
    expect(refreshedEmail.dedupGroupId).toBe(refreshedStmt.dedupGroupId);
    expect(refreshedEmail.dedupGroupId).not.toBeNull();
    expect(refreshedEmail.dedupResolution).toBe("pending");
    expect(refreshedStmt.dedupResolution).toBe("pending");
  });

  test("does NOT flag a same-day, same-amount, unrelated vendor as a duplicate", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(transactions).values({
      userId,
      amount: 125000,
      date: "2026-10-27",
      vendorRaw: "Starbucks",
      vendorNormalized: "starbucks",
      category: "Coffee",
      source: "gmail_email",
      provenance: "{}",
      reviewStatus: "committed",
    });
    const [stmtTx] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 125000,
        date: "2026-10-27",
        vendorRaw: "Electric Company",
        vendorNormalized: "electric company",
        category: "Utilities",
        source: "statement_import",
        provenance: "{}",
        reviewStatus: "committed",
      })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(false);
  });

  test("does NOT flag the same vendor/amount outside the date-proximity window", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(transactions).values({
      userId,
      amount: 125000,
      date: "2026-10-01",
      vendorRaw: "Starbucks",
      vendorNormalized: "starbucks",
      category: "Coffee",
      source: "gmail_email",
      provenance: "{}",
      reviewStatus: "committed",
    });
    const [stmtTx] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 125000,
        date: "2026-10-27",
        vendorRaw: "Starbucks",
        vendorNormalized: "starbucks",
        category: "Coffee",
        source: "statement_import",
        provenance: "{}",
        reviewStatus: "committed",
      })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(false);
  });

  test("never compares against pending_review rows", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(transactions).values({
      userId,
      amount: 125000,
      date: "2026-10-27",
      vendorRaw: "Starbucks",
      vendorNormalized: "starbucks",
      category: "Coffee",
      source: "gmail_email",
      provenance: "{}",
      reviewStatus: "pending_review",
    });
    const [stmtTx] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 125000,
        date: "2026-10-27",
        vendorRaw: "Starbucks",
        vendorNormalized: "starbucks",
        category: "Coffee",
        source: "statement_import",
        provenance: "{}",
        reviewStatus: "committed",
      })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(false);
  });

  test("a manual_missed transaction is never compared against anything", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(transactions).values({
      userId,
      amount: 125000,
      date: "2026-10-27",
      vendorRaw: "Starbucks",
      vendorNormalized: "starbucks",
      category: "Coffee",
      source: "gmail_email",
      provenance: "{}",
      reviewStatus: "committed",
    });
    const [manualTx] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 125000,
        date: "2026-10-27",
        vendorRaw: "Starbucks",
        vendorNormalized: "starbucks",
        category: "Coffee",
        source: "manual_missed",
        provenance: "{}",
        reviewStatus: "committed",
      })
      .returning();

    const result = await runDedupCheck(db, manualTx.id);

    expect(result.matched).toBe(false);
  });

  test("does not match a different amount even with an identical vendor and date", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(transactions).values({
      userId,
      amount: 125000,
      date: "2026-10-27",
      vendorRaw: "Starbucks",
      vendorNormalized: "starbucks",
      category: "Coffee",
      source: "gmail_email",
      provenance: "{}",
      reviewStatus: "committed",
    });
    const [stmtTx] = await db
      .insert(transactions)
      .values({
        userId,
        amount: 99999,
        date: "2026-10-27",
        vendorRaw: "Starbucks",
        vendorNormalized: "starbucks",
        category: "Coffee",
        source: "statement_import",
        provenance: "{}",
        reviewStatus: "committed",
      })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(false);
  });

  test("[C1] two consecutive-day same-price purchases do not corrupt each other's dedup groups", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    // G1/S1 on the 27th, G2/S2 on the 28th -- all same amount/vendor, so
    // naive matching could cross-wire G1 with S2 (both within the ±3-day
    // window of each other) instead of G1<->S1 and G2<->S2.
    const [g1] = await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed" })
      .returning();
    const [g2] = await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-28", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed" })
      .returning();
    const [s1] = await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();

    await runDedupCheck(db, s1.id);
    const [s2] = await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-28", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();
    await runDedupCheck(db, s2.id);

    const refreshedG1 = (await db.select().from(transactions).where(eq(transactions.id, g1.id)))[0];
    const refreshedG2 = (await db.select().from(transactions).where(eq(transactions.id, g2.id)))[0];
    const refreshedS1 = (await db.select().from(transactions).where(eq(transactions.id, s1.id)))[0];
    const refreshedS2 = (await db.select().from(transactions).where(eq(transactions.id, s2.id)))[0];

    expect(refreshedG1.dedupGroupId).toBe(refreshedS1.dedupGroupId);
    expect(refreshedG2.dedupGroupId).toBe(refreshedS2.dedupGroupId);
    expect(refreshedG1.dedupGroupId).not.toBe(refreshedG2.dedupGroupId);
  });

  test("[C1] a candidate already in a dedup group is never pulled into a second group", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    const [g1] = await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed" })
      .returning();
    const [s1] = await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();
    await runDedupCheck(db, s1.id);
    const [g1AfterFirstMatch] = await db.select().from(transactions).where(eq(transactions.id, g1.id));
    const originalGroupId = g1AfterFirstMatch.dedupGroupId;

    // A second statement row, same amount/vendor/date window, re-imported
    // (e.g. CUJ 2's overlapping upload). g1 is already grouped with s1 --
    // it must not be regrouped with s2.
    const [s2] = await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();
    const result = await runDedupCheck(db, s2.id);

    expect(result.matched).toBe(false);
    const [g1AfterSecondCheck] = await db.select().from(transactions).where(eq(transactions.id, g1.id));
    expect(g1AfterSecondCheck.dedupGroupId).toBe(originalGroupId); // unchanged
  });

  test("[C1] a transaction that already has a dedup group is not re-matched when checked again", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed" })
      .returning();
    const [s1] = await db
      .insert(transactions)
      .values({ userId, amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();
    await runDedupCheck(db, s1.id);

    // Re-running the check on the same already-grouped row must be a
    // no-op, not generate a fresh group / overwrite dedupResolution.
    await db.update(transactions).set({ dedupResolution: "kept" }).where(eq(transactions.id, s1.id));
    const result = await runDedupCheck(db, s1.id);

    expect(result.matched).toBe(false);
    const [s1After] = await db.select().from(transactions).where(eq(transactions.id, s1.id));
    expect(s1After.dedupResolution).toBe("kept"); // user's resolution preserved
  });
});

test("[Review Focus] a candidate from a different user is never matched, even with identical date/amount/vendor", async () => {
  const db = drizzle(env.DB);
  const a = await seedUserAndSession(db);
  const b = await seedUserAndSession(db);
  const values = { amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", provenance: "{}", reviewStatus: "committed" };
  const [subject] = await db.insert(transactions).values({ ...values, userId: a.userId, source: "gmail_email" }).returning();
  const [candidate] = await db.insert(transactions).values({ ...values, userId: b.userId, source: "statement_import" }).returning();
  expect(await runDedupCheck(db, subject.id)).toEqual({ matched: false, dedupGroupId: null });
  for (const row of [subject, candidate]) {
    expect(await db.select().from(transactions).where(eq(transactions.id, row.id))).toEqual([row]);
  }
});
