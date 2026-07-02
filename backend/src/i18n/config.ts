// Locale configuration shared by every backend module. URL/user-facing codes are
// ua|ru|en (same as the frontend); "ua" maps to ISO "uk" where an ISO code is needed.

export const locales = ["ua", "ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ua";

export const LOCALE_COOKIE = "skrynia_locale";

export const localeToLang: Record<Locale, string> = {
  ua: "uk",
  ru: "ru",
  en: "en"
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Coerces arbitrary input (header, cookie, DB value) to a supported locale. */
export function normalizeLocale(value: unknown): Locale {
  if (isLocale(value)) return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower.startsWith("uk") || lower.startsWith("ua")) return "ua";
    if (lower.startsWith("ru")) return "ru";
    if (lower.startsWith("en")) return "en";
  }
  return defaultLocale;
}
