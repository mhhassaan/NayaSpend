import type { GmailMessage } from "./gmailClient";

export type NayaPayEmailKind = "spent" | "sent" | "got" | "bundle" | "topup" | "mtag" | "reversal";
export type ParsedTransaction = {
  amountCents: number;
  direction: "in" | "out";
  date: string;
  vendorRaw: string;
};
export type ParsedEmailResult =
  | ({ confidence: "high" } & ParsedTransaction)
  | { confidence: "low"; reason: string };

// Keep these phrases aligned with NAYAPAY_QUERY, including for history.list.
export function classifyNayaPaySubject(subject: string): NayaPayEmailKind | null {
  if (/\breversed\b/i.test(subject)) return "reversal";
  const phrases = [
    ["you spent", "spent"], ["you sent", "sent"], ["you got", "got"],
    ["you subscribed", "bundle"], ["you topped up", "topup"], ["you recharged", "mtag"],
  ] as const;
  return phrases.find(([phrase]) => subject.toLowerCase().includes(phrase))?.[1] ?? null;
}

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
const MONEY = String.raw`\s+(?:Rs\.?|PKR)\s*([\d,]+)(?:\.(\d+))?`;
const MERCHANT_DETAILS_PATTERN = /Merchant Details\s+([\s\S]*?)\s*Merchant UIC/i;
const VENDOR_PATTERN = /\b(?:at|to)\s+([A-Za-z0-9][A-Za-z0-9 &'-]*?)(?:\s+on\s|\.|,|$)/;

function labelledAmount(text: string, label: string): RegExpMatchArray | null {
  return text.match(new RegExp(`\\b(?:${label.replace(/ /g, "\\s+")})${MONEY}`, "i"));
}

function cents(match: RegExpMatchArray | null): number | null {
  if (!match || (match[2]?.length ?? 0) > 2) return null;
  const value = Math.round(Number(`${match[1].replace(/,/g, "")}.${match[2] ?? "0"}`) * 100);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function extractDate(email: GmailMessage): string | null {
  // This is already Karachi local time: retain its calendar date, never add UTC+5.
  const local = email.bodyText.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4}),\s*\d{1,2}:\d{2}\s*[AP]M\b/i);
  if (local) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(local[2].toLowerCase()) + 1;
    const date = `${local[3]}-${String(month).padStart(2, "0")}-${local[1].padStart(2, "0")}`;
    const parsedDate = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date ? date : null;
  }
  const explicit = email.bodyText.match(/\bon\s+(\d{4}-\d{2}-\d{2})/i);
  if (explicit) return explicit[1];
  const received = Number(email.internalDate);
  return Number.isFinite(received) && Math.abs(received + KARACHI_OFFSET_MS) <= 8.64e15
    ? new Date(received + KARACHI_OFFSET_MS).toISOString().slice(0, 10) : null;
}

export function parseNayaPayEmail(email: GmailMessage): ParsedEmailResult {
  const kind = classifyNayaPaySubject(email.subject);
  if (!kind) return { confidence: "low", reason: "unrecognized subject" };
  const label = kind === "sent" ? "Amount Sent" : kind === "got" ? "Amount Received"
    : kind === "reversal" ? "of" : kind === "spent" ? "Amount Paid|spent" : "Amount Paid";
  let amountMatch = labelledAmount(email.bodyText, label);
  // Foreign receipts expose principal + fees rather than Amount Paid. Only use
  // their total when corroborated by the subject, never the principal alone.
  if (kind === "spent" && /\bTransaction Amount\b/i.test(email.bodyText)) {
    amountMatch = labelledAmount(email.bodyText, "Total Amount");
    const subjectAmount = cents(labelledAmount(email.subject, "You spent"));
    if (subjectAmount === null || subjectAmount !== cents(amountMatch)) {
      return { confidence: "low", reason: "ambiguous foreign transaction total" };
    }
  }
  if (!amountMatch) return { confidence: "low", reason: "no amount found" };
  if ((amountMatch[2]?.length ?? 0) > 2) return { confidence: "low", reason: "ambiguous decimal precision" };
  const amountCents = cents(amountMatch);
  if (amountCents === null) return { confidence: "low", reason: "unparseable amount" };

  let vendorRaw: string | undefined;
  if (kind === "sent" || kind === "got") {
    const connector = kind === "sent" ? "to" : "from";
    vendorRaw = email.subject.match(new RegExp(`^You ${kind}${MONEY}\\s+${connector}\\s+(.+)$`, "i"))?.[3];
  } else if (kind === "reversal") {
    const destination = email.bodyText.match(/\bsent\s+to\s+([\s\S]+?)\s+was\s+unsuccessful\b/i)?.[1]?.replace(/\s+/g, " ").trim();
    if (destination) {
      // Preserve masked bank suffixes (e.g. -0001); remove mobile numbers.
      const name = destination.replace(/[-\s]+\+?\d[\d -]{6,}$/, "").trim();
      vendorRaw = `Reversal: ${/mobile top[ -]?up/i.test(email.subject + " " + email.bodyText) ? `${name} mobile top-up` : name}`;
    }
  } else if (kind === "bundle" || kind === "topup") {
    vendorRaw = email.bodyText.match(/\b([A-Za-z][A-Za-z &'-]*?\s+Mobile Top[ -]?Up)\b(?=\s+(?:[\d+]|[A-Za-z]*[xX*]))/i)?.[1];
    // The product begins after the success heading, even in flattened snippets.
    vendorRaw = vendorRaw?.replace(/^.*?\bsuccessful\s+/i, "");
  } else if (kind === "mtag") {
    if (/\bM[ -]?Tag Recharge\b/i.test(email.bodyText)) vendorRaw = "M-Tag Recharge";
  } else {
    // Merchant Details is authoritative and wins over boilerplate at/to text.
    vendorRaw = email.bodyText.match(MERCHANT_DETAILS_PATTERN)?.[1];
    vendorRaw ??= email.subject.match(new RegExp(`^You spent${MONEY}\\s+at\\s+(.+)$`, "i"))?.[3];
    vendorRaw ??= email.bodyText.slice((amountMatch.index ?? 0) + amountMatch[0].length).match(VENDOR_PATTERN)?.[1];
  }
  vendorRaw = vendorRaw?.replace(/\s+/g, " ").trim();
  if (!vendorRaw) return { confidence: "low", reason: "unrecognized layout: no vendor found" };
  const date = extractDate(email);
  if (!date) return { confidence: "low", reason: "unparseable date" };
  return { confidence: "high", amountCents, direction: kind === "got" || kind === "reversal" ? "in" : "out", date, vendorRaw };
}
