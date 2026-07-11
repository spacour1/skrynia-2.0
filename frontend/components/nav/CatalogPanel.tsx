"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Flame, Gamepad2, Globe, LayoutGrid, Search, Smartphone, type LucideIcon } from "lucide-react";
import { GameIcon } from "@/components/GameIcon";
import type { Game } from "@/lib/api";
import { buildCatalogGroups, type CatalogGroupKey } from "@/lib/game-catalog";
import { useI18n } from "@/lib/i18n";

const GROUP_ICON: Record<CatalogGroupKey, LucideIcon> = {
  popular: Flame,
  platform: Gamepad2,
  mobile: Smartphone,
  services: Globe,
  all: LayoutGrid
};

/**
 * GGSel-style catalog dropdown, in the Keep Game dark theme. Left column lists the
 * top-level groups (popular games, platforms, mobile, services, all); the right side
 * shows the active group's real games as a grid of tiles. A search box filters across
 * every game. Every tile opens the real /games/:slug browse page via onNavigate.
 */
export function CatalogPanel({
  games,
  loading,
  onNavigate
}: {
  games: Game[];
  loading: boolean;
  onNavigate: (href: string) => void;
}) {
  const { t, language } = useI18n();
  const groups = useMemo(() => buildCatalogGroups(games), [games]);
  const [activeKey, setActiveKey] = useState<CatalogGroupKey>("popular");
  const [query, setQuery] = useState("");

  const term = query.trim().toLowerCase();
  const activeGroup = groups.find((group) => group.key === activeKey) ?? groups[0];

  // A non-empty search ignores the active group and looks across the whole catalog, so the
  // box works as a real catalog-wide filter rather than a per-tab one.
  const visibleGames = useMemo(() => {
    if (term) {
      return games.filter((game) => `${game.name} ${game.slug} ${game.publisher ?? ""}`.toLowerCase().includes(term));
    }
    return activeGroup?.games ?? [];
  }, [term, games, activeGroup]);

  return (
    <div className="mx-auto grid max-w-[1720px] gap-0 px-4 py-4 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8">
      {/* Groups: a vertical rail on desktop, a horizontal chip row on mobile. */}
      <nav className="mb-3 flex gap-2 overflow-x-auto pb-2 lg:mb-0 lg:flex-col lg:overflow-visible lg:border-r lg:border-line/70 lg:pb-0 lg:pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((group) => {
          const Icon = GROUP_ICON[group.key];
          const active = !term && group.key === activeGroup?.key;
          return (
            <button
              key={group.key}
              type="button"
              className={`flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-black transition lg:w-full ${
                active ? "bg-brand text-stone-950 shadow-[0_10px_26px_rgba(183,255,26,0.24)]" : "text-muted hover:bg-panel hover:text-ink"
              }`}
              onMouseEnter={() => setActiveKey(group.key)}
              onClick={() => {
                setActiveKey(group.key);
                setQuery("");
              }}
            >
              <span className="inline-flex items-center gap-2.5">
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {t(`catalogPanel.${group.key}`)}
              </span>
              <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold lg:inline ${active ? "bg-black/15 text-stone-900" : "bg-panel text-muted"}`}>
                {group.games.length}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 lg:pl-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-base font-black text-ink">
            {term ? t("catalogPanel.searchResults") : t(`catalogPanel.${activeGroup?.key ?? "all"}`)}
            <span className="rounded-full bg-panel px-2 py-0.5 text-xs font-bold text-muted">{visibleGames.length}</span>
          </h2>
          <div className="relative w-[190px] max-w-[46%] sm:w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="h-10 w-full rounded-xl border border-line bg-panel/50 pl-9 pr-3 text-sm outline-none transition focus:border-brand/60 placeholder:text-muted"
              placeholder={t("catalogPanel.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {Array.from({ length: 16 }).map((_, index) => (
              <div key={index} className="h-[104px] animate-pulse rounded-xl border border-line bg-card" />
            ))}
          </div>
        ) : visibleGames.length ? (
          <div className="max-h-[min(66vh,560px)] overflow-y-auto pr-1 [scrollbar-width:thin]">
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {visibleGames.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className="group flex flex-col items-center gap-2 rounded-xl border border-line bg-card p-2.5 text-center shadow-soft transition hover:-translate-y-0.5 hover:border-brand/60"
                  onClick={() => onNavigate(`/games/${game.slug}`)}
                  title={game.name}
                >
                  <GameIcon name={game.name} slug={game.slug} className="h-12 w-12" />
                  <span className="line-clamp-2 min-h-[28px] text-[11px] font-bold leading-[14px] text-ink transition group-hover:text-brand">
                    {game.name}
                  </span>
                  {typeof game.lotCount === "number" && game.lotCount > 0 ? (
                    <span className="text-[10px] font-semibold text-muted">
                      {game.lotCount.toLocaleString(language)} {t("home.itemsLabel")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid min-h-[180px] place-items-center rounded-xl border border-line bg-card text-center">
            <p className="text-sm text-muted">{t("catalogPanel.empty")}</p>
          </div>
        )}

        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1 text-xs font-black text-muted transition hover:text-brand"
          onClick={() => onNavigate("/#game-catalog")}
        >
          {t("catalogPanel.viewAll")}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
