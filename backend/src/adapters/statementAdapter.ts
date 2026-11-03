import Papa from "papaparse";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { categorize, normalize } from "../services/categorizationEngine";

export type ParsedCsvRow =
  | { rowIndex: number; confidence: "high"; amountCents: number; date: string; vendorRaw: string }
  | { rowIndex: number; confidence: "low"; reason: string };

const DATE_HEADER_PATTERN = /date/i;
const VENDOR_HEADER_PATTERN = /desc|memo|vendor|merchant/i;
const AMOUNT_HEADER_PATTERN = /amount|debit|credit/i;

function findHeader(headers: string[], pattern: RegExp): string | undefined {
  return headers.find((h) => pattern.test(h));
}

function parseAmountToCents(raw: string): number | null {
  const trimmed = raw.trim();
  const isParenthesized = /^\(.*\)$/.test(trimmed);
  const unwrapped = trimmed.replace(/[()]/g, "");
  const cleaned = unwrapped.replace(/[$,]/g, "").replace(/\b(Rs\.?|PKR)\b/gi, "").trim();

  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;

  const signedValue = isParenthesized ? -Math.abs(value) : value;
  return Math.round(signedValue * 100);
}

export function parseStatementCsv(csvText: string, _fileRef: string): ParsedCsvRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = parsed.meta.fields ?? [];
  const dateHeader = findHeader(headers, DATE_HEADER_PATTERN);
  const vendorHeader = findHeader(headers, VENDOR_HEADER_PATTERN);
  const amountHeader = findHeader(headers, AMOUNT_HEADER_PATTERN);

  if (!dateHeader || !vendorHeader || !amountHeader) {
    return parsed.data.map((_, rowIndex) => ({
      rowIndex,
      confidence: "low" as const,
      reason: "unrecognized columns",
    }));
  }

  return parsed.data.map((row, rowIndex) => {
    const amountCents = parseAmountToCents(row[amountHeader] ?? "");
    if (amountCents === null) {
      return { rowIndex, confidence: "low" as const, reason: "unparseable amount" };
    }
    return {
      rowIndex,
      confidence: "high" as const,
      amountCents,
      date: row[dateHeader],
      vendorRaw: row[vendorHeader],
    };
  });
}

export async function importStatementCsv(
  db: DrizzleD1Database,
  csvText: string,
  fileRef: string
): Promise<{ imported: number }> {
  const rows = parseStatementCsv(csvText, fileRef);

  for (const row of rows) {
    if (row.confidence === "high") {
      const category = await categorize(db, row.vendorRaw);
      await db.insert(transactions).values({
        amount: row.amountCents,
        date: row.date,
        vendorRaw: row.vendorRaw,
        vendorNormalized: normalize(row.vendorRaw),
        category,
        source: "statement_import",
        reviewStatus: "committed",
        provenance: JSON.stringify({ fileRef, rowIndex: row.rowIndex }),
      });
    } else {
      await db.insert(transactions).values({
        amount: 0,
        date: new Date().toISOString().slice(0, 10),
        vendorRaw: "(unrecognized)",
        vendorNormalized: "(unrecognized)",
        category: "Uncategorized",
        source: "statement_import",
        reviewStatus: "pending_review",
        provenance: JSON.stringify({
          fileRef,
          rowIndex: row.rowIndex,
          quarantineReason: row.reason,
        }),
      });
    }
  }

  return { imported: rows.length };
}
