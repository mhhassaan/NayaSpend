import { describe, expect, test } from "vitest";
import { classifyNayaPaySubject, parseNayaPayEmail } from "../src/adapters/parseNayaPayEmail";
import { matchesNayaPayScope } from "../src/adapters/gmailAdapter";
import { NAYAPAY_QUERY } from "../src/adapters/gmailClient";
import { classifyByKeyword } from "../src/services/categorizationEngine";
import { cleanTransactionEmail, pkrFormatEmail, realWorldSpendEmail, emailKindFixtures } from "./fixtures/nayapayEmails";

describe("NayaPay receipt kinds", () => {
  for (const fixture of emailKindFixtures) {
    test(`parses ${fixture.email.id}`, () => {
      const { email, kind, ...expected } = fixture;
      expect(classifyNayaPaySubject(email.subject)).toBe(kind);
      expect(parseNayaPayEmail(email)).toEqual({ confidence: "high", ...expected });
      expect(matchesNayaPayScope(email)).toBe(true);
      expect(matchesNayaPayScope({ ...email, subject: email.subject.toUpperCase() })).toBe(true);
      expect(matchesNayaPayScope({ ...email, from: "Other <hello@example.com>" })).toBe(false);
    });
  }
  test.each(["Account statement", "Welcome to NayaPay", "You received a coupon", "Your order shipped"])("rejects unrelated subject %s", subject => {
    expect(classifyNayaPaySubject(subject)).toBeNull();
    expect(matchesNayaPayScope({ ...cleanTransactionEmail, subject })).toBe(false);
    expect(parseNayaPayEmail({ ...cleanTransactionEmail, subject }).confidence).toBe("low");
  });
  test("query contains every scope phrase", () => {
    expect(NAYAPAY_QUERY).toBe('from:nayapay.com (subject:"You spent" OR subject:"You sent" OR subject:"You got" OR subject:"You subscribed" OR subject:"You topped up" OR subject:"You recharged" OR subject:"reversed")');
  });
  test("preserves existing spends and PKR amounts", () => {
    expect(parseNayaPayEmail(cleanTransactionEmail)).toEqual({ confidence: "high", direction: "out", amountCents: 125000, vendorRaw: "Starbucks", date: "2026-10-27" });
    expect(parseNayaPayEmail(pkrFormatEmail)).toMatchObject({ confidence: "high", direction: "out", amountCents: 50000, vendorRaw: "Daraz Online Store" });
    expect(parseNayaPayEmail(realWorldSpendEmail)).toEqual({ confidence: "high", direction: "out", amountCents: 247100, vendorRaw: "KHAYABAN PHARMACYY Lahore PK", date: "2026-11-04" });
    expect(parseNayaPayEmail({ ...realWorldSpendEmail, bodyText: realWorldSpendEmail.bodyText.replace("TRANSACTION DETAILS", "Please reply to this email. TRANSACTION DETAILS") })).toMatchObject({ vendorRaw: "KHAYABAN PHARMACYY Lahore PK" });
  });
  test.each(emailKindFixtures)("quarantines missing labels or excessive precision for $email.id", ({ email }) => {
    expect(parseNayaPayEmail({ ...email, bodyText: "Unexpected receipt layout Rs. 123" }).confidence).toBe("low");
    expect(parseNayaPayEmail({ ...email, bodyText: email.bodyText.replace(/Rs\. [\d,.]+/g, "Rs. 1250.555") }).confidence).toBe("low");
  });
  test("reversal requires an amount and destination in the body", () => {
    const email = emailKindFixtures[9].email;
    expect(parseNayaPayEmail({ ...email, bodyText: "Transaction failed, amount reversed!" }).confidence).toBe("low");
  });
  test("Karachi fallback crosses midnight; body date remains local without offset", () => {
    expect(parseNayaPayEmail({ ...cleanTransactionEmail, internalDate: String(Date.parse("2026-11-10T20:30:00Z")), bodyText: "You spent Rs. 5 at Shop." })).toMatchObject({ date: "2026-11-11" });
    expect(parseNayaPayEmail({ ...emailKindFixtures[0].email, bodyText: emailKindFixtures[0].email.bodyText.replace("03:41 PM", "11:59 PM") })).toMatchObject({ date: "2026-11-11" });
  });
  test("foreign spends use total/subject amount rather than transaction principal", () => {
    const email = { ...cleanTransactionEmail, subject: "You spent Rs. 1,559.13 at OPENAI +14158799686 US", bodyText: "Your online transaction was successful OPENAI Online Transaction 11 Nov 2026, 11:55 PM AMOUNT DETAILS Transaction Amount Rs. 1400 Int. Transaction Fees Rs. 69.25 SST on Fees Rs. 89.88 Total Amount Rs. 1,559.13" };
    expect(parseNayaPayEmail(email)).toMatchObject({ confidence: "high", amountCents: 155913, direction: "out", vendorRaw: "OPENAI +14158799686 US" });
    expect(parseNayaPayEmail({ ...email, bodyText: email.bodyText.replace("1,559.13", "1,600") }).confidence).toBe("low");
  });
  test("product keyword defaults", () => {
    expect(classifyByKeyword("m-tag recharge")).toBe("Transport");
    expect(classifyByKeyword("zong mobile top-up")).toBe("Utilities");
    expect(classifyByKeyword("jazz mobile top-up")).toBe("Utilities");
  });
});

// Whitespace follows both flattened snippets and decoded multi-line bodies.
test("parses split labels and a multi-line reversal destination", () => {
  const incoming = emailKindFixtures[7].email;
  expect(parseNayaPayEmail({ ...incoming, bodyText: incoming.bodyText.replace("Amount Received", "Amount\nReceived") })).toMatchObject({ confidence: "high", direction: "in", amountCents: 196999 });
  const reversal = emailKindFixtures[9].email;
  expect(parseNayaPayEmail({ ...reversal, bodyText: reversal.bodyText.replace("MCB Islamic-0001", "MCB\nIslamic-0001") })).toMatchObject({ confidence: "high", vendorRaw: "Reversal: MCB Islamic-0001" });
});
test("malformed body date returns low confidence without throwing", () => {
  const email = emailKindFixtures[0].email;
  expect(parseNayaPayEmail({ ...email, bodyText: email.bodyText.replace("11 Nov 2026", "99 Nov 2026") }).confidence).toBe("low");
});
test.each(["online", "retail"])("preserves %s spend receipts", channel => {
  const email = emailKindFixtures[0].email;
  expect(parseNayaPayEmail({ ...email, bodyText: email.bodyText.replace("Your transaction", `Your ${channel} transaction`).replace("POS Transaction", `${channel} Transaction`) })).toMatchObject({ confidence: "high", amountCents: 30100, direction: "out" });
});
test("reversal amount comes from body even when subject differs", () => {
  const email = emailKindFixtures[9].email;
  expect(parseNayaPayEmail({ ...email, subject: "Transaction of Rs. 2,000 reversed" })).toMatchObject({ confidence: "high", amountCents: 110000, direction: "in" });
});
