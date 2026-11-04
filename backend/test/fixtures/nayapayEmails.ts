import type { GmailMessage } from "../../src/adapters/gmailClient";

export const cleanTransactionEmail: GmailMessage = {
  id: "m-clean",
  threadId: "t-clean",
  internalDate: "1730000000000",
  subject: "You spent Rs. 1,250.00",
  from: "NayaPay <noreply@nayapay.com>",
  bodyText: "You spent Rs. 1,250.00 at Starbucks on 2026-10-27. Your available balance is Rs. 5,000.00.",
};

export const pkrFormatEmail: GmailMessage = {
  id: "m-pkr",
  threadId: "t-pkr",
  internalDate: "1730000000000",
  subject: "You spent PKR 500",
  from: "NayaPay <noreply@nayapay.com>",
  bodyText: "You spent PKR 500 to Daraz Online Store on 2026-10-27.",
};

export const promoEmailNoAmount: GmailMessage = {
  id: "m-promo",
  threadId: "t-promo",
  internalDate: "1730000000000",
  subject: "You spent less time waiting - new NayaPay feature!",
  from: "NayaPay <noreply@nayapay.com>",
  bodyText: "Check out our new instant transfer feature, now live in the app!",
};

// Reconstructed verbatim (labels, line breaks, wording) from a real NayaPay
// "You spent" transaction email -- the fixtures above were an assumed
// format that was never validated against a real message, and real
// NayaPay emails don't contain the word "spent" anywhere in the body (only
// in the subject); the body is a receipt-style template keyed off labels
// like "Amount Paid" and "Merchant Details" / "Merchant UIC".
export const realWorldSpendEmail: GmailMessage = {
  id: "m-real",
  threadId: "t-real",
  internalDate: "1762277160000",
  subject: "You spent Rs. 2,471 at KHAYABAN PHARMACYY Lahore PK",
  from: "NayaPay <service@nayapay.com>",
  bodyText: [
    "Your transaction was successful",
    "KHAYABAN PHARMACYY",
    "Lahore PK",
    "POS Transaction",
    "04 Nov 2026, 07:26 PM",
    "- Rs. 2,471",
    "AMOUNT DETAILS",
    "Amount Paid Rs. 2,471",
    "Service Fee (Incl. Tax) Rs. 0",
    "Total Amount Rs. 2,471",
    "TRANSACTION DETAILS",
    "Transaction ID 896508",
    "ADDITIONAL INFORMATION",
    "Card Visa \u25cf\u25cf\u25cf\u25cf8978",
    "Type of Transaction PAN auto entry via ICC read from contactless Interface Terminal does not have PIN entry capability.",
    "Acquiring Bank -",
    "Merchant Category Drug Stores and Pharmacies",
    "Merchant Details KHAYABAN PHARMACYY",
    "Lahore PK",
    "Merchant UIC 726995912573887",
  ].join("\n"),
};

export const malformedLayoutEmail: GmailMessage = {
  id: "m-malformed",
  threadId: "t-malformed",
  internalDate: "1730000000000",
  subject: "You spent money",
  from: "NayaPay <noreply@nayapay.com>",
  bodyText: "Transaction notice: see attached statement for details.",
};
