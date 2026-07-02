"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import {
  apiFetch,
  DISPLAY_CURRENCIES,
  getDisplayCurrency,
  setCurrencyRates,
  setDisplayCurrency,
  type CurrencyCode,
  type CurrencyRatesResponse
} from "@/lib/api";

export function CurrencySwitcher() {
  const [currency, setCurrency] = useState<CurrencyCode>("UAH");
  const rates = useQuery({
    queryKey: ["currencies"],
    queryFn: async () => {
      const payload = await apiFetch<CurrencyRatesResponse>("/currencies");
      setCurrencyRates(payload.rates);
      return payload;
    },
    staleTime: 60 * 60 * 1000
  });
  const rateDate = rates.data?.rates.find((item) => item.code === currency)?.asOf;

  useEffect(() => {
    setCurrency(getDisplayCurrency() ?? "UAH");
  }, []);

  function changeCurrency(value: string) {
    const next = DISPLAY_CURRENCIES.find((item) => item.code === value)?.code ?? "UAH";
    setCurrency(next);
    setDisplayCurrency(next);
  }

  return (
    <div className="grid gap-1">
      <label className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-bold text-ink shadow-soft transition hover:border-brand/60 hover:bg-panel" title="Display currency">
        <Coins className="h-4 w-4 text-brand" />
        <select className="bg-transparent text-sm font-black outline-none" value={currency} onChange={(event) => changeCurrency(event.target.value)} aria-label="Display currency">
          {DISPLAY_CURRENCIES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code}
            </option>
          ))}
        </select>
      </label>
      {rateDate ? <p className="px-1 text-[11px] font-semibold text-muted">Rate date: {new Date(rateDate).toLocaleDateString("ru-RU")}</p> : null}
    </div>
  );
}
