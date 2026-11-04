import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { transactions } from "../src/db/schema";
import { importStatementCsv, parseStatementCsv } from "../src/adapters/statementAdapter";
import {
  cleanCsv,
  columnShiftCsv,
  drCrCsv,
  garbageAmountCsv,
  mixedCsv,
  nonIsoDateCsv,
  realWorldNayaPayCsv,
  rsFormatCsv,
  trailingMinusCsv,
  unrecognizedColumnsCsv,
} from "./fixtures/sampleStatements";

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

  test("[C2] a non-ISO date (DD/MM/YYYY) is quarantined, not stored unnormalized or thrown", () => {
    const rows = parseStatementCsv(nonIsoDateCsv, "file-noniso");
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe("low");
  });

  test("[real-world] skips the account-summary preamble and finds the real TIMESTAMP/TYPE/DESCRIPTION/AMOUNT/BALANCE header row", () => {
    const rows = parseStatementCsv(realWorldNayaPayCsv, "file-real");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.confidence === "high")).toBe(true);
  });

  test("[real-world] parses NayaPay's real 'DD Mon YYYY HH:MM AM/PM' timestamp into an ISO date", () => {
    const rows = parseStatementCsv(realWorldNayaPayCsv, "file-real");
    const row = rows[0];
    expect(row.confidence).toBe("high");
    if (row.confidence === "high") {
      expect(row.date).toBe("2026-10-01");
    }
  });

  test("[real-world] an outgoing transfer's multi-line, Transaction-ID-bearing DESCRIPTION is reduced to its first line as the vendor", () => {
    const rows = parseStatementCsv(realWorldNayaPayCsv, "file-real");
    const row = rows[0];
    expect(row.confidence).toBe("high");
    if (row.confidence === "high") {
      expect(row.vendorRaw).toBe("Outgoing fund transfer to John Smith");
    }
  });

  test("[real-world] a negative ('-2,300') and a '+'-prefixed incoming ('+4,000') amount both parse to signed cents", () => {
    const rows = parseStatementCsv(realWorldNayaPayCsv, "file-real");
    expect(rows[0].confidence).toBe("high");
    expect(rows[2].confidence).toBe("high");
    if (rows[0].confidence === "high") expect(rows[0].amountCents).toBe(-230000);
    if (rows[2].confidence === "high") expect(rows[2].amountCents).toBe(400000);
  });

  test("[I3] a trailing-minus amount ('50.00-') is quarantined rather than read as positive", () => {
    const rows = parseStatementCsv(trailingMinusCsv, "file-trailing");
    expect(rows[0].confidence).toBe("low");
  });

  test("[I3] DR/CR suffixed amounts are quarantined rather than silently losing their sign", () => {
    const rows = parseStatementCsv(drCrCsv, "file-drcr");
    expect(rows.every((r) => r.confidence === "low")).toBe(true);
  });

  test("[I3] an amount with trailing garbage ('12abc') is quarantined, not truncated to 12", () => {
    const rows = parseStatementCsv(garbageAmountCsv, "file-garbage");
    expect(rows[0].confidence).toBe("low");
  });

  test("[I4] 'Rs. 1,250.00' (space before the digits) parses correctly instead of quarantining", () => {
    const rows = parseStatementCsv(rsFormatCsv, "file-rs");
    expect(rows[0].confidence).toBe("high");
    if (rows[0].confidence === "high") {
      expect(rows[0].amountCents).toBe(125000);
    }
  });

  test("[I7] a row papaparse reports a field-count error for is quarantined, not silently column-shifted", () => {
    const rows = parseStatementCsv(columnShiftCsv, "file-shift");
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe("low");
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

  test("[I6] a quarantined CSV row is never dedup-checked, even against a seed row it would otherwise match exactly", async () => {
    const db = drizzle(env.DB);
    // Seeded to match the quarantined placeholder's own amount (0),
    // vendor ("(unrecognized)") and today's date exactly -- if the
    // committed-only/reviewStatus filter in importStatementCsv or
    // runDedupCheck were ever removed, this would still match and this
    // test would catch it.
    await db.insert(transactions).values({
      amount: 0,
      date: new Date().toISOString().slice(0, 10),
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

  test("[I1] re-importing the same file (e.g. a retry after a partial failure) does not duplicate rows", async () => {
    const db = drizzle(env.DB);
    await importStatementCsv(db, cleanCsv, "file-retry");
    await importStatementCsv(db, cleanCsv, "file-retry");

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(3); // not 6
  });
});
