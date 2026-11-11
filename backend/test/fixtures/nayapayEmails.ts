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

// Fictional names and IDs; receipt wording follows the supplied inbox snippets.
function receipt(id: string, subject: string, bodyText: string): GmailMessage {
  return { id, threadId: `thread-${id}`, subject, bodyText,
    from: "NayaPay <service@nayapay.com>",
    internalDate: String(Date.parse("2026-11-10T20:30:00Z")) };
}

export const emailKindFixtures = [
  { kind: "spent", direction: "out", amountCents: 30100, vendorRaw: "RI CASH AND CARRY LAHORE PK", date: "2026-11-11",
    email: receipt("spent-pos", "You spent Rs. 301 at RI CASH AND CARRY LAHORE PK", "Your transaction was successful RI CASH AND CARRY LAHORE PK POS Transaction 11 Nov 2026, 03:41 PM - Rs. 301 AMOUNT DETAILS Amount Paid Rs. 301 Service Fee (Incl. Tax) Rs. 0 Total Amount Rs. 301") },
  { kind: "sent", direction: "out", amountCents: 200000, vendorRaw: "Sara Malik", date: "2026-11-11",
    email: receipt("sent-wallet", "You sent Rs. 2,000 to Sara Malik", "Sara Malik saramalik@nayapay 11 Nov 2026, 08:43 PM - Rs. 2000 AMOUNT DETAILS Principal Amount Rs. 2000 Service Fee (Incl. Tax) Rs. 0 Amount Sent Rs. 2000 TRANSACTION DETAILS Transaction ID fictional-201") },
  { kind: "sent", direction: "out", amountCents: 40000, vendorRaw: "Raza Auto Parts And Oil Store", date: "2026-11-11",
    email: receipt("sent-bank", "You sent Rs. 400 to Raza Auto Parts And Oil Store", "Raza Auto Parts And Oil Store Bank Alfalah-1234 11 Nov 2026, 07:14 PM - Rs. 400 AMOUNT DETAILS Amount Sent Rs. 400 Service Fee (Incl. Tax) Rs. 0 Total Amount Rs. 400 TRANSACTION DETAILS Transaction ID fictional-202") },
  { kind: "sent", direction: "out", amountCents: 67000, vendorRaw: "Ali Iqbal", date: "2026-11-11",
    email: receipt("sent-jazzcash", "You sent Rs. 670 to Ali Iqbal", "Ali Iqbal Mobilink Microfinance Bank 11 Nov 2026, 07:14 PM AMOUNT DETAILS Amount Sent Rs. 670 Service Fee (Incl. Tax) Rs. 0 Total Amount Rs. 670") },
  { kind: "bundle", direction: "out", amountCents: 25000, vendorRaw: "Zong Mobile Top-Up", date: "2026-11-10",
    email: receipt("bundle", "You subscribed to a mobile bundle of Rs. 250", "Your Mobile Top-Up was successful Zong Mobile Top-Up 10 Nov 2026, 10:30 AM - Rs. 250 AMOUNT DETAILS Amount Paid Rs. 250 Service Fee (Incl. Tax) Rs. 0 Total Amount Rs. 250 TRANSACTION DETAILS Mobile 03123456789") },
  { kind: "topup", direction: "out", amountCents: 10000, vendorRaw: "Jazz Mobile Top-Up", date: "2026-11-11",
    email: receipt("topup", "You topped up your mobile balance with Rs. 100", "Your Mobile Top-Up was successful Jazz Mobile Top-Up 03001234567 11 Nov 2026, 11:55 PM AMOUNT DETAILS Amount Paid Rs. 100 Total Amount Rs. 100") },
  { kind: "mtag", direction: "out", amountCents: 50000, vendorRaw: "M-Tag Recharge", date: "2026-10-30",
    email: receipt("mtag", "You recharged your M-Tag with Rs. 500", "Your M-Tag recharge was successful M-Tag Recharge LExxxxxx5 30 Oct 2026, 09:22 PM AMOUNT DETAILS Amount Paid Rs. 500 Service Fee (Incl. Tax) Rs. 0 Total Amount Rs. 500") },
  { kind: "got", direction: "in", amountCents: 196999, vendorRaw: "Ayesha Noor", date: "2026-11-10",
    email: receipt("got-wallet", "You got Rs. 1,969.99 from Ayesha Noor", "Cha-Ching! Ayesha Noor ayeshanoor@nayapay 10 Nov 2026, 08:20 PM Rs. 1,969.99 AMOUNT DETAILS Principal Amount Rs. 1,969.99 Service Fee (Incl. Tax) Rs. 0 Amount Received Rs. 1,969.99 TRANSACTION DETAILS Transaction ID fictional-203") },
  { kind: "got", direction: "in", amountCents: 300000, vendorRaw: "Bank Alfalah-1234", date: "2026-11-09",
    email: receipt("got-bank", "You got Rs. 3,000 from Bank Alfalah-1234", "Incoming Fund Transfer Bank Alfalah-1234 09 Nov 2026, 08:52 PM Rs. 3000 AMOUNT DETAILS Amount Received Rs. 3000 TRANSACTION DETAILS Transaction ID fictional-204") },
  { kind: "reversal", direction: "in", amountCents: 110000, vendorRaw: "Reversal: MCB Islamic-0001", date: "2026-11-11",
    email: receipt("reversal-bank", "Transaction of Rs. 1,100 reversed", "Transaction failed, amount reversed! Hi Test! Your transaction of Rs. 1,100 sent to MCB Islamic-0001 was unsuccessful, but don't worry, we've reversed the amount to your NayaPay wallet.") },
  { kind: "reversal", direction: "in", amountCents: 50000, vendorRaw: "Reversal: Jazz mobile top-up", date: "2026-11-11",
    email: receipt("reversal-topup", "Mobile Top-Up reversed", "Mobile Top-Up failed, amount reversed! Hi Test! Your Mobile Top-Up of Rs. 500 sent to Jazz-03001234567 was unsuccessful, but don't worry, we've reversed the amount to your NayaPay wallet.") },
] as const;
