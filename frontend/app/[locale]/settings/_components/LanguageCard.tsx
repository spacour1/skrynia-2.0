"use client";

import { Languages } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { localeLabels, locales } from "@/i18n/config";
import { SectionHeader } from "./settings-ui";
import type { SettingsT } from "./types";

export function LanguageCard({ locale, switchLocale, t }: { locale: Locale; switchLocale: (next: Locale) => void; t: SettingsT }) {
  return (
    <section className="app-card overflow-hidden">
      <SectionHeader icon={Languages} title={t("settings.language.title")} text={t("settings.language.text")} />
      <div className="grid gap-3 p-5">
        {locales.map((option) => (
          <button
            key={option}
            className={`flex items-center justify-between rounded-lg border p-4 text-left transition hover:border-brand/70 ${
              option === locale ? "border-brand/70 bg-brand/10" : "border-line bg-panel/35"
            }`}
            type="button"
            onClick={() => switchLocale(option)}
          >
            <span className="font-black text-ink">{localeLabels[option]}</span>
            <span className={`text-xs font-black ${option === locale ? "text-brand" : "text-muted"}`}>{option.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
