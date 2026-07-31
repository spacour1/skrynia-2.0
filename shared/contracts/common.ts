export type IsoDateString = string;
export type Nullable<T> = T | null;

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export function toIsoDateString(value: Date | string): IsoDateString {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("Expected a valid API date");
  }
  return parsed.toISOString();
}

export function toNullableIsoDateString(
  value: Date | string | null | undefined
): IsoDateString | null {
  return value == null ? null : toIsoDateString(value);
}
