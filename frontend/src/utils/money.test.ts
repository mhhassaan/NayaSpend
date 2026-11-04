import { describe, expect, test } from "vitest";
import { formatCents, parseRupeesToCents } from "./money";

describe("formatCents", () => {
  test("formats whole cents as a rupee figure with two decimals", () => {
    expect(formatCents(150000)).toBe("Rs. 1,500.00");
  });

  test("formats zero", () => {
    expect(formatCents(0)).toBe("Rs. 0.00");
  });
});

describe("parseRupeesToCents", () => {
  test("converts a whole-rupee string to cents", () => {
    expect(parseRupeesToCents("5000")).toBe(500000);
  });

  test("converts a fractional-rupee string to cents, rounding", () => {
    expect(parseRupeesToCents("10.005")).toBe(1001);
  });

  test("round-trips with formatCents", () => {
    expect(formatCents(parseRupeesToCents("1500"))).toBe("Rs. 1,500.00");
  });
});
