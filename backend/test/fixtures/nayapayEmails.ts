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

export const malformedLayoutEmail: GmailMessage = {
  id: "m-malformed",
  threadId: "t-malformed",
  internalDate: "1730000000000",
  subject: "You spent money",
  from: "NayaPay <noreply@nayapay.com>",
  bodyText: "Transaction notice: see attached statement for details.",
};
