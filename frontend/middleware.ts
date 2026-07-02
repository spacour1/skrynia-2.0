import { NextResponse, type NextRequest } from "next/server";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  localeFromPathname,
  locales,
  matchBrowserLocale,
  type Locale
} from "./i18n/config";

// Everything the locale router must never touch: the API proxy, Next internals,
// metadata routes, and static assets (anything with a file extension).
const IGNORED_PREFIXES = ["/api", "/_next", "/monitoring", "/uploads"];
const IGNORED_EXACT = new Set(["/favicon.ico", "/robots.txt", "/sitemap.xml"]);

function detectLocale(request: NextRequest): Locale {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  const header = request.headers.get("accept-language");
  if (header) {
    for (const part of header.split(",")) {
      const matched = matchBrowserLocale(part.trim());
      if (matched) return matched;
    }
  }
  return defaultLocale;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    IGNORED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    IGNORED_EXACT.has(pathname) ||
    /\.[^/]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const urlLocale = localeFromPathname(pathname);

  if (urlLocale) {
    // Valid locale in the URL — keep the cookie in sync so the next prefix-less
    // visit (or the backend via x-locale/cookie) lands on the same language.
    const response = NextResponse.next();
    if (request.cookies.get(LOCALE_COOKIE)?.value !== urlLocale) {
      response.cookies.set(LOCALE_COOKIE, urlLocale, { path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax" });
    }
    return response;
  }

  // A two-letter first segment that is not one of ours (/de/...) → default locale,
  // keeping the rest of the path: /de/settings -> /ua/settings.
  const first = pathname.split("/")[1] ?? "";
  const looksLikeLocale = /^[a-z]{2}$/i.test(first) && !(locales as readonly string[]).includes(first.toLowerCase());
  const rest = looksLikeLocale ? pathname.slice(first.length + 1) || "/" : pathname;

  const locale = looksLikeLocale ? defaultLocale : detectLocale(request);
  const url = request.nextUrl.clone();
  url.pathname = rest === "/" ? `/${locale}` : `/${locale}${rest}`;
  url.search = search;

  const response = NextResponse.redirect(url);
  response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax" });
  return response;
}

export const config = {
  // Skip static files and Next internals at the matcher level too (cheaper than running JS).
  matcher: ["/((?!_next|api|monitoring|uploads|.*\\..*).*)"]
};
