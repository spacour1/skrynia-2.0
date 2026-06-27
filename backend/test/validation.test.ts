import { describe, expect, it } from "vitest";
import { centsToDecimalString, moneyToCents } from "../src/common/validation.js";

describe("moneyToCents", () => {
  it("parses whole amounts", () => {
    expect(moneyToCents("100")).toBe(10_000);
  });

  it("parses amounts with one decimal digit", () => {
    expect(moneyToCents("19.1")).toBe(1910);
  });

  it("parses amounts with two decimal digits", () => {
    expect(moneyToCents("549.99")).toBe(54_999);
  });

  it("never produces floating-point rounding drift", () => {
    // 19.1 * 100 is 1909.999999999998 in IEEE754; this must not leak through.
    expect(moneyToCents("0.1")).toBe(10);
    expect(moneyToCents("0.29")).toBe(29);
  });

  it("rejects negative amounts", () => {
    expect(() => moneyToCents("-5")).toThrow("Invalid money amount");
  });

  it("rejects more than two decimal digits", () => {
    expect(() => moneyToCents("5.123")).toThrow("Invalid money amount");
  });

  it("rejects non-numeric input", () => {
    expect(() => moneyToCents("abc")).toThrow("Invalid money amount");
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(() => moneyToCents("999999999999999999")).toThrow("Money amount too large");
  });
});

describe("centsToDecimalString", () => {
  it("formats whole amounts with two decimal places", () => {
    expect(centsToDecimalString(54_900)).toBe("549.00");
  });

  it("formats amounts under a dollar", () => {
    expect(centsToDecimalString(5)).toBe("0.05");
  });

  it("round-trips through moneyToCents", () => {
    expect(moneyToCents(centsToDecimalString(123_456))).toBe(123_456);
  });

  it("formats zero", () => {
    expect(centsToDecimalString(0)).toBe("0.00");
  });
});
