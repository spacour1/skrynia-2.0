"use client";

import { Globe } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { isLocale, localeLabels, locales } from "@/i18n/config";
import { SectionHeader } from "./settings-ui";
import type { SettingsT } from "./types";

export function LanguageCard({ locale, switchLocale, t }: { locale: Locale; switchLocale: (next: Locale) => void; t: SettingsT }) {
  return (
    <section className="app-card overflow-hidden">
      <SectionHeader icon={Globe} title={t("settings.language.title")} text={t("settings.language.text")} />
      <div className="p-5">
        <select
          className="app-input h-11 w-full font-bold"
          aria-label={t("settings.language.title")}
          value={locale}
          onChange={(event) => {
            const next = event.target.value;
            if (isLocale(next)) switchLocale(next);
          }}
        >
          {locales.map((option) => (
            <option key={option} value={option}>
              {localeLabels[option]}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
