"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { GameIcon } from "@/components/GameIcon";
import { money, type Game } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { firstProductMedia } from "@/lib/product-media";
import type { SuggestProduct } from "./types";

export function SearchSuggest({
  loading,
  games,
  products,
  query,
  onGame,
  onProduct,
  onSearch
}: {
  loading: boolean;
  games: Game[];
  products: SuggestProduct[];
  query: string;
  onGame: (game: Game) => void;
  onProduct: (product: SuggestProduct) => void;
  onSearch: (query: string) => void;
}) {
  const { t } = useI18n();
  const hasResults = games.length || products.length;

  return (
    <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-50 overflow-hidden rounded-2xl border border-line bg-card shadow-lift">
      <div className="border-b border-line bg-panel/50 px-4 py-3">
        <p className="text-xs font-bold uppercase text-muted">{t("nav.quickSearch")}</p>
        <button className="mt-1 text-left text-sm font-bold text-ink hover:text-brand" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onSearch(query)}>
          {t("nav.searchFor")} "{query}"
        </button>
      </div>

      <div className="max-h-[520px] overflow-y-auto p-2">
        {loading ? <p className="px-3 py-4 text-sm text-muted">{t("nav.searching")}</p> : null}
        {!loading && !hasResults ? <p className="px-3 py-4 text-sm text-muted">{t("nav.noMatches")}</p> : null}

        {games.length ? (
          <SuggestSection title={t("nav.gamesAndServices")}>
            {games.map((game) => (
              <button key={game.id} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-panel" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onGame(game)}>
                <GameIcon name={game.name} slug={game.slug} className="h-10 w-10 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-ink">{game.name}</span>
                  <span className="block truncate text-xs text-muted">{game.publisher ?? t("nav.game")} · {game.lotCount ?? 0} {t("nav.lots")}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted" />
              </button>
            ))}
          </SuggestSection>
        ) : null}

        {products.length ? (
          <SuggestSection title={t("nav.listings")}>
            {products.map((product) => {
              const image = firstProductMedia(product);
              return (
                <button key={product.id} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-panel" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onProduct(product)}>
                  {image ? (
                    <img className="h-11 w-11 shrink-0 rounded-xl object-cover" src={image} alt="" />
                  ) : (
                    <GameIcon name={product.gameName ?? product.categoryName ?? "Product"} slug={product.gameSlug} className="h-11 w-11 rounded-xl" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-ink">{product.title}</span>
                    <span className="block truncate text-xs text-muted">{[product.gameName, product.categoryName, product.productType].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-black text-brand">{money(product.priceCents, product.currency)}</span>
                    {product.isHot ? <span className="text-xs font-bold text-action">{t("nav.hot")}</span> : null}
                  </span>
                </button>
              );
            })}
          </SuggestSection>
        ) : null}
      </div>
    </div>
  );
}

function SuggestSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="p-2">
      <p className="mb-2 px-1 text-xs font-black uppercase text-brand">{title}</p>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}
