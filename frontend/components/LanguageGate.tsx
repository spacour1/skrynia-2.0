"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { localeLabels, locales, type Locale } from "@/i18n/config";
import { readLocaleCookie, useI18n } from "@/lib/i18n";

// Each description is intentionally in its own language — the reader hasn't picked one yet.
const descriptions: Record<Locale, string> = {
  ua: "Використовувати SKRYNIA українською.", // i18n-exempt
  ru: "Использовать SKRYNIA на русском.", // i18n-exempt
  en: "Use SKRYNIA in English."
};

/**
 * First-visit language prompt. Once a choice is made the locale cookie is set and the
 * URL prefix switches, so the middleware keeps every future visit on the chosen language.
 */
export function LanguageGate() {
  const { locale, switchLocale, t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(window.localStorage.getItem("languagePromptSeen") !== "1" && readLocaleCookie() === null);
  }, []);

  function choose(next: Locale) {
    window.localStorage.setItem("languagePromptSeen", "1");
    setOpen(false);
    if (next !== locale) switchLocale(next);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-md">
      <section className="w-full max-w-[520px] overflow-hidden rounded-lg border border-line bg-card shadow-lift">
        <div className="border-b border-line bg-panel/60 p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-brand/10 text-brand">
            <Languages className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-3xl font-black text-ink">{t("nav.language")}</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{t("settings.language.text")}</p>
        </div>
        <div className="grid gap-3 p-4">
          {locales.map((option) => (
            <button
              key={option}
              className="group flex items-center justify-between gap-4 rounded-lg border border-line bg-panel/40 p-5 text-left transition hover:-translate-y-0.5 hover:border-brand/70 hover:bg-brand/10"
              onClick={() => choose(option)}
            >
              <span>
                <span className="block text-xl font-black text-ink">{localeLabels[option]}</span>
                <span className="mt-1 block text-sm leading-5 text-muted">{descriptions[option]}</span>
              </span>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-card text-sm font-black text-muted transition group-hover:border-brand/60 group-hover:text-brand">
                {option.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
