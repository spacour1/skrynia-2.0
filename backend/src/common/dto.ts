import {
  bigintToMoneyCents,
  type MoneyCentsInput
} from "../domain/money.js";

export type DbDate = Date | string;

export function toIsoDate(value: DbDate): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("Expected a valid database date");
  }
  return parsed.toISOString();
}

export function toNullableIsoDate(
  value: DbDate | null | undefined
): string | null {
  return value == null ? null : toIsoDate(value);
}

export function toMoneyCents(value: MoneyCentsInput): string {
  return bigintToMoneyCents(value);
}

export function toNullableMoneyCents(
  value: MoneyCentsInput | null | undefined
): string | null {
  return value == null ? null : bigintToMoneyCents(value);
}

export function toNumber(value: number | string | bigint): number {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new TypeError("Expected a finite database number");
  }
  return result;
}

export function toInteger(value: number | string | bigint): number {
  const result = toNumber(value);
  if (!Number.isSafeInteger(result)) {
    throw new TypeError("Expected a safe database integer");
  }
  return result;
}

export function toNullableString(
  value: string | null | undefined
): string | null {
  return value ?? null;
}
