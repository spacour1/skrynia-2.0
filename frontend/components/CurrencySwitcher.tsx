"use client";

import { Coins } from "lucide-react";
import { DISPLAY_CURRENCIES, isCurrencyCode, resolveIntlLocale, useCurrency } from "@/lib/currency";
import { useLocale } from "@/lib/i18n";

export function CurrencySwitcher() {
  const { displayCurrency, rateDetails, setDisplayCurrency } = useCurrency();
  const locale = useLocale();
  const rateDate = rateDetails.find((item) => item.code === displayCurrency)?.asOf;

  function changeCurrency(value: string) {
    setDisplayCurrency(isCurrencyCode(value) ? value : "UAH");
  }

  return (
    <div className="grid gap-1">
      <label className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-bold text-ink shadow-soft transition hover:border-brand/60 hover:bg-panel" title="Display currency">
        <Coins className="h-4 w-4 text-brand" />
        <select className="bg-transparent text-sm font-black outline-none" value={displayCurrency} onChange={(event) => changeCurrency(event.target.value)} aria-label="Display currency">
          {DISPLAY_CURRENCIES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code}
            </option>
          ))}
        </select>
      </label>
      {rateDate ? <p className="px-1 text-[11px] font-semibold text-muted">Rate date: {new Date(rateDate).toLocaleDateString(resolveIntlLocale(locale))}</p> : null}
    </div>
  );
}
