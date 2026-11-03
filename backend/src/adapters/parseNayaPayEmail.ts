import type { GmailMessage } from "./gmailClient";

export type ParsedTransaction = {
  amountCents: number;
  date: string;
  vendorRaw: string;
};

export type ParsedEmailResult =
  | ({ confidence: "high" } & ParsedTransaction)
  | { confidence: "low"; reason: string };

// Matches "Rs. 1,250.00", "Rs 1250", "PKR 500", "PKR 1,250" -- commas are
// stripped and the amount is parsed as a float before converting to cents,
// so "1250" and "1250.00" both resolve correctly (see Review Focus: must
// never truncate/round in a way that silently loses money).
const AMOUNT_PATTERN = /(?:Rs\.?|PKR)\s*([\d,]+(?:\.\d+)?)/i;
const VENDOR_PATTERN = /\b(?:at|to)\s+([A-Za-z0-9][A-Za-z0-9 &'-]*?)(?:\s+on\s|\.|,|$)/;

export function parseNayaPayEmail(email: GmailMessage): ParsedEmailResult {
  const searchText = `${email.subject}\n${email.bodyText}`;

  const amountMatch = searchText.match(AMOUNT_PATTERN);
  if (!amountMatch) {
    return { confidence: "low", reason: "no amount found" };
  }

  const amountValue = Number.parseFloat(amountMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(amountValue)) {
    return { confidence: "low", reason: "unparseable amount" };
  }
  const amountCents = Math.round(amountValue * 100);

  const vendorMatch = email.bodyText.match(VENDOR_PATTERN);
  const vendorRaw = vendorMatch?.[1]?.trim();
  if (!vendorRaw) {
    return { confidence: "low", reason: "unrecognized layout: no vendor found" };
  }

  const date = new Date(Number(email.internalDate)).toISOString().slice(0, 10);

  return { confidence: "high", amountCents, date, vendorRaw };
}
