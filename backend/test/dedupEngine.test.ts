import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { transactions } from "../src/db/schema";
import { runDedupCheck } from "../src/services/dedupEngine";
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
    const [emailTx] = await db
      .insert(transactions)
      .values({
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
    await db.insert(transactions).values({
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
    await db.insert(transactions).values({
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
    await db.insert(transactions).values({
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
    await db.insert(transactions).values({
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
    await db.insert(transactions).values({
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
});
