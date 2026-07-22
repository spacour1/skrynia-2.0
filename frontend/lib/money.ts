export type WireMoneyCents = string;
export type MoneyCents = bigint | number | string;
export type MoneyFormatter = (cents?: MoneyCents, sourceCurrency?: string, options?: { preserveCurrency?: boolean }) => string;

/** Converts cents to an exact integer. Numbers are accepted only for bounded local values. */
export function moneyCentsToBigInt(cents: MoneyCents): bigint {
  if (typeof cents === "bigint") return cents;
  if (typeof cents === "number") {
    if (!Number.isSafeInteger(cents)) throw new TypeError("Money cents must be a safe integer");
    return BigInt(cents);
  }
  if (!/^-?\d+$/.test(cents)) throw new TypeError("Money cents must be an integer decimal string");
  return BigInt(cents);
}

export function sumMoneyCents(amounts: Iterable<MoneyCents>): bigint {
  let total = 0n;
  for (const amount of amounts) total += moneyCentsToBigInt(amount);
  return total;
}

export function addMoneyCents(...amounts: MoneyCents[]): bigint {
  return sumMoneyCents(amounts);
}

export function sumMoneyCentsByCurrency(amounts: Iterable<{ currency: string; cents: MoneyCents }>): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const { currency, cents } of amounts) {
    totals.set(currency, (totals.get(currency) ?? 0n) + moneyCentsToBigInt(cents));
  }
  return totals;
}

export function subtractMoneyCents(left: MoneyCents, right: MoneyCents): bigint {
  return moneyCentsToBigInt(left) - moneyCentsToBigInt(right);
}

export function absMoneyCents(cents: MoneyCents): bigint {
  const value = moneyCentsToBigInt(cents);
  return value < 0n ? -value : value;
}

export function isZeroMoneyCents(cents: MoneyCents): boolean {
  return moneyCentsToBigInt(cents) === 0n;
}

export function isPositiveMoneyCents(cents: MoneyCents): boolean {
  return moneyCentsToBigInt(cents) > 0n;
}

/** Returns a whole-number discount, rounded to the nearest percent without floats. */
export function calculateDiscountPercent(currentCents: MoneyCents, oldCents?: MoneyCents | null): number {
  if (oldCents == null) return 0;
  const current = moneyCentsToBigInt(currentCents);
  const old = moneyCentsToBigInt(oldCents);
  if (current < 0n || old <= 0n || current >= old) return 0;
  return Number(roundDiv((old - current) * 100n, old));
}

/** Exact decimal major-unit value for JSON-LD and editable decimal form fields. */
export function moneyCentsToMajorUnits(cents: MoneyCents): string {
  const value = moneyCentsToBigInt(cents);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function majorUnitsToMoneyCents(value: string): bigint {
  const match = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new TypeError("Money must have at most two decimal places");
  const [, sign, whole, fraction = ""] = match;
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  return sign === "-" ? -cents : cents;
}

export function multiplyMoneyCentsByRatio(cents: MoneyCents, numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Money ratio denominator must not be zero");
  return roundDiv(moneyCentsToBigInt(cents) * numerator, denominator);
}

function roundDiv(numerator: bigint, denominator: bigint) {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;
  const rounded = (top + bottom / 2n) / bottom;
  return negative ? -rounded : rounded;
}
