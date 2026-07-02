import type { Request, RequestHandler } from "express";
import { logger } from "../common/logger.js";
import { defaultLocale, isLocale, LOCALE_COOKIE, normalizeLocale, type Locale } from "./config.js";
import ua from "./locales/ua.js";
import ru from "./locales/ru.js";
import en from "./locales/en.js";

type NestedDictionary = { [key: string]: string | NestedDictionary };
type FlatDictionary = Record<string, string>;

function flatten(value: NestedDictionary, prefix: string, into: FlatDictionary): FlatDictionary {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "string") into[path] = item;
    else flatten(item, path, into);
  }
  return into;
}

const dictionaries: Record<Locale, FlatDictionary> = {
  ua: flatten(ua as unknown as NestedDictionary, "", {}),
  ru: flatten(ru as unknown as NestedDictionary, "", {}),
  en: flatten(en as unknown as NestedDictionary, "", {})
};

// Startup sanity check: every locale must expose the same key set. Logged once,
// never fatal — a missing key falls back to the default locale at runtime.
(() => {
  const reference = Object.keys(dictionaries[defaultLocale]).sort();
  for (const locale of ["ru", "en"] as const) {
    const keys = new Set(Object.keys(dictionaries[locale]));
    const missing = reference.filter((key) => !keys.has(key));
    const extra = Object.keys(dictionaries[locale]).filter((key) => !(key in dictionaries[defaultLocale]));
    if (missing.length || extra.length) {
      logger.warn({ locale, missing, extra }, "i18n_locale_keys_out_of_sync");
    }
  }
})();

export type TranslateParams = Record<string, string | number>;

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name])
  );
}

/** Backend translation lookup with fallback: locale -> default locale (ua) -> raw key. */
export function t(locale: Locale, key: string, params?: TranslateParams): string {
  const exact = dictionaries[locale]?.[key];
  if (exact !== undefined) return interpolate(exact, params);
  if (process.env.NODE_ENV !== "production") {
    logger.warn({ locale, key }, "i18n_missing_translation");
  }
  const fallback = dictionaries[defaultLocale][key];
  if (fallback !== undefined) return interpolate(fallback, params);
  return key;
}

/** Curried form for call sites that translate several keys with one locale. */
export function getT(locale: Locale) {
  return (key: string, params?: TranslateParams) => t(locale, key, params);
}

/**
 * Resolves the request locale: x-locale header (sent by the frontend API client) ->
 * skrynia_locale cookie -> default. User preference lives in users.preferred_locale and
 * wins only when the caller passes it explicitly (e.g. for emails sent outside a request).
 */
export function getRequestLocale(req: Request): Locale {
  const header = req.header("x-locale");
  if (isLocale(header)) return header;
  const cookie = (req.cookies as Record<string, string> | undefined)?.[LOCALE_COOKIE];
  if (isLocale(cookie)) return cookie;
  const acceptLanguage = req.header("accept-language");
  if (acceptLanguage) return normalizeLocale(acceptLanguage.split(",")[0]);
  return defaultLocale;
}

/** Attaches req.locale so route handlers don't re-derive it. Mounted app-wide in app.ts. */
export const localeContext: RequestHandler = (req, _res, next) => {
  req.locale = getRequestLocale(req);
  next();
};

declare global {
  namespace Express {
    interface Request {
      locale?: Locale;
    }
  }
}
