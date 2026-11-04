import type { GmailMessage } from "./gmailClient";

export type ParsedTransaction = {
  amountCents: number;
  date: string;
  vendorRaw: string;
};

export type ParsedEmailResult =
  | ({ confidence: "high" } & ParsedTransaction)
  | { confidence: "low"; reason: string };

// Pakistan has no daylight-saving time, so a fixed UTC+5 offset is always
// correct (unlike most timezones, which need a real tz database).
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

// NayaPay's real "You spent" template never puts the word "spent" in the
// email body (only in the subject) -- the body is a receipt-style layout
// keyed off "Amount Paid". The original "spent Rs./PKR X" pattern below
// was validated only against an assumed/invented body format and matches
// nothing in a real captured email; kept as an alternative so any email
// that genuinely does say "spent" (or a future/alternate template) still
// matches.
const AMOUNT_PATTERN = /\b(?:spent|Amount Paid)\s+(?:Rs\.?|PKR)\s*([\d,]+)(?:\.(\d+))?/i;
const VENDOR_PATTERN = /\b(?:at|to)\s+([A-Za-z0-9][A-Za-z0-9 &'-]*?)(?:\s+on\s|\.|,|$)/;
// Real template's second, more reliable vendor anchor: "Merchant Details"
// through "Merchant UIC" always brackets the merchant name (and its
// city/country line) in the ADDITIONAL INFORMATION section.
const MERCHANT_DETAILS_PATTERN = /Merchant Details\s+([\s\S]*?)\s*Merchant UIC/i;
const EXPLICIT_DATE_PATTERN = /\bon\s+(\d{4}-\d{2}-\d{2})/i;

function extractDate(email: GmailMessage): string {
  const explicit = email.bodyText.match(EXPLICIT_DATE_PATTERN);
  if (explicit) return explicit[1];

  // No explicit date in the body -- fall back to the Gmail receive
  // timestamp converted to Asia/Karachi local date (never the raw UTC
  // date, which can land on the wrong calendar day for a late-night spend).
  const utcMillis = Number(email.internalDate);
  return new Date(utcMillis + KARACHI_OFFSET_MS).toISOString().slice(0, 10);
}

export function parseNayaPayEmail(email: GmailMessage): ParsedEmailResult {
  const amountMatch = email.bodyText.match(AMOUNT_PATTERN);
  if (!amountMatch) {
    return { confidence: "low", reason: "no amount found" };
  }

  const [, integerPart, decimalPart] = amountMatch;
  if (decimalPart && decimalPart.length > 2) {
    return { confidence: "low", reason: "ambiguous decimal precision" };
  }

  const amountValue = Number.parseFloat(
    `${integerPart.replace(/,/g, "")}${decimalPart ? `.${decimalPart}` : ""}`
  );
  if (!Number.isFinite(amountValue)) {
    return { confidence: "low", reason: "unparseable amount" };
  }
  const amountCents = Math.round(amountValue * 100);

  // Search for the vendor only after the matched amount, so an earlier
  // greeting like "Welcome to NayaPay" can never be mistaken for the
  // vendor the user actually spent money at.
  const textAfterAmount = email.bodyText.slice((amountMatch.index ?? 0) + amountMatch[0].length);
  const vendorMatch = textAfterAmount.match(VENDOR_PATTERN);
  let vendorRaw = vendorMatch?.[1]?.trim();
  if (!vendorRaw) {
    const merchantMatch = email.bodyText.match(MERCHANT_DETAILS_PATTERN);
    vendorRaw = merchantMatch?.[1]?.replace(/\s+/g, " ").trim();
  }
  if (!vendorRaw) {
    return { confidence: "low", reason: "unrecognized layout: no vendor found" };
  }

  return { confidence: "high", amountCents, date: extractDate(email), vendorRaw };
}
