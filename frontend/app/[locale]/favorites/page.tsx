"use client";

import Link from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Heart, PackageOpen, Star, Store, Timer } from "lucide-react";
import { GameIcon } from "@/components/GameIcon";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch, money, type Product } from "@/lib/api";
import { firstProductMedia } from "@/lib/product-media";
import { showAppToast } from "@/lib/toast-events";
import { useI18n } from "@/lib/i18n";

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <FavoritesContent />
    </RequireAuth>
  );
}

function FavoritesContent() {
  const client = useQueryClient();
  const { t } = useI18n();
  const favorites = useQuery({
    queryKey: ["favorites"],
    queryFn: () => apiFetch<{ products: Product[] }>("/marketplace/favorites")
  });

  const removeFavorite = useMutation({
    mutationFn: (productId: string) => apiFetch(`/marketplace/favorites/${productId}`, { method: "DELETE" }),
    onMutate: async (productId) => {
      await client.cancelQueries({ queryKey: ["favorites"] });
      await client.cancelQueries({ queryKey: ["favorite-ids"] });
      const previousFavorites = client.getQueryData<{ products: Product[] }>(["favorites"]);
      const previousIds = client.getQueryData<{ productIds: string[] }>(["favorite-ids"]);
      client.setQueryData<{ products: Product[] }>(["favorites"], (current) => ({
        products: (current?.products ?? []).filter((product) => product.id !== productId)
      }));
      client.setQueryData<{ productIds: string[] }>(["favorite-ids"], (current) => ({
        productIds: (current?.productIds ?? []).filter((id) => id !== productId)
      }));
      return { previousFavorites, previousIds };
    },
    onError: (_error, _productId, context) => {
      if (context?.previousFavorites) client.setQueryData(["favorites"], context.previousFavorites);
      if (context?.previousIds) client.setQueryData(["favorite-ids"], context.previousIds);
    },
    onSuccess: (_data, productId) => {
      client.invalidateQueries({ queryKey: ["favorites"] });
      client.invalidateQueries({ queryKey: ["favorite-ids"] });
      client.invalidateQueries({ queryKey: ["products"] });
      client.invalidateQueries({ queryKey: ["game-products"] });
      showAppToast({
        type: "favorite",
        title: t("home.favoriteRemoved"),
        productId
      });
    }
  });

  const products = favorites.data?.products ?? [];

  return (
    <div className="mx-auto max-w-[1120px] space-y-5">
      <header className="flex items-center gap-4">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-brand/25 bg-brand/10 text-brand">
          <Heart className="h-5 w-5 fill-current" />
        </span>
        <h1 className="text-3xl font-black text-ink">{t("favorites.title")}</h1>
      </header>

      {favorites.isLoading ? <section className="app-card p-8 text-center text-muted">{t("favorites.loading")}</section> : null}

      {!favorites.isLoading && products.length ? (
        <section className="overflow-hidden rounded-lg border border-line bg-card">
          {products.map((product, index) => (
            <FavoriteOfferRow
              key={product.id}
              product={product}
              index={index}
              removing={removeFavorite.isPending}
              onRemove={() => removeFavorite.mutate(product.id)}
            />
          ))}
        </section>
      ) : null}

      {!favorites.isLoading && !products.length ? (
        <section className="app-card grid min-h-[300px] place-items-center p-8 text-center">
          <div>
            <PackageOpen className="mx-auto h-12 w-12 text-muted" />
            <h2 className="mt-4 text-xl font-black text-ink">{t("favorites.emptyTitle")}</h2>
            <p className="mt-2 text-sm text-muted">{t("favorites.emptyText")}</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FavoriteOfferRow({
  product,
  index,
  removing,
  onRemove
}: {
  product: Product;
  index: number;
  removing: boolean;
  onRemove: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const imageUrl = firstProductMedia(product);
  const discount =
    product.oldPriceCents && Number(product.oldPriceCents) > Number(product.priceCents)
      ? Math.round(((Number(product.oldPriceCents) - Number(product.priceCents)) / Number(product.oldPriceCents)) * 100)
      : 0;

  return (
    <article
      className="group grid cursor-pointer gap-4 border-b border-line bg-card px-4 py-4 transition last:border-b-0 hover:bg-panel/55 md:grid-cols-[72px_minmax(0,1fr)_190px_130px_48px] md:items-center"
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/products/${product.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(`/products/${product.id}`);
        }
      }}
    >
      <div className="h-16 w-16 overflow-hidden rounded-xl border border-line bg-panel">
        {imageUrl ? (
          <img className="h-full w-full object-cover" src={imageUrl} alt="" />
        ) : (
          <GameIcon name={product.gameName ?? product.categoryName ?? product.title} slug={product.gameSlug} className="h-full w-full rounded-xl" />
        )}
      </div>

      <div className="min-w-0">
        <h2 className="line-clamp-2 text-base font-black text-ink transition group-hover:text-brand">{product.title}</h2>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{product.description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          {product.gameName ? <span className="rounded-full bg-panel px-2 py-1 text-muted">{product.gameName}</span> : null}
          <span className="rounded-full bg-panel px-2 py-1 text-muted">{product.productType ?? product.sectionName ?? "service"}</span>
          {product.deliveryType === "instant" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-500">
              <Timer className="h-3 w-3" />
              {t("product.instant")}
            </span>
          ) : null}
          {discount ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-1 text-rose-400">
              <BadgePercent className="h-3 w-3" />
              -{discount}%
            </span>
          ) : null}
        </div>
      </div>

      <Link
        href={`/sellers/${product.sellerId}`}
        className="relative z-20 flex min-w-0 items-center gap-3 rounded-lg p-1 transition hover:bg-card"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-panel text-sm font-black text-brand">
          {product.sellerDisplayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1 truncate text-sm font-black text-ink">
            <Store className="h-3.5 w-3.5 shrink-0 text-brand" />
            {product.sellerDisplayName}
          </span>
          <span className="mt-1 flex items-center gap-1 text-xs font-bold text-muted">
            <Star className="h-3.5 w-3.5 fill-action text-action" />
            {Number(product.sellerRating ?? 0).toFixed(1)} ({product.sellerReviewCount ?? 0})
          </span>
        </span>
      </Link>

      <div className="text-left md:text-right">
        {product.oldPriceCents ? <p className="text-xs font-bold text-muted line-through">{money(Number(product.oldPriceCents), product.currency)}</p> : null}
        <p className="text-xl font-black text-ink">{money(Number(product.priceCents), product.currency)}</p>
        <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-muted">
          <span className={`h-2.5 w-2.5 rounded-full ${product.sellerOnline ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" : "bg-muted"}`} />
          {product.sellerOnline ? t("product.online") : t("product.offline")}
        </p>
      </div>

      <button
        className="relative z-20 grid h-12 w-12 place-items-center rounded-xl border border-rose-400/45 bg-rose-500/15 text-rose-300 transition hover:bg-rose-500/25 disabled:opacity-50"
        type="button"
        disabled={removing}
        aria-label={t("favorites.removeAria")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove();
        }}
      >
        <Heart className="h-5 w-5 fill-current" />
      </button>
    </article>
  );
}
