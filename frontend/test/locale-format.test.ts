import { describe, expect, it } from "vitest";
import { formatMoney, type CurrencyRates } from "@/lib/currency";
import { formatDate, formatNumber, resolveIntlLocale } from "@/lib/locale-format";
import { findLocaleFormattingViolations } from "@/scripts/i18n-source-guard";

const sourceCurrencyRates: CurrencyRates = {
  UAH: { value: 1n, scale: 0 },
  USD: { value: 40n, scale: 0 },
  EUR: { value: 45n, scale: 0 }
};

describe("active locale formatting", () => {
  it.each([
    { locale: "ua", intl: "uk-UA", count: "1\u00a0234\u00a0567", money: "1\u00a0234,56 \u20b4", date: "2 січ. 2026 р." },
    { locale: "ru", intl: "ru-RU", count: "1\u00a0234\u00a0567", money: "1\u00a0234,56 \u20b4", date: "2 янв. 2026 г." },
    { locale: "en", intl: "en-US", count: "1,234,567", money: "1,234.56 \u20b4", date: "Jan 2, 2026" }
  ])("formats counts, exact cents and UTC dates for $locale", ({ locale, intl, count, money, date }) => {
    expect(resolveIntlLocale(locale)).toBe(intl);
    expect(formatNumber(1_234_567, locale)).toBe(count);
    expect(formatMoney({
      cents: "123456",
      sourceCurrency: "UAH",
      displayCurrency: "UAH",
      rates: sourceCurrencyRates,
      locale
    })).toBe(money);
    expect(formatDate("2026-01-02T15:04:00.000Z", locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    })).toBe(date);
  });

  it("uses the configured app default for an unknown locale instead of the browser locale", () => {
    expect(resolveIntlLocale("unknown")).toBe("uk-UA");
  });
});

describe("locale source guard fixtures", () => {
  it("rejects regional literals and formatters that fall back to the browser locale", () => {
    const fixture = `
      price.toLocaleString();
      createdAt.toLocaleDateString();
      new Intl.NumberFormat();
      Intl.DateTimeFormat(undefined, { dateStyle: "short" });
      const forcedLocale = "ru-RU";
    `;

    expect(findLocaleFormattingViolations(fixture).map(({ kind }) => kind)).toEqual([
      "locale-less-to-locale",
      "locale-less-to-locale",
      "locale-less-intl",
      "locale-less-intl",
      "hardcoded-regional-locale"
    ]);
  });

  it("allows feature code that passes its active locale", () => {
    const fixture = `
      formatNumber(count, locale);
      formatDate(createdAt, locale);
      value.toLocaleString(resolveIntlLocale(locale));
      new Intl.NumberFormat(resolveIntlLocale(locale));
    `;

    expect(findLocaleFormattingViolations(fixture)).toEqual([]);
  });
});
