import { describe, expect, it } from "vitest";
import { testPaymentsEnabled } from "../src/modules/payments/test-payments.gate.js";

describe("test-payment environment gate", () => {
  it.each([
    ["production", false, false],
    ["production", true, false],
    ["development", false, false],
    ["development", true, false],
    ["test", false, false],
    ["test", true, true]
  ] as const)(
    "NODE_ENV=%s ENABLE_TEST_PAYMENTS=%s => %s",
    (NODE_ENV, ENABLE_TEST_PAYMENTS, expected) => {
      expect(testPaymentsEnabled({ NODE_ENV, ENABLE_TEST_PAYMENTS })).toBe(
        expected
      );
    }
  );
});
