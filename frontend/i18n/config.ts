// Single source of truth for everything locale-related on the frontend.
// URL prefixes use "ua" (product decision), while the ISO language code for
// <html lang> / Intl APIs is "uk" — localeToLang maps between the two.

export const locales = ["ua", "ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ua";

export const LOCALE_COOKIE = "skrynia_locale";
// One year — the language choice should survive between visits.
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const localeToLang: Record<Locale, string> = {
  ua: "uk",
  ru: "ru",
  en: "en"
};

export const localeLabels: Record<Locale, string> = {
  ua: "Українська",
  ru: "Русский",
  en: "English"
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Extracts the locale from a pathname like "/ru/products/1"; null when absent/unknown. */
export function localeFromPathname(pathname: string): Locale | null {
  const first = pathname.split("/")[1];
  return isLocale(first) ? first : null;
}

/** "/ru/products/1" -> "/products/1"; keeps paths without a prefix untouched. */
export function stripLocaleFromPathname(pathname: string): string {
  const locale = localeFromPathname(pathname);
  if (!locale) return pathname;
  const rest = pathname.slice(locale.length + 1);
  return rest === "" ? "/" : rest;
}

/** Prefixes an app-internal path with the locale. External URLs pass through unchanged. */
export function localizeHref(locale: Locale, href: string): string {
  if (!href.startsWith("/")) return href;
  // Already localized (e.g. produced by another helper) — don't double-prefix.
  if (localeFromPathname(href)) return href;
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}

/** Maps Accept-Language / navigator.language to our locale set. */
export function matchBrowserLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("uk") || normalized.startsWith("ua")) return "ua";
  if (normalized.startsWith("ru")) return "ru";
  if (normalized.startsWith("en")) return "en";
  return null;
}
