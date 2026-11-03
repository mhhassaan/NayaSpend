import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { transactions } from "../src/db/schema";
import { importStatementCsv, parseStatementCsv } from "../src/adapters/statementAdapter";
import { cleanCsv, mixedCsv, unrecognizedColumnsCsv } from "./fixtures/sampleStatements";

describe("parseStatementCsv", () => {
  test("parses clean rows including a parenthesized negative amount", () => {
    const rows = parseStatementCsv(cleanCsv, "file-1");
    const refundRow = rows.find((r) => r.confidence === "high" && r.amountCents < 0);
    expect(refundRow).toBeDefined();
    if (refundRow?.confidence === "high") {
      expect(refundRow.amountCents).toBe(-5000);
    }
  });

  test("parses a clean positive amount to integer cents", () => {
    const rows = parseStatementCsv(cleanCsv, "file-1");
    const starbucksRow = rows.find((r) => r.confidence === "high" && r.vendorRaw === "Starbucks Coffee");
    expect(starbucksRow).toBeDefined();
    if (starbucksRow?.confidence === "high") {
      expect(starbucksRow.amountCents).toBe(125000);
    }
  });

  test("a CSV with no recognizable amount column quarantines every row", () => {
    const rows = parseStatementCsv(unrecognizedColumnsCsv, "file-2");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.confidence === "low")).toBe(true);
  });

  test("one bad row in an otherwise-clean file quarantines only that row", () => {
    const rows = parseStatementCsv(mixedCsv, "file-3");
    expect(rows.some((r) => r.confidence === "high")).toBe(true);
    expect(rows.some((r) => r.confidence === "low")).toBe(true);
  });

  test("rowIndex is 0-based and matches the CSV data row order", () => {
    const rows = parseStatementCsv(cleanCsv, "file-1");
    expect(rows.map((r) => r.rowIndex)).toEqual([0, 1, 2]);
  });
});

describe("importStatementCsv", () => {
  test("writes high-confidence rows as committed statement_import transactions", async () => {
    const db = drizzle(env.DB);
    const result = await importStatementCsv(db, cleanCsv, "file-1");
    expect(result.imported).toBe(3);
    const rows = await db.select().from(transactions);
    expect(rows.every((r) => r.source === "statement_import")).toBe(true);
    expect(rows.some((r) => r.reviewStatus === "committed")).toBe(true);
  });

  test("writes low-confidence rows as pending_review with the reason and fileRef/rowIndex in provenance", async () => {
    const db = drizzle(env.DB);
    await importStatementCsv(db, mixedCsv, "file-3");
    const rows = await db.select().from(transactions).where(eq(transactions.reviewStatus, "pending_review"));
    expect(rows).toHaveLength(1);
    const provenance = JSON.parse(rows[0].provenance);
    expect(provenance.fileRef).toBe("file-3");
    expect(provenance.rowIndex).toBe(1);
    expect(provenance.quarantineReason).toBeDefined();
  });

  test("a committed CSV row is dedup-checked against an existing gmail_email transaction", async () => {
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

    const singleRowCsv = `Date,Description,Amount\n2026-10-27,Starbucks Coffee,1250.00\n`;
    await importStatementCsv(db, singleRowCsv, "file-dedup");

    const [stmtRow] = await db.select().from(transactions).where(eq(transactions.source, "statement_import"));
    expect(stmtRow.dedupGroupId).not.toBeNull();
  });

  test("a quarantined CSV row is never dedup-checked", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({
      amount: 0,
      date: "2026-10-27",
      vendorRaw: "(unrecognized)",
      vendorNormalized: "(unrecognized)",
      category: "Uncategorized",
      source: "gmail_email",
      provenance: "{}",
      reviewStatus: "committed",
    });

    await importStatementCsv(db, unrecognizedColumnsCsv, "file-unrec");

    const [stmtRow] = await db.select().from(transactions).where(eq(transactions.source, "statement_import"));
    expect(stmtRow.dedupGroupId).toBeNull();
  });
});
