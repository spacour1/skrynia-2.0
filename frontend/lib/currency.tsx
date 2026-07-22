"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { type Locale } from "../i18n/config";
import { apiFetch } from "./api";
import { useLocale } from "./i18n";
import { usePathname } from "./navigation";
import { moneyCentsToBigInt, type MoneyCents } from "./money";

export {
  absMoneyCents,
  addMoneyCents,
  calculateDiscountPercent,
  isPositiveMoneyCents,
  isZeroMoneyCents,
  majorUnitsToMoneyCents,
  moneyCentsToBigInt,
  moneyCentsToMajorUnits,
  multiplyMoneyCentsByRatio,
  subtractMoneyCents,
  sumMoneyCents,
  sumMoneyCentsByCurrency
} from "./money";
export type { MoneyCents, MoneyFormatter, WireMoneyCents } from "./money";

export type CurrencyCode = "UAH" | "USD" | "EUR";
export type CurrencyRate = { code: CurrencyCode; rateToUah: number | string; source: string; asOf: string; updatedAt: string };
export type CurrencyRatesResponse = { baseCurrency: CurrencyCode; rates: CurrencyRate[] };
/** An exact decimal rate: value / 10 ** scale UAH for one unit of currency. */
export type ScaledRate = { value: bigint; scale: number };
export type CurrencyRates = Record<CurrencyCode, ScaledRate>;

export const DISPLAY_CURRENCIES: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: "UAH", label: "Hryvnia", symbol: "₴" },
  { code: "USD", label: "Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" }
];

const DISPLAY_CURRENCY_STORAGE_KEY = "displayCurrency";
const MAX_RATE_TEXT_LENGTH = 96;
const MAX_RATE_DIGITS = 36;
const MAX_RATE_SCALE = 18;
const MAX_RATE_EXPONENT = 36;
const DEFAULT_RATES: CurrencyRates = { UAH: { value: 1n, scale: 0 }, USD: { value: 0n, scale: 0 }, EUR: { value: 0n, scale: 0 } };
const CURRENCY_SYMBOLS = Object.fromEntries(DISPLAY_CURRENCIES.map(({ code, symbol }) => [code, symbol])) as Record<CurrencyCode, string>;
const ACCOUNTING_PATHS = ["/admin", "/dashboard", "/orders", "/wallet", "/seller/earnings", "/seller/sales"];

type CurrencyContextValue = {
  displayCurrency: CurrencyCode;
  rates: CurrencyRates;
  rateDetails: CurrencyRate[];
  setDisplayCurrency: (currency: CurrencyCode) => void;
  setRates: (rates: CurrencyRate[]) => void;
};
const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  // Keep the SSR and first client render deterministic; restore the user's preference after hydration.
  const [displayCurrency, setDisplayCurrencyState] = useState<CurrencyCode>("UAH");
  const [rates, setRatesState] = useState<CurrencyRates>(DEFAULT_RATES);
  const [rateDetails, setRateDetails] = useState<CurrencyRate[]>([]);
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => apiFetch<CurrencyRatesResponse>("/currencies"), staleTime: 60 * 60 * 1000, retry: false });

  const setDisplayCurrency = useCallback((currency: CurrencyCode) => {
    setDisplayCurrencyState(currency);
    if (typeof window !== "undefined") window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, currency);
  }, []);
  const setRates = useCallback((nextRates: CurrencyRate[]) => {
    setRatesState(parseCurrencyRates(nextRates));
    setRateDetails(nextRates);
  }, []);

  useEffect(() => { setDisplayCurrencyState(readStoredDisplayCurrency() ?? "UAH"); }, []);
  useEffect(() => { if (currencies.data) setRates(currencies.data.rates); }, [currencies.data, setRates]);
  useEffect(() => {
    const syncStorage = (event: StorageEvent) => {
      if (event.key === DISPLAY_CURRENCY_STORAGE_KEY) setDisplayCurrencyState(isCurrencyCode(event.newValue) ? event.newValue : "UAH");
    };
    window.addEventListener("storage", syncStorage);
    return () => window.removeEventListener("storage", syncStorage);
  }, []);

  const value = useMemo(() => ({ displayCurrency, rates, rateDetails, setDisplayCurrency, setRates }), [displayCurrency, rateDetails, rates, setDisplayCurrency, setRates]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const value = useContext(CurrencyContext);
  if (!value) throw new Error("useCurrency must be used within CurrencyProvider");
  return value;
}

/** Formats a source-cent amount without changing that input or relying on mutable module state. */
export function formatMoney({ cents, sourceCurrency, displayCurrency, rates, locale }: { cents: MoneyCents; sourceCurrency: CurrencyCode | string; displayCurrency: CurrencyCode; rates: CurrencyRates; locale: Locale | string }) {
  const source = isCurrencyCode(sourceCurrency) ? sourceCurrency : "UAH";
  const effectiveDisplay = canConvert(source, displayCurrency, rates) ? displayCurrency : source;
  const converted = source === effectiveDisplay ? moneyCentsToBigInt(cents) : convertCents(cents, source, effectiveDisplay, rates);
  const sign = converted < 0n ? "-" : "";
  const absolute = converted < 0n ? -converted : converted;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  const intlLocale = resolveIntlLocale(locale);
  const integer = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 }).format(whole);
  const decimal = new Intl.NumberFormat(intlLocale).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
  return `${sign}${integer}${decimal}${fraction} ${CURRENCY_SYMBOLS[effectiveDisplay]}`;
}

/** Reactive formatter; accounting paths deliberately retain their source currency. */
export function useMoney() {
  const { displayCurrency, rates } = useCurrency();
  const locale = useLocale();
  const pathname = usePathname();
  const preserveForPath = ACCOUNTING_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  return useCallback((cents: MoneyCents = 0, sourceCurrency: CurrencyCode | string = "UAH", options: { preserveCurrency?: boolean } = {}) => {
    const source = isCurrencyCode(sourceCurrency) ? sourceCurrency : "UAH";
    const target = options.preserveCurrency ?? preserveForPath ? source : displayCurrency;
    return formatMoney({ cents, sourceCurrency: source, displayCurrency: target, rates, locale });
  }, [displayCurrency, locale, preserveForPath, rates]);
}

export function isCurrencyCode(value: unknown): value is CurrencyCode { return value === "UAH" || value === "USD" || value === "EUR"; }
export function resolveIntlLocale(locale: Locale | string) {
  if (locale === "ua") return "uk-UA";
  if (locale === "ru") return "ru-RU";
  if (locale === "en") return "en-US";
  return locale || "uk-UA";
}

function readStoredDisplayCurrency(): CurrencyCode | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
  return isCurrencyCode(stored) ? stored : null;
}
export function parseCurrencyRates(rateDetails: readonly CurrencyRate[]): CurrencyRates {
  const next = { ...DEFAULT_RATES };
  for (const rate of rateDetails) {
    if (!rate || !isCurrencyCode(rate.code)) continue;
    const parsed = parseScaledRate(rate.rateToUah);
    if (parsed.value > 0n) next[rate.code] = parsed;
  }
  return next;
}
function parseScaledRate(input: number | string): ScaledRate {
  if (typeof input === "number" && !Number.isFinite(input)) return { value: 0n, scale: 0 };
  const text = String(input).trim();
  if (!text || text.length > MAX_RATE_TEXT_LENGTH) return { value: 0n, scale: 0 };
  const match = /^([+]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return { value: 0n, scale: 0 };
  const [, , integer, decimal = "", exponent = "0"] = match;
  if (integer.length + decimal.length > MAX_RATE_DIGITS || exponent.length > 3) return { value: 0n, scale: 0 };
  const digits = `${integer}${decimal}`.replace(/^0+(?=\d)/, "") || "0";
  const exponentNumber = Number(exponent);
  if (!Number.isSafeInteger(exponentNumber) || Math.abs(exponentNumber) > MAX_RATE_EXPONENT) return { value: 0n, scale: 0 };
  const scale = Math.max(0, decimal.length - exponentNumber);
  const shift = Math.max(0, exponentNumber - decimal.length);
  if (scale > MAX_RATE_SCALE || digits.length + shift > MAX_RATE_DIGITS) return { value: 0n, scale: 0 };
  const value = BigInt(`${digits}${"0".repeat(shift)}`);
  return value > 0n ? { value, scale } : { value: 0n, scale: 0 };
}
function convertCents(cents: MoneyCents, source: CurrencyCode, target: CurrencyCode, rates: CurrencyRates) {
  const sourceRate = rates[source];
  const targetRate = rates[target];
  if (!sourceRate || !targetRate || sourceRate.value <= 0n || targetRate.value <= 0n) return moneyCentsToBigInt(cents);
  return roundDiv(moneyCentsToBigInt(cents) * sourceRate.value * 10n ** BigInt(targetRate.scale), targetRate.value * 10n ** BigInt(sourceRate.scale));
}
function canConvert(source: CurrencyCode, target: CurrencyCode, rates: CurrencyRates) {
  return source === target || Boolean(rates[source]?.value > 0n && rates[target]?.value > 0n);
}
function roundDiv(numerator: bigint, denominator: bigint) {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;
  const rounded = (top + bottom / 2n) / bottom;
  return negative ? -rounded : rounded;
}
