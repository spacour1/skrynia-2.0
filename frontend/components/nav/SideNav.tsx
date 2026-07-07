"use client";

import { useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { Game } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SECTION_PATTERNS } from "@/lib/game-catalog";

export function SideNavButton({
  icon: Icon,
  label,
  active,
  expanded,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-12 items-center rounded-xl text-sm font-bold transition ${
        active ? "bg-brand/15 text-brand shadow-[inset_0_0_0_1px_rgb(var(--color-brand)/0.18)]" : "text-muted hover:bg-panel hover:text-ink"
      } ${expanded ? "w-full justify-start gap-3 px-3 text-left" : "mx-auto w-12 justify-center"}`}
      onClick={onClick}
      title={label}
    >
      <Icon className="h-6 w-6 shrink-0" />
      <span className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${expanded ? "max-w-[170px] opacity-100" : "max-w-0 opacity-0"}`}>{label}</span>
    </button>
  );
}

export function CatalogMegaMenu({ games, onGame }: { games: Game[]; onGame: (slug: string) => void }) {
  const { t } = useI18n();
  const groups = [
    { title: t("catalogMenu.games"), text: t("catalogMenu.gamesText"), items: games.slice(0, 10), live: true },
    { title: t("catalogMenu.mobile"), text: t("catalogMenu.mobileText"), items: games.filter((game) => SECTION_PATTERNS.mobile.test(`${game.slug} ${game.name} ${game.publisher ?? ""}`)).slice(0, 6), live: true },
    { title: t("catalogMenu.services"), text: t("catalogMenu.servicesText"), items: [] as Game[], live: false },
    { title: t("catalogMenu.software"), text: t("catalogMenu.softwareText"), items: [] as Game[], live: false }
  ];
  const [active, setActive] = useState(groups[0].title);
  const activeGroup = groups.find((group) => group.title === active) ?? groups[0];

  return (
    <div className="absolute left-full top-0 z-[120] hidden pl-3 xl:block">
      <div className="grid w-[620px] overflow-hidden rounded-xl border border-brand/35 bg-card/95 shadow-[0_24px_90px_rgba(15,23,42,0.22)] ring-1 ring-black/5 backdrop-blur-xl dark:border-brand/25 dark:bg-slate-950/95 dark:shadow-[0_24px_90px_rgba(0,0,0,0.58)] dark:ring-white/10 xl:grid-cols-[210px_minmax(0,1fr)]">
        <div className="border-r border-line bg-panel/70 p-3 dark:bg-white/[0.03]">
          {groups.map((group) => (
            <button
              key={group.title}
              className={`mb-2 flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm font-black transition ${
                active === group.title ? "border border-brand/35 bg-brand/15 text-brand shadow-soft" : "border border-transparent text-muted hover:border-line hover:bg-card hover:text-ink"
              }`}
              onMouseEnter={() => setActive(group.title)}
              onClick={() => setActive(group.title)}
            >
              <span>{group.title}</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          ))}
        </div>
        <section className="bg-card p-5">
          <p className="text-lg font-black text-ink">{activeGroup.title}</p>
          <p className="mt-1 text-sm text-muted">{activeGroup.text}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {activeGroup.items.length ? (
              activeGroup.items.map((game) => (
                <button
                  key={game.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel/55 px-3 py-3 text-left text-sm font-bold text-muted shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:border-brand/60 hover:bg-brand/10 hover:text-brand"
                  onClick={() => onGame(game.slug)}
                >
                  <span className="truncate">{game.name}</span>
                  <span>{game.lotCount ?? 0}</span>
                </button>
              ))
            ) : (
              <button className="rounded-lg border border-line bg-panel px-3 py-3 text-left text-sm font-bold text-muted" onClick={() => document.getElementById("game-catalog")?.scrollIntoView({ behavior: "smooth" })}>
                {t("nav.comingSoon")}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
