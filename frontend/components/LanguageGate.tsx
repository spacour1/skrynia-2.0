"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { type Language, useLanguageStore } from "../lib/i18n";

const options: { value: Language; title: string; text: string }[] = [
  { value: "en", title: "English", text: "Use SKRYNIA in English." },
  { value: "uk", title: "Українська", text: "Використовувати SKRYNIA українською." },
  { value: "ru", title: "Расийский", text: "Использовать SKRYNIA на русском." }
];

export function LanguageGate() {
  const setLanguageAndReload = useLanguageStore((state) => state.setLanguageAndReload);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(window.localStorage.getItem("languagePromptSeen") !== "1");
  }, []);

  function choose(language: Language) {
    window.localStorage.setItem("languagePromptSeen", "1");
    setLanguageAndReload(language);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-md">
      <section className="w-full max-w-[520px] overflow-hidden rounded-lg border border-line bg-card shadow-lift">
        <div className="border-b border-line bg-panel/60 p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-brand/10 text-brand">
            <Languages className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-3xl font-black text-ink">Language selection</h1>
          <p className="mt-3 text-sm leading-6 text-muted">This choice is saved for future visits. You can change it later in the header or sidebar.</p>
        </div>
        <div className="grid gap-3 p-4">
          {options.map((option) => (
            <button
              key={option.value}
              className="group flex items-center justify-between gap-4 rounded-lg border border-line bg-panel/40 p-5 text-left transition hover:-translate-y-0.5 hover:border-brand/70 hover:bg-brand/10"
              onClick={() => choose(option.value)}
            >
              <span>
                <span className="block text-xl font-black text-ink">{option.title}</span>
                <span className="mt-1 block text-sm leading-5 text-muted">{option.text}</span>
              </span>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-card text-sm font-black text-muted transition group-hover:border-brand/60 group-hover:text-brand">
                {option.value.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
