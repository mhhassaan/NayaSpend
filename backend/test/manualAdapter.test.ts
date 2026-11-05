import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { logMissedTransaction, ValidationError } from "../src/adapters/manualAdapter";
import { transactions } from "../src/db/schema";

describe("logMissedTransaction", () => {
  test("writes a committed, auto-categorized manual_missed row with no provenance beyond the input", async () => {
    const db = drizzle(env.DB);
    const result = await logMissedTransaction(db, { vendorRaw: "Corner Store", amountCents: 50000, date: "2026-10-27" });

    const [row] = await db.select().from(transactions);
    expect(row.source).toBe("manual_missed");
    expect(row.reviewStatus).toBe("committed");
    expect(row.amount).toBe(-50000);
    expect(row.date).toBe("2026-10-27");
    expect(row.vendorNormalized).toBe("corner store");
    expect(row.provenance).toBe("{}");
    expect(row.dedupGroupId).toBeNull();
    expect(result.id).toBe(row.id);
    expect(result.category).toBe(row.category);
  });

  test("rejects a zero or negative amount", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 0, date: "2026-10-27" })).rejects.toThrow();
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: -500, date: "2026-10-27" })).rejects.toThrow();
  });

  test("rejects a non-integer amount", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100.5, date: "2026-10-27" })).rejects.toThrow();
  });

  test("rejects a malformed date", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100, date: "10/27/2026" })).rejects.toThrow();
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100, date: "" })).rejects.toThrow();
  });

  test("[I2] rejects a calendar-impossible date, not just a wrong format", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100, date: "2026-02-31" })).rejects.toThrow();
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100, date: "2026-13-01" })).rejects.toThrow();
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(0);
  });

  test("[I5] every validation failure throws ValidationError specifically, distinguishable from an unexpected error", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "", amountCents: 100, date: "2026-10-27" })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: -1, date: "2026-10-27" })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(logMissedTransaction(db, { vendorRaw: "x", amountCents: 100, date: "bad" })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  test("rejects an empty vendor", async () => {
    const db = drizzle(env.DB);
    await expect(logMissedTransaction(db, { vendorRaw: "   ", amountCents: 100, date: "2026-10-27" })).rejects.toThrow();
  });

  test("picks up an existing category_rules entry for the vendor, same as every other source", async () => {
    const db = drizzle(env.DB);
    const { correctCategory } = await import("../src/services/categorizationEngine");
    await correctCategory(db, "corner store", "Groceries");

    const result = await logMissedTransaction(db, { vendorRaw: "Corner Store", amountCents: 1000, date: "2026-10-27" });

    expect(result.category).toBe("Groceries");
  });
});
