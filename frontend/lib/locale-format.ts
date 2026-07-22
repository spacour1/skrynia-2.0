import { defaultLocale, isLocale, localeToIntl, type Locale } from "@/i18n/config";

export type ActiveLocale = Locale | string;
export type FormattableDate = Date | string | number;

/**
 * Resolve the application's URL locale to a deterministic regional Intl locale.
 * Unknown values fall back to the configured app default, never the browser locale.
 */
export function resolveIntlLocale(locale: ActiveLocale): string {
  return localeToIntl[isLocale(locale) ? locale : defaultLocale];
}

/** Formats number and bigint values without coercing exact integer values to Number. */
export function formatNumber(
  value: number | bigint,
  locale: ActiveLocale,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(resolveIntlLocale(locale), options).format(value);
}

export function formatNumberToParts(
  value: number | bigint,
  locale: ActiveLocale,
  options?: Intl.NumberFormatOptions
): Intl.NumberFormatPart[] {
  return new Intl.NumberFormat(resolveIntlLocale(locale), options).formatToParts(value);
}

/** Formats a date with the selected app locale; callers control timezone explicitly when needed. */
export function formatDate(
  value: FormattableDate,
  locale: ActiveLocale,
  options?: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), options).format(toDate(value));
}

function toDate(value: FormattableDate): Date {
  return value instanceof Date ? value : new Date(value);
}
