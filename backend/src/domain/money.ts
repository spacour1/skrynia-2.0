/**
 * Money is always integer cents. The platform fee rule is FLOOR — the historical
 * ledger was booked under floor, so changing the rounding direction would make old
 * entries unexplainable. Documented in docs/domain-invariants.md.
 */

export type MoneyCents = string;
export type MoneyCentsInput = bigint | string | number;

export const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
export const POSTGRES_BIGINT_MIN = -9_223_372_036_854_775_808n;

export class MoneyRangeError extends RangeError {}

const CANONICAL_INTEGER_PATTERN = /^(?:0|-?[1-9]\d*)$/;

/** Converts a database/BigInt cents value to the canonical persisted and wire form. */
export function bigintToMoneyCents(value: MoneyCentsInput): MoneyCents {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Money cents number must be a safe integer, got ${value}`);
    }
    return assertPostgresBigintRange(BigInt(value)).toString();
  }
  if (typeof value === "bigint") return assertPostgresBigintRange(value).toString();
  return parseMoneyCents(value).toString();
}

function assertPostgresBigintRange(value: bigint): bigint {
  if (value < POSTGRES_BIGINT_MIN || value > POSTGRES_BIGINT_MAX) {
    throw new MoneyRangeError(`Money cents is outside PostgreSQL bigint range: ${value}`);
  }
  return value;
}

/** Parses only canonical decimal integer strings; floats/exponents/whitespace are invalid. */
export function parseMoneyCents(value: string): bigint {
  if (!CANONICAL_INTEGER_PATTERN.test(value)) {
    throw new Error(`Money cents must be a canonical integer string, got "${value}"`);
  }
  return assertPostgresBigintRange(BigInt(value));
}

/** Exact, checked arithmetic for values that are persisted in PostgreSQL bigint columns. */
export function addMoneyCents(left: MoneyCentsInput, right: MoneyCentsInput): MoneyCents {
  const result =
    parseMoneyCents(bigintToMoneyCents(left)) +
    parseMoneyCents(bigintToMoneyCents(right));
  return bigintToMoneyCents(result);
}

/** Exact, checked subtraction for values that are persisted in PostgreSQL bigint columns. */
export function subtractMoneyCents(left: MoneyCentsInput, right: MoneyCentsInput): MoneyCents {
  const result =
    parseMoneyCents(bigintToMoneyCents(left)) -
    parseMoneyCents(bigintToMoneyCents(right));
  return bigintToMoneyCents(result);
}

/** Absolute value that rejects PostgreSQL bigint's asymmetric minimum value. */
export function absoluteMoneyCents(value: MoneyCentsInput): MoneyCents {
  const parsed = parseMoneyCents(bigintToMoneyCents(value));
  return bigintToMoneyCents(parsed < 0n ? -parsed : parsed);
}

/**
 * floor(amountCents * feeBps / 10000) computed in BigInt so the intermediate product
 * cannot lose integer precision, whatever the amount.
 */
export function platformFeeCents(amountCents: MoneyCentsInput, feeBps: number): MoneyCents {
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error(`feeBps must be an integer between 0 and 10000, got ${feeBps}`);
  }
  const amount = parseMoneyCents(bigintToMoneyCents(amountCents));
  if (amount < 0n) throw new Error(`amountCents must be non-negative, got ${amount}`);
  const fee = (amount * BigInt(feeBps)) / 10_000n;
  return bigintToMoneyCents(fee);
}
