import { badRequest } from "../../common/errors.js";
import { centsToDecimalString } from "../../common/validation.js";
import {
  bigintToMoneyCents,
  parseMoneyCents,
  type MoneyCents
} from "../../domain/money.js";

const MAX_PROVIDER_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function providerSafeCents(amountCents: MoneyCents): bigint {
  const amount = parseMoneyCents(bigintToMoneyCents(amountCents));
  if (amount < 0n || amount > MAX_PROVIDER_SAFE_INTEGER) {
    throw badRequest("Payment amount exceeds the provider's exact numeric range");
  }
  return amount;
}

/** For provider contracts that require integer cents as a JSON number. */
export function moneyCentsToProviderInteger(amountCents: MoneyCents): number {
  return Number(providerSafeCents(amountCents));
}

/** For provider contracts that require major units as a two-decimal JSON number. */
export function moneyCentsToProviderDecimal(amountCents: MoneyCents): number {
  providerSafeCents(amountCents);
  const decimal = centsToDecimalString(amountCents);
  const amount = Number(decimal);
  if (!Number.isFinite(amount) || amount.toFixed(2) !== decimal) {
    throw badRequest("Payment amount cannot be represented exactly for this provider");
  }
  return amount;
}
