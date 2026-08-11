import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { LOCALE_COOKIE } from "@/i18n/config";
import { middleware } from "@/middleware";

function request(path: string, headers: HeadersInit = {}) {
  return new NextRequest(`https://app.example.test${path}`, { headers });
}

describe("locale middleware", () => {
  it("redirects prefixless paths using the locale cookie and preserves the query", () => {
    const response = middleware(
      request("/settings?tab=security", {
        cookie: `${LOCALE_COOKIE}=en`,
        "accept-language": "ru-RU,ru;q=0.9"
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/en/settings?tab=security"
    );
    expect(response.cookies.get(LOCALE_COOKIE)?.value).toBe("en");
  });

  it("uses Accept-Language and safely replaces an unsupported locale prefix", () => {
    const browserLocale = middleware(
      request("/?source=home", { "accept-language": "ru-RU,ru;q=0.9" })
    );
    expect(browserLocale.headers.get("location")).toBe(
      "https://app.example.test/ru?source=home"
    );

    const unsupportedLocale = middleware(request("/de/orders/123?view=full"));
    expect(unsupportedLocale.headers.get("location")).toBe(
      "https://app.example.test/ua/orders/123?view=full"
    );
  });

  it("keeps a valid locale route and synchronizes the locale cookie", () => {
    const response = middleware(request("/ru/marketplace"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get(LOCALE_COOKIE)?.value).toBe("ru");
  });

  it.each([
    "/api/auth/me",
    "/_next/static/chunk.js",
    "/monitoring",
    "/uploads/avatar.webp",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
    "/assets/logo.svg"
  ])("does not redirect excluded runtime path %s", (path) => {
    const response = middleware(request(path));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
