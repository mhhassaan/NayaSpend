import { queueSuggestions, type SuggestionOptions } from "../services/llmSuggestionService";
import Papa from "papaparse";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { transactions } from "../db/schema";
import { categorize, normalize } from "../services/categorizationEngine";
import { runDedupCheck } from "../services/dedupEngine";

export type ParsedCsvRow =
  | { rowIndex: number; confidence: "high"; amountCents: number; date: string; vendorRaw: string }
  | { rowIndex: number; confidence: "low"; reason: string };

const DATE_HEADER_PATTERN = /date|timestamp/i;
const VENDOR_HEADER_PATTERN = /desc|memo|vendor|merchant/i;
const AMOUNT_HEADER_PATTERN = /amount|debit|credit/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Strict on purpose: after stripping currency symbols/commas/parens, what
// remains must be exactly an optionally-signed number with at most 2
// decimal places. This rejects "12abc", "1.2.3", a trailing "-" or "DR"/
// "CR" suffix, and 3+ decimal digits -- all of which `parseFloat` alone
// would accept by ignoring trailing garbage, silently committing a wrong
// amount instead of quarantining it.
const STRICT_AMOUNT_PATTERN = /^-?\d+(\.\d{1,2})?$/;

function findHeader(headers: string[], pattern: RegExp): string | undefined {
  return headers.find((h) => pattern.test(h));
}

function parseAmountToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\+/, "");
  const isParenthesized = /^\(.*\)$/.test(trimmed);
  const unwrapped = trimmed.replace(/[()]/g, "").trim();
  // Currency markers only ever appear as a prefix in the formats this
  // adapter claims to support ("Rs. 1,250.00", "PKR 500") -- stripping
  // them as a prefix (rather than a bare \b-bounded substring, which
  // fails to match "Rs." immediately before a space) handles the actual
  // NayaPay/bank notation.
  const withoutCurrency = unwrapped.replace(/^(Rs\.?|PKR)\s*/i, "").replace(/[$,]/g, "");

  if (!STRICT_AMOUNT_PATTERN.test(withoutCurrency)) return null;

  const value = Number.parseFloat(withoutCurrency);
  const signedValue = isParenthesized ? -Math.abs(value) : value;
  return Math.round(signedValue * 100);
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
// NayaPay's real export timestamps look like "01 Oct 2026 03:32 PM" --
// day, a textual month, year, optionally followed by a time. Only the
// date portion is kept (transactions.date is a date, not a timestamp).
const DD_MON_YYYY_PATTERN = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\b/;

function normalizeIsoDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (ISO_DATE_PATTERN.test(trimmed)) return trimmed;

  const match = trimmed.match(DD_MON_YYYY_PATTERN);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = MONTH_ABBREVIATIONS[monthName.slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

// A real NayaPay export's transaction table doesn't start on line 1 --
// it's preceded by ~10 lines of account-summary preamble (customer name,
// address, account number, IBAN, opening/closing balance, ...). None of
// those lines contain embedded newlines, so a plain line split is safe
// here purely to locate the real header row; the actual data (which can
// have multi-line quoted DESCRIPTION fields) is still parsed by papaparse
// from that point on.
function findHeaderLineIndex(csvText: string): number {
  const lines = csvText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].split(",").map((f) => f.trim());
    const hasDate = fields.some((f) => DATE_HEADER_PATTERN.test(f));
    const hasVendor = fields.some((f) => VENDOR_HEADER_PATTERN.test(f));
    const hasAmount = fields.some((f) => AMOUNT_HEADER_PATTERN.test(f));
    if (hasDate && hasVendor && hasAmount) return i;
  }
  return -1;
}

export function parseStatementCsv(csvText: string, _fileRef: string): ParsedCsvRow[] {
  const headerLineIndex = findHeaderLineIndex(csvText);
  const tableText =
    headerLineIndex <= 0 ? csvText : csvText.split(/\r?\n/).slice(headerLineIndex).join("\n");

  const parsed = Papa.parse<Record<string, string>>(tableText, {
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

  const rowsWithFieldErrors = new Set(
    parsed.errors.filter((e) => e.row !== undefined).map((e) => e.row as number)
  );

  return parsed.data.map((row, rowIndex) => {
    if (rowsWithFieldErrors.has(rowIndex)) {
      return { rowIndex, confidence: "low" as const, reason: "malformed row (field count mismatch)" };
    }

    const amountCents = parseAmountToCents(row[amountHeader] ?? "");
    if (amountCents === null) {
      return { rowIndex, confidence: "low" as const, reason: "unparseable amount" };
    }

    const date = normalizeIsoDate(row[dateHeader] ?? "");
    if (date === null) {
      return { rowIndex, confidence: "low" as const, reason: "unparseable date" };
    }

    const vendorRaw = row[vendorHeader]?.split(/\r?\n/)[0]?.trim();
    if (!vendorRaw) {
      return { rowIndex, confidence: "low" as const, reason: "missing vendor/description" };
    }

    return { rowIndex, confidence: "high" as const, amountCents, date, vendorRaw };
  });
}

export async function importStatementCsv(
  db: DrizzleD1Database,
  csvText: string,
  fileRef: string,
  userId: number,
  suggestions?: SuggestionOptions
): Promise<{ imported: number }> {
  const rows = parseStatementCsv(csvText, fileRef);
  const insertedIds: number[] = [];
  const rawRows = Papa.parse<Record<string, string>>(csvText.split(/\r?\n/).slice(Math.max(0, findHeaderLineIndex(csvText))).join("\n"), { header: true, skipEmptyLines: true }).data;

  for (const row of rows) {
    // Idempotent on (fileRef, rowIndex): re-importing the same file (a
    // retry after a partial failure, or the user re-uploading the same
    // statement) inserts nothing for a row already present.
    const statementRowKey = `${fileRef}:${row.rowIndex}`;

    if (row.confidence === "high") {
      const category = await categorize(db, row.vendorRaw, userId);
      const [inserted] = await db
        .insert(transactions)
        .values({
          userId,
          amount: row.amountCents,
          date: row.date,
          vendorRaw: row.vendorRaw,
          vendorNormalized: normalize(row.vendorRaw),
          category,
          source: "statement_import",
          reviewStatus: "committed",
          provenance: JSON.stringify({ fileRef, rowIndex: row.rowIndex }),
          statementRowKey,
        })
        .onConflictDoNothing({ target: transactions.statementRowKey })
        .returning({ id: transactions.id });
      if (inserted) {
        insertedIds.push(inserted.id);
        try {
          await runDedupCheck(db, inserted.id);
        } catch (err) {
          console.error(`dedup check failed for transaction ${inserted.id}:`, err);
        }
      }
    } else {
      const [inserted] = await db
        .insert(transactions)
        .values({
          userId,
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
            bodyExcerpt: JSON.stringify(rawRows[row.rowIndex] ?? {}).slice(0, 1500),
          }),
          statementRowKey,
        })
        .onConflictDoNothing({ target: transactions.statementRowKey })
        .returning({ id: transactions.id });
      if (inserted) insertedIds.push(inserted.id);
    }
  }

  await queueSuggestions(db, userId, insertedIds, suggestions);
  return { imported: rows.length };
}
