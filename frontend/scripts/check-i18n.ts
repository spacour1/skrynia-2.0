/**
 * i18n consistency check — run with `npm run i18n:check`.
 *
 * 1. Every locale (ua/ru/en) must expose exactly the same set of translation keys.
 * 2. {param} placeholders must match across locales for the same key.
 * 3. No hardcoded Cyrillic UI strings in .ts/.tsx sources (comments stripped).
 *    Files listed in HARDCODED_BASELINE are legacy pages still awaiting conversion —
 *    they are reported as warnings, not errors, so new violations still fail CI.
 *
 * Exit code 1 on any error, 0 otherwise.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..");
const LOCALES_DIR = join(ROOT, "i18n", "locales");
const LOCALES = ["ua", "ru", "en"] as const;
const DEFAULT_LOCALE = "ua";

// Legacy files with known hardcoded strings, pending conversion to translation keys.
// Do NOT add new files here — extract strings into i18n/locales/* instead.
const HARDCODED_BASELINE = new Set(
  [
    "app/[locale]/admin/disputes/[id]/page.tsx",
    "app/[locale]/admin/finance/page.tsx",
    "app/[locale]/admin/finance/_components/finance-format.ts",
    "app/[locale]/admin/finance/_components/finance-widgets.tsx",
    "app/[locale]/admin/ops/page.tsx",
    "app/[locale]/admin/payouts/page.tsx",
    "app/[locale]/admin/reports/page.tsx",
    "app/[locale]/admin/users/page.tsx",
    "app/[locale]/admin/page.tsx",
    "app/[locale]/dashboard/page.tsx",
    "app/[locale]/orders/[id]/page.tsx",
    "app/[locale]/rules/page.tsx",
    "app/[locale]/seller/create/page.tsx",
    "app/[locale]/seller/products/page.tsx",
    "app/[locale]/seller/products/_components/LotFormFields.tsx",
    "app/[locale]/seller/products/_components/MediaUploader.tsx",
    "app/[locale]/seller/products/_components/PreviewCard.tsx",
    "app/[locale]/seller/products/_components/SalesTips.tsx",
    "app/[locale]/seller/products/_components/SellerListings.tsx",
    "app/[locale]/seller/products/_components/constants.ts",
    "app/[locale]/seller/sales/page.tsx",
    "app/[locale]/support/page.tsx",
    "components/ManualPaymentPanel.tsx",
    "components/ReportModal.tsx",
    "components/ToastCenter.tsx",
    "lib/product-fields.ts"
  ].map((path) => path.split("/").join(sep))
);

type Flat = Record<string, string>;

function flatten(value: Record<string, unknown>, prefix: string, into: Flat): Flat {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "string") into[path] = item;
    else if (item && typeof item === "object") flatten(item as Record<string, unknown>, path, into);
  }
  return into;
}

function loadLocale(locale: string): Flat {
  const dir = join(LOCALES_DIR, locale);
  const flat: Flat = {};
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
    flatten(parsed, "", flat);
  }
  return flat;
}

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

let errors = 0;
let warnings = 0;

function error(message: string) {
  errors += 1;
  console.error(`  ERROR  ${message}`);
}

function warn(message: string) {
  warnings += 1;
  console.warn(`  WARN   ${message}`);
}

// --- 1 & 2: key parity + placeholder parity -------------------------------------------
console.log("Checking locale key parity (ua/ru/en)...");
const dictionaries = Object.fromEntries(LOCALES.map((locale) => [locale, loadLocale(locale)])) as Record<string, Flat>;
const referenceKeys = Object.keys(dictionaries[DEFAULT_LOCALE]).sort();

for (const locale of LOCALES) {
  if (locale === DEFAULT_LOCALE) continue;
  const keys = new Set(Object.keys(dictionaries[locale]));
  for (const key of referenceKeys) {
    if (!keys.has(key)) error(`[${locale}] missing key "${key}" (present in ${DEFAULT_LOCALE})`);
  }
  for (const key of keys) {
    if (!(key in dictionaries[DEFAULT_LOCALE])) error(`[${locale}] extra key "${key}" (absent in ${DEFAULT_LOCALE})`);
  }
}

for (const key of referenceKeys) {
  const reference = placeholders(dictionaries[DEFAULT_LOCALE][key]);
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE || dictionaries[locale][key] === undefined) continue;
    const current = placeholders(dictionaries[locale][key]);
    if (JSON.stringify(reference) !== JSON.stringify(current)) {
      error(`[${locale}] key "${key}" placeholders {${current.join(",")}} != {${reference.join(",")}} in ${DEFAULT_LOCALE}`);
    }
  }
}

// --- 3: hardcoded UI strings ------------------------------------------------------------
console.log("Scanning for hardcoded Cyrillic UI strings...");

const SCAN_DIRS = ["app", "components", "lib"];
const CYRILLIC = /[Ѐ-ӿ]/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      yield* walk(path);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield path;
    }
  }
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, scanDir))) {
    const relativePath = relative(ROOT, file);
    const source = stripComments(readFileSync(file, "utf8"));
    const rawLines = readFileSync(file, "utf8").split("\n");
    const offendingLines: number[] = [];
    source.split("\n").forEach((line, index) => {
      // "i18n-exempt" marks intentional native-language strings (e.g. the language
      // names in the switcher, which must stay in their own language).
      if (CYRILLIC.test(line) && !rawLines[index]?.includes("i18n-exempt")) offendingLines.push(index + 1);
    });
    if (!offendingLines.length) continue;
    const location = `${relativePath}:${offendingLines.slice(0, 5).join(",")}${offendingLines.length > 5 ? ",..." : ""}`;
    if (HARDCODED_BASELINE.has(relativePath)) {
      warn(`legacy hardcoded strings (${offendingLines.length} lines) in ${location} — pending conversion`);
    } else {
      error(`hardcoded UI string(s) in ${location} — move them to i18n/locales/*`);
    }
  }
}

console.log(`\ni18n:check finished: ${errors} error(s), ${warnings} warning(s).`);
if (errors > 0) process.exit(1);
