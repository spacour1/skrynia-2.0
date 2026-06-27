import { z } from "zod";
import { badRequest } from "./errors.js";

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24)
});

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Parses a decimal money string into integer cents using exact string/BigInt arithmetic,
 * never floating-point multiplication. `19.1 * 100` can land on 1909.999999999998 in
 * IEEE754; for a marketplace that means wrong fees, wrong balances, and reconciliation
 * drift. Cents amounts here stay far below Number.MAX_SAFE_INTEGER, so returning a plain
 * number keeps it a drop-in replacement for the rest of the codebase's integer-cents math.
 */
export function moneyToCents(value: string): number {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw badRequest(`Invalid money amount: "${value}"`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw badRequest("Money amount too large");
  }
  return Number(cents);
}

/**
 * Inverse of moneyToCents: exact integer div/mod, never a `/100` float division, so
 * payment providers that want a decimal amount (e.g. LiqPay's `amount` field) get the
 * same cents value back without reintroducing a rounding step.
 */
export function centsToDecimalString(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100);
  return `${whole}.${String(remainder).padStart(2, "0")}`;
}
