export type TestPaymentEnvironment = {
  NODE_ENV: "development" | "test" | "production";
  ENABLE_TEST_PAYMENTS: boolean;
};

/**
 * Mock capture changes real escrow/ledger state, so a flag alone is insufficient:
 * it is usable only by an explicitly test-mode process that also opts in.
 */
export function testPaymentsEnabled(environment: TestPaymentEnvironment) {
  return (
    environment.NODE_ENV === "test" &&
    environment.ENABLE_TEST_PAYMENTS === true
  );
}
