import { z } from "zod";
import { badRequest } from "./errors.js";
import {
  bigintToMoneyCents,
  parseMoneyCents,
  POSTGRES_BIGINT_MAX,
  type MoneyCents,
  type MoneyCentsInput
} from "../domain/money.js";

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
 * drift. The canonical cents representation is a decimal string so values remain exact
 * across PostgreSQL bigint, JavaScript, JSON and provider boundaries.
 */
export function moneyToCents(value: string): MoneyCents {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw badRequest(`Invalid money amount: "${value}"`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > POSTGRES_BIGINT_MAX) {
    throw badRequest("Money amount too large");
  }
  return bigintToMoneyCents(cents);
}

/**
 * Inverse of moneyToCents: exact integer div/mod, never a `/100` float division, so
 * payment providers that want a decimal amount (e.g. LiqPay's `amount` field) get the
 * same cents value back without reintroducing a rounding step.
 */
export function centsToDecimalString(cents: MoneyCentsInput): string {
  const parsed = parseMoneyCents(bigintToMoneyCents(cents));
  const sign = parsed < 0n ? "-" : "";
  const magnitude = parsed < 0n ? -parsed : parsed;
  const whole = magnitude / 100n;
  const remainder = magnitude % 100n;
  return `${sign}${whole}.${remainder.toString().padStart(2, "0")}`;
}
