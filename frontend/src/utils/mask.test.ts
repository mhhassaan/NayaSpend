import { describe, expect, test } from "vitest";
import { maskAccountNumbers } from "./mask";

describe("maskAccountNumbers", () => {
  test("masks a run of 8+ digits down to a bullet prefix and the last 4 digits", () => {
    expect(maskAccountNumbers("Acct 1234567890")).toBe("Acct ••••7890");
  });

  test("leaves short numbers (under 8 digits) alone", () => {
    expect(maskAccountNumbers("Order #12345")).toBe("Order #12345");
  });

  test("masks every matching run when there are several", () => {
    expect(maskAccountNumbers("From 11112222 to 33334444")).toBe("From ••••2222 to ••••4444");
  });

  test("leaves text with no digit runs unchanged", () => {
    expect(maskAccountNumbers("Daraz Pakistan")).toBe("Daraz Pakistan");
  });
});
