"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";
import { ToastCenter } from "../components/ToastCenter";
import { LanguageGate } from "../components/LanguageGate";
import { GlobalTranslator } from "../components/GlobalTranslator";
import { useAuth } from "../lib/auth-store";
import { apiFetch, DISPLAY_CURRENCY_EVENT, setCurrencyRates, type CurrencyRatesResponse } from "../lib/api";
import { useLanguageStore } from "../lib/i18n";
import { useThemeStore } from "../lib/theme-store";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  const [currencyVersion, setCurrencyVersion] = useState(0);
  const hydrate = useAuth((s) => s.hydrate);
  const hydrateTheme = useThemeStore((s) => s.hydrate);
  const hydrateLanguage = useLanguageStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    hydrateTheme();
    hydrateLanguage();
  }, [hydrate, hydrateLanguage, hydrateTheme]);

  useEffect(() => {
    const rerenderPrices = () => setCurrencyVersion((current) => current + 1);
    window.addEventListener(DISPLAY_CURRENCY_EVENT, rerenderPrices);
    return () => window.removeEventListener(DISPLAY_CURRENCY_EVENT, rerenderPrices);
  }, []);

  return (
    <QueryClientProvider client={client}>
      <CurrencyRatesLoader />
      <div key={currencyVersion} className="contents">
        {children}
      </div>
      <LanguageGate />
      <GlobalTranslator />
      <ToastCenter />
    </QueryClientProvider>
  );
}

function CurrencyRatesLoader() {
  useEffect(() => {
    let cancelled = false;
    apiFetch<CurrencyRatesResponse>("/currencies")
      .then((payload) => {
        if (!cancelled) setCurrencyRates(payload.rates);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
