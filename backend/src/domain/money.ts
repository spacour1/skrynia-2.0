/**
 * Money is always integer cents. The platform fee rule is FLOOR — the historical
 * ledger was booked under floor, so changing the rounding direction would make old
 * entries unexplainable. Documented in docs/domain-invariants.md.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * floor(amountCents * feeBps / 10000) computed in BigInt so the intermediate product
 * cannot lose integer precision, whatever the amount.
 */
export function platformFeeCents(amountCents: number | bigint, feeBps: number): number {
  if (typeof amountCents === "number" && !Number.isSafeInteger(amountCents)) {
    throw new Error(`amountCents must be a safe integer, got ${amountCents}`);
  }
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error(`feeBps must be an integer between 0 and 10000, got ${feeBps}`);
  }
  const amount = BigInt(amountCents);
  if (amount < 0n) throw new Error(`amountCents must be non-negative, got ${amount}`);
  const fee = (amount * BigInt(feeBps)) / 10_000n;
  if (fee > MAX_SAFE) throw new Error("fee exceeds Number.MAX_SAFE_INTEGER");
  return Number(fee);
}
