import { describe, expect, test } from "vitest";
import { parseNayaPayEmail } from "../src/adapters/parseNayaPayEmail";
import {
  cleanTransactionEmail,
  malformedLayoutEmail,
  pkrFormatEmail,
  promoEmailNoAmount,
} from "./fixtures/nayapayEmails";

describe("parseNayaPayEmail", () => {
  test("parses a clean 'Rs. 1,250.00' transaction email to 125000 cents", () => {
    const result = parseNayaPayEmail(cleanTransactionEmail);
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(125000);
      expect(result.vendorRaw).toContain("Starbucks");
    }
  });

  test("parses a 'PKR 500' format email to 50000 cents", () => {
    const result = parseNayaPayEmail(pkrFormatEmail);
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(50000);
    }
  });

  test("a matching email with no transaction amount is low-confidence, not thrown", () => {
    const result = parseNayaPayEmail(promoEmailNoAmount);
    expect(result.confidence).toBe("low");
  });

  test("a malformed/unexpected body layout is low-confidence, not thrown", () => {
    const result = parseNayaPayEmail(malformedLayoutEmail);
    expect(result.confidence).toBe("low");
  });

  test("a 'PKR 1250' amount with no decimal point still parses to 125000 cents", () => {
    const result = parseNayaPayEmail({
      ...pkrFormatEmail,
      subject: "You spent PKR 1250",
      bodyText: "You spent PKR 1250 to Some Vendor on 2026-10-27.",
    });
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(125000);
    }
  });
});
