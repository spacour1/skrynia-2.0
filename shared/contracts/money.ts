/**
 * Persisted and wire money is always an integer decimal string of cents.
 * Floating-point major units never cross an API contract.
 */
export type MoneyCents = string;
export type MoneyCentsInput = bigint | string | number;

export const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
export const POSTGRES_BIGINT_MIN = -9_223_372_036_854_775_808n;

const CANONICAL_INTEGER_PATTERN = /^(?:0|-?[1-9]\d*)$/;

function assertPostgresBigintRange(value: bigint): bigint {
  if (value < POSTGRES_BIGINT_MIN || value > POSTGRES_BIGINT_MAX) {
    throw new RangeError(`Money cents is outside PostgreSQL bigint range: ${value}`);
  }
  return value;
}

export function bigintToMoneyCents(value: MoneyCentsInput): MoneyCents {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Money cents number must be a safe integer");
    }
    return assertPostgresBigintRange(BigInt(value)).toString();
  }
  if (typeof value === "bigint") {
    return assertPostgresBigintRange(value).toString();
  }
  return parseMoneyCents(value).toString();
}

export function parseMoneyCents(value: MoneyCents): bigint {
  if (!CANONICAL_INTEGER_PATTERN.test(value)) {
    throw new TypeError("Money cents must be a canonical integer decimal string");
  }
  return assertPostgresBigintRange(BigInt(value));
}
