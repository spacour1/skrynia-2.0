"use client";

// Locale-aware drop-in replacements for next/link and next/navigation. Pages and
// components import Link/useRouter/usePathname from here instead of next/*, so every
// internal href automatically gets the current /ua|/ru|/en prefix and path comparisons
// keep working on locale-free paths ("/settings", not "/ru/settings").

import NextLink from "next/link";
import { usePathname as useNextPathname, useRouter as useNextRouter } from "next/navigation";
import { forwardRef, useMemo, type ComponentProps } from "react";
import { localizeHref } from "../i18n/config";
import { useLocale } from "./i18n";

type NextLinkProps = ComponentProps<typeof NextLink>;

const Link = forwardRef<HTMLAnchorElement, NextLinkProps>(function Link({ href, ...rest }, ref) {
  const locale = useLocale();
  const localized = typeof href === "string" ? localizeHref(locale, href) : href;
  return <NextLink ref={ref} href={localized} {...rest} />;
});

export default Link;
export { Link };

export function useRouter() {
  const locale = useLocale();
  const router = useNextRouter();
  return useMemo(
    () => ({
      push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(localizeHref(locale, href), options),
      replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(localizeHref(locale, href), options),
      prefetch: (href: string) => router.prefetch(localizeHref(locale, href)),
      back: () => router.back(),
      forward: () => router.forward(),
      refresh: () => router.refresh()
    }),
    [locale, router]
  );
}

/** Pathname with the locale prefix stripped, so "/ru/settings" compares as "/settings". */
export function usePathname(): string {
  const pathname = useNextPathname() ?? "/";
  const locale = useLocale();
  if (pathname === `/${locale}`) return "/";
  return pathname.startsWith(`/${locale}/`) ? pathname.slice(locale.length + 1) : pathname;
}
