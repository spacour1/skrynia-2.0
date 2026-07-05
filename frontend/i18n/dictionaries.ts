// Builds one flat dictionary per locale out of the namespace JSON files, so both
// server components (metadata) and the client `useI18n()` hook read the same data.
// Keys are flattened to dot paths: { nav: { catalog: "..." } } -> "nav.catalog".

import { defaultLocale, type Locale } from "./config";

import uaCommon from "./locales/ua/common.json";
import uaHome from "./locales/ua/home.json";
import uaNav from "./locales/ua/nav.json";
import uaAuth from "./locales/ua/auth.json";
import uaMarketplace from "./locales/ua/marketplace.json";
import uaProduct from "./locales/ua/product.json";
import uaCreateLot from "./locales/ua/createLot.json";
import uaOrders from "./locales/ua/orders.json";
import uaChat from "./locales/ua/chat.json";
import uaWallet from "./locales/ua/wallet.json";
import uaSettings from "./locales/ua/settings.json";
import uaNotifications from "./locales/ua/notifications.json";
import uaAdmin from "./locales/ua/admin.json";
import uaErrors from "./locales/ua/errors.json";

import ruCommon from "./locales/ru/common.json";
import ruHome from "./locales/ru/home.json";
import ruNav from "./locales/ru/nav.json";
import ruAuth from "./locales/ru/auth.json";
import ruMarketplace from "./locales/ru/marketplace.json";
import ruProduct from "./locales/ru/product.json";
import ruCreateLot from "./locales/ru/createLot.json";
import ruOrders from "./locales/ru/orders.json";
import ruChat from "./locales/ru/chat.json";
import ruWallet from "./locales/ru/wallet.json";
import ruSettings from "./locales/ru/settings.json";
import ruNotifications from "./locales/ru/notifications.json";
import ruAdmin from "./locales/ru/admin.json";
import ruErrors from "./locales/ru/errors.json";

import enCommon from "./locales/en/common.json";
import enHome from "./locales/en/home.json";
import enNav from "./locales/en/nav.json";
import enAuth from "./locales/en/auth.json";
import enMarketplace from "./locales/en/marketplace.json";
import enProduct from "./locales/en/product.json";
import enCreateLot from "./locales/en/createLot.json";
import enOrders from "./locales/en/orders.json";
import enChat from "./locales/en/chat.json";
import enWallet from "./locales/en/wallet.json";
import enSettings from "./locales/en/settings.json";
import enNotifications from "./locales/en/notifications.json";
import enAdmin from "./locales/en/admin.json";
import enErrors from "./locales/en/errors.json";

type NestedDictionary = { [key: string]: string | NestedDictionary };
export type FlatDictionary = Record<string, string>;

function flatten(value: NestedDictionary, prefix: string, into: FlatDictionary): FlatDictionary {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "string") into[path] = item;
    else flatten(item, path, into);
  }
  return into;
}

function buildDictionary(namespaces: NestedDictionary[]): FlatDictionary {
  const flat: FlatDictionary = {};
  for (const namespace of namespaces) flatten(namespace, "", flat);
  return flat;
}

const dictionaries: Record<Locale, FlatDictionary> = {
  ua: buildDictionary([
    uaCommon, uaHome, uaNav, uaAuth, uaMarketplace, uaProduct, uaCreateLot, uaOrders,
    uaChat, uaWallet, uaSettings, uaNotifications, uaAdmin, uaErrors
  ] as NestedDictionary[]),
  ru: buildDictionary([
    ruCommon, ruHome, ruNav, ruAuth, ruMarketplace, ruProduct, ruCreateLot, ruOrders,
    ruChat, ruWallet, ruSettings, ruNotifications, ruAdmin, ruErrors
  ] as NestedDictionary[]),
  en: buildDictionary([
    enCommon, enHome, enNav, enAuth, enMarketplace, enProduct, enCreateLot, enOrders,
    enChat, enWallet, enSettings, enNotifications, enAdmin, enErrors
  ] as NestedDictionary[])
};

export function getDictionary(locale: Locale): FlatDictionary {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}

export type TranslateParams = Record<string, string | number>;

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name])
  );
}

const warnedMissingKeys = new Set<string>();

/**
 * Locale-aware lookup with fallback: current locale -> default locale (ua) -> the key
 * itself. Missing keys are logged once per session in development; `npm run i18n:check`
 * catches them at build time so users never see raw keys in practice.
 */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
  const exact = dictionaries[locale]?.[key];
  if (exact !== undefined) return interpolate(exact, params);

  if (process.env.NODE_ENV !== "production" && !warnedMissingKeys.has(`${locale}:${key}`)) {
    warnedMissingKeys.add(`${locale}:${key}`);
    console.warn(`[i18n] Missing translation for "${key}" in locale "${locale}"`);
  }

  const fallback = dictionaries[defaultLocale][key];
  if (fallback !== undefined) return interpolate(fallback, params);
  return key;
}

/** Server-side helper: `const t = getT(locale); t("meta.siteTitle")`. */
export function getT(locale: Locale) {
  return (key: string, params?: TranslateParams) => translate(locale, key, params);
}
