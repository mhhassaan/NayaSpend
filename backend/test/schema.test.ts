import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { transactions } from "../src/db/schema";

describe("canonical D1 schema: transactions", () => {
  test("inserting a transaction with integer amount round-trips correctly", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({
      amount: 1250, // $12.50 in cents
      date: "2026-11-01",
      vendorRaw: "NAYAPAY RAW",
      vendorNormalized: "nayapay",
      category: "Uncategorized",
      source: "manual_missed",
      provenance: "{}",
      reviewStatus: "committed",
    });

    const rows = await db.select().from(transactions);
    expect(rows[0].amount).toBe(1250);
    expect(Number.isInteger(rows[0].amount)).toBe(true);
  });

  test("amount column rejects a non-integer value", async () => {
    const db = drizzle(env.DB);
    await expect(
      db.insert(transactions).values({
        amount: 12.5 as unknown as number,
        date: "2026-11-01",
        vendorRaw: "x",
        vendorNormalized: "x",
        category: "Uncategorized",
        source: "manual_missed",
        provenance: "{}",
        reviewStatus: "committed",
      })
    ).rejects.toThrow();
  });
});
