"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  localeFromPathname,
  localeToLang,
  stripLocaleFromPathname,
  type Locale
} from "../i18n/config";
import { translate, type TranslateParams } from "../i18n/dictionaries";
import { apiFetch } from "./api";
import { useAuth } from "./auth-store";

export type { Locale };

const LocaleContext = createContext<Locale | null>(null);

/** Mounted once in app/[locale]/layout.tsx — makes the URL locale available to every client component. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  const fromContext = useContext(LocaleContext);
  if (fromContext) return fromContext;
  // Fallback for components rendered outside the provider (should not happen in practice).
  if (typeof window !== "undefined") {
    const fromPath = localeFromPathname(window.location.pathname);
    if (fromPath) return fromPath;
  }
  return defaultLocale;
}

export function setLocaleCookie(locale: Locale) {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : null;
  return isLocale(value) ? value : null;
}

export function useI18n() {
  const locale = useLocale();
  const router = useRouter();
  const user = useAuth((s) => s.user);

  return useMemo(
    () => ({
      locale,
      /** ISO language code ("uk" for the /ua locale) — for Intl APIs and html lang. */
      language: localeToLang[locale],
      t: (key: string, params?: TranslateParams) => translate(locale, key, params),
      /**
       * Switches the language in place: saves the cookie (and the authed user's
       * preferred_locale), then swaps the URL prefix keeping path + query intact.
       * No full page reload — the App Router re-renders the [locale] tree.
       */
      switchLocale: (next: Locale) => {
        if (next === locale) return;
        setLocaleCookie(next);
        if (user) {
          apiFetch("/users/me/locale", { method: "PATCH", body: JSON.stringify({ locale: next }) }).catch(() => undefined);
        }
        document.documentElement.lang = localeToLang[next];
        const { pathname, search, hash } = window.location;
        const rest = stripLocaleFromPathname(pathname);
        router.push(`/${next}${rest === "/" ? "" : rest}${search}${hash}`);
      }
    }),
    [locale, router, user]
  );
}
