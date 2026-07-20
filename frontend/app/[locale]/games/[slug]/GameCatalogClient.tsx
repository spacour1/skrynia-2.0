"use client";

import Link from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgePercent,
  ChevronDown,
  ChevronRight,
  Filter,
  Heart,
  RotateCcw,
  SlidersHorizontal,
  Star,
  Zap
} from "lucide-react";
import { GameIcon } from "@/components/GameIcon";
import { apiFetch, money, type Game, type GameSection, type Product } from "@/lib/api";
import { catalogApi, type CatalogField } from "@/lib/catalog-api";
import { buildCatalogGroups } from "@/lib/game-catalog";
import { firstProductMedia } from "@/lib/product-media";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { showAppToast } from "@/lib/toast-events";

type MetaFilterValue = string | { min: string; max: string };

const productTypes = [
  ["", "catalog.allSections"],
  ["account", "Accounts"],
  ["currency", "Currency"],
  ["item", "Items"],
  ["boosting", "Boosting"],
  ["service", "Services"],
  ["key", "Keys & Codes"]
];

const sortOptions = [
  ["newest", "catalog.sortNewest"],
  ["sales", "catalog.sortPopular"],
  ["price_asc", "catalog.sortPriceLow"],
  ["price_desc", "catalog.sortPriceHigh"],
  ["rating", "catalog.sortSellerRating"],
  ["discount", "catalog.sortDiscount"]
];

const sellerAvatars = [
  "from-violet-500 via-fuchsia-700 to-slate-950",
  "from-emerald-400 via-teal-700 to-slate-950",
  "from-sky-400 via-blue-700 to-slate-950",
  "from-rose-400 via-red-700 to-slate-950",
  "from-amber-300 via-orange-700 to-slate-950",
  "from-lime-300 via-green-700 to-slate-950"
];

export function GameCatalogClient({ slug }: { slug: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const { language, t } = useI18n();
  const user = useAuth((state) => state.user);
  const [section, setSection] = useState("");
  const [productType, setProductType] = useState("");
  const [autoDeliveryOnly, setAutoDeliveryOnly] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sort, setSort] = useState("newest");
  const [metaFilters, setMetaFilters] = useState<Record<string, MetaFilterValue>>({});

  const gameDetail = useQuery({
    queryKey: ["game-page", slug],
    queryFn: () => apiFetch<{ game: Game; sections: GameSection[] }>(`/marketplace/games/${slug}`)
  });
  const sections = gameDetail.data?.sections ?? [];

  // A "section" filter row here is the section's slug (legacy, kept as-is - see the
  // buildSectionRows fallback for games with no real sections). Metadata filters need the
  // section's id, not its slug, because slugs aren't guaranteed globally unique - only
  // within a single game they are.
  const selectedSectionObj = section ? (sections.find((candidate) => candidate.slug === section) ?? null) : null;

  const sectionSchema = useQuery({
    queryKey: ["public-section-schema", selectedSectionObj?.id],
    queryFn: () => catalogApi.sectionSchema(selectedSectionObj!.id),
    enabled: Boolean(selectedSectionObj)
  });
  const filterableFields = useMemo(
    () => (sectionSchema.data?.schema.fields ?? []).filter((field) => field.filterable),
    [sectionSchema.data]
  );

  // Metadata filter values only make sense for the section they were entered against -
  // switching sections (or clearing the section filter) drops them rather than silently
  // carrying over a filter the new section's schema may not even have.
  useEffect(() => {
    setMetaFilters({});
  }, [selectedSectionObj?.id]);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    search.set("game", slug);
    search.set("sort", sort);
    search.set("limit", "80");
    if (section) search.set("section", section);
    if (productType) search.set("productType", productType);
    if (autoDeliveryOnly) search.set("deliveryType", "instant");
    if (selectedSectionObj) {
      search.set("sectionId", selectedSectionObj.id);
      for (const field of filterableFields) {
        const value = metaFilters[field.key];
        if (value === undefined) continue;
        if (typeof value === "object") {
          if (value.min) search.set(`meta[${field.key}][min]`, value.min);
          if (value.max) search.set(`meta[${field.key}][max]`, value.max);
        } else if (value !== "") {
          search.set(`meta[${field.key}]`, value);
        }
      }
    }
    return search.toString();
  }, [slug, section, productType, autoDeliveryOnly, sort, selectedSectionObj, filterableFields, metaFilters]);

  const products = useQuery({
    queryKey: ["game-products", query],
    queryFn: () => apiFetch<{ products: Product[]; total: number }>(`/marketplace/products?${query}`)
  });
  const favoriteIds = useQuery({
    queryKey: ["favorite-ids"],
    queryFn: () => apiFetch<{ productIds: string[] }>("/marketplace/favorites/ids"),
    enabled: Boolean(user)
  });
  const favoriteMutation = useMutation({
    mutationFn: ({ productId, liked }: { productId: string; liked: boolean }) =>
      apiFetch(`/marketplace/favorites/${productId}`, { method: liked ? "DELETE" : "PUT" }),
    onMutate: async ({ productId, liked }) => {
      await client.cancelQueries({ queryKey: ["favorite-ids"] });
      const previous = client.getQueryData<{ productIds: string[] }>(["favorite-ids"]);
      client.setQueryData<{ productIds: string[] }>(["favorite-ids"], (current) => {
        const ids = current?.productIds ?? [];
        return { productIds: liked ? ids.filter((id) => id !== productId) : Array.from(new Set([productId, ...ids])) };
      });
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(["favorite-ids"], context.previous);
      if ((error as { status?: number }).status === 401) router.push("/login");
    },
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ["favorite-ids"] });
      client.invalidateQueries({ queryKey: ["favorites"] });
      showAppToast({
        type: "favorite",
        title: variables.liked ? t("home.favoriteRemoved") : t("home.favoriteAdded"),
        productId: variables.productId
      });
    }
  });

  const game = gameDetail.data?.game;
  const list = products.data?.products ?? [];
  const visibleList = onlineOnly ? list.filter((product) => product.sellerOnline) : list;
  const total = products.data?.total ?? visibleList.length;
  const likedSet = new Set(favoriteIds.data?.productIds ?? []);

  const sectionRows = buildSectionRows(sections, total, t);

  function resetFilters() {
    setSection("");
    setProductType("");
    setAutoDeliveryOnly(false);
    setOnlineOnly(false);
    setSort("newest");
    setMetaFilters({});
  }

  return (
    <div className="mx-auto max-w-[1380px] space-y-5 text-ink">
      <nav className="flex items-center gap-1.5 text-xs font-bold text-muted">
        <Link href="/" className="transition hover:text-brand">
          {t("nav.home")}
        </Link>
        <ChevronRight className="h-3 w-3 text-muted/70" />
        <Link href="/#game-catalog" className="transition hover:text-brand">
          {t("nav.catalog")}
        </Link>
        <ChevronRight className="h-3 w-3 text-muted/70" />
        <span className="truncate text-ink">{game?.name ?? slug}</span>
      </nav>

      {game?.banner || game?.backgroundImage ? (
        <div className="relative h-[150px] overflow-hidden rounded-xl border border-line md:h-[210px]">
          <img className="h-full w-full object-cover" src={game.banner ?? game.backgroundImage ?? ""} alt="" draggable={false} />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,15,0.05)_30%,rgba(2,6,15,0.82))]" />
          {game?.logoImage ? <img className="absolute bottom-4 left-5 max-h-12 max-w-[220px] object-contain" src={game.logoImage} alt="" draggable={false} /> : null}
        </div>
      ) : null}

      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-muted transition hover:border-brand/60 hover:text-ink"
            href="/"
            aria-label={t("common.back")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <GameIcon name={game?.name ?? slug} slug={slug} className="h-16 w-16 rounded-xl" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black text-ink md:text-3xl">{game?.name ?? t("common.loading")}</h1>
            <p className="mt-1 text-sm font-semibold text-muted">{t("catalog.totalListings", { count: total.toLocaleString(language) })}</p>
            {game?.shortDescription ? <p className="mt-1 line-clamp-2 max-w-[560px] text-sm text-muted">{game.shortDescription}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <p className="whitespace-nowrap text-sm font-bold text-muted">{t("catalog.sortBy")}</p>
            <div className="relative w-full min-w-[220px] sm:w-[240px]">
              <select
                className="h-11 w-full appearance-none rounded-lg border border-line bg-card px-4 pr-10 text-sm font-black text-ink outline-none transition hover:border-brand/50 focus:border-brand"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                {sortOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <section className="overflow-hidden rounded-lg border border-line bg-card shadow-soft">
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand">
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <h2 className="font-black text-ink">{t("catalog.filters")}</h2>
              </div>
              <button
                className="inline-flex items-center gap-1 text-xs font-bold text-muted transition hover:text-brand"
                type="button"
                onClick={resetFilters}
              >
                {t("catalog.resetAll")}
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="divide-y divide-line">
              <FilterBlock label={t("catalog.sectionLabel")}>
                <div className="space-y-1">
                  {sectionRows.map((item) => (
                    <button
                      key={item.value}
                      className={sectionButton((item.value === "" && !section && !productType) || section === item.value || productType === item.value)}
                      type="button"
                      onClick={() => {
                        setSection(item.kind === "section" ? item.value : "");
                        setProductType(item.kind === "type" ? item.value : "");
                      }}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.count != null ? <span className="font-black text-muted">{item.count.toLocaleString(language)}</span> : null}
                    </button>
                  ))}
                </div>
              </FilterBlock>

              <FilterBlock label={t("catalog.autoDelivery")}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 text-sm font-semibold text-muted transition hover:text-ink">
                  <input
                    className="h-4 w-4 rounded border-line bg-panel accent-brand"
                    type="checkbox"
                    checked={autoDeliveryOnly}
                    onChange={(event) => setAutoDeliveryOnly(event.target.checked)}
                  />
                  {t("catalog.autoDeliveryAfterPurchase")}
                </label>
              </FilterBlock>

              <FilterBlock label={t("catalog.sellers")}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 text-sm font-semibold text-muted transition hover:text-ink">
                  <input
                    className="h-4 w-4 rounded border-line bg-panel accent-brand"
                    type="checkbox"
                    checked={onlineOnly}
                    onChange={(event) => setOnlineOnly(event.target.checked)}
                  />
                  {t("catalog.onlineSellersOnly")}
                </label>
              </FilterBlock>

              {filterableFields.length ? (
                <FilterBlock label={t("catalog.additionalFilters")}>
                  <div className="space-y-3">
                    {filterableFields.map((field) => (
                      <SchemaFilterControl
                        key={field.key}
                        field={field}
                        value={metaFilters[field.key]}
                        onChange={(value) =>
                          setMetaFilters((current) => {
                            const next = { ...current };
                            if (value === undefined) delete next[field.key];
                            else next[field.key] = value;
                            return next;
                          })
                        }
                      />
                    ))}
                  </div>
                </FilterBlock>
              ) : null}

              <div className="p-4">
                <button
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel/60 text-sm font-black text-ink transition hover:border-brand/50 hover:text-brand"
                  type="button"
                  onClick={resetFilters}
                >
                  {t("catalog.resetFilters")}
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        </aside>

        <main className="min-w-0 space-y-5">
          <section className="overflow-hidden rounded-lg border border-line bg-card">
            {products.isLoading ? <div className="p-10 text-center text-sm font-bold text-muted">{t("catalog.loadingOffers")}</div> : null}
            {!products.isLoading && !visibleList.length ? (
              <div className="grid min-h-[260px] place-items-center p-10 text-center">
                <div>
                  <Filter className="mx-auto h-10 w-10 text-muted" />
                  <h2 className="mt-4 text-xl font-black text-ink">{t("catalog.noOffersTitle")}</h2>
                  <p className="mt-2 text-sm text-muted">{t("catalog.noOffersText")}</p>
                </div>
              </div>
            ) : null}

            {visibleList.map((product, index) => (
              <OfferRow
                key={product.id}
                index={index}
                product={product}
                liked={likedSet.has(product.id)}
                onToggleFavorite={(liked) => {
                  if (!user) {
                    router.push("/login");
                    return;
                  }
                  favoriteMutation.mutate({ productId: product.id, liked });
                }}
              />
            ))}

            {visibleList.length ? (
              <button className="flex h-14 w-full items-center justify-center gap-2 border-t border-line bg-panel/40 text-sm font-black text-muted transition hover:bg-panel hover:text-brand">
                {t("catalog.showMore")}
                <ChevronDown className="h-4 w-4" />
              </button>
            ) : null}
          </section>

          <RelatedGames currentSlug={slug} />
        </main>
      </div>
    </div>
  );
}

function OfferRow({
  product,
  index,
  liked,
  onToggleFavorite
}: {
  product: Product;
  index: number;
  liked: boolean;
  onToggleFavorite: (liked: boolean) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const discount =
    product.oldPriceCents && Number(product.oldPriceCents) > Number(product.priceCents)
      ? Math.round(((Number(product.oldPriceCents) - Number(product.priceCents)) / Number(product.oldPriceCents)) * 100)
      : 0;
  const avatar = sellerAvatars[index % sellerAvatars.length];
  const image = firstProductMedia(product);
  // Real, schema-driven specs the seller actually entered for this lot (region, warranty,
  // account level, etc.) - no invented "MMR / integrity / politeness" numbers.
  const specs = (product.cardMetadata ?? []).filter((spec) => spec.value != null && spec.value !== "").slice(0, 4);

  return (
    <article
      className="group relative cursor-pointer border-b border-line bg-card transition hover:bg-panel/40"
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
      <div className="relative grid gap-4 px-4 py-4 md:grid-cols-[64px_minmax(0,1fr)_190px_120px_44px] md:items-center lg:px-6">
        <div className="relative hidden h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line md:block">
          {image ? (
            <img className="h-full w-full object-cover transition duration-300 group-hover:scale-105" src={image} alt="" loading="lazy" draggable={false} />
          ) : (
            <GameIcon name={product.gameName ?? product.title} slug={product.gameSlug} className="h-full w-full rounded-none" />
          )}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-black uppercase leading-6 text-ink transition group-hover:text-brand">{product.title}</p>
          {specs.length ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-muted">
              {specs.map((spec) => (
                <span key={spec.key} className="inline-flex items-center gap-1">
                  <span className="text-ink">{spec.label}:</span>
                  {formatSpecValue(spec.value, t)}
                </span>
              ))}
            </div>
          ) : null}
          <p className="mt-1 line-clamp-1 text-xs font-semibold text-muted">
            <Zap className="mr-0.5 inline h-3 w-3 text-brand" /> {product.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black">
            {product.deliveryType === "instant" ? <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-400">{t("catalog.autoDeliveryBadge")}</span> : null}
            {discount ? (
              <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-1 text-rose-300">
                <BadgePercent className="h-3 w-3" />
                -{discount}%
              </span>
            ) : null}
            {product.productType || product.sectionName ? (
              <span className="rounded bg-panel px-2 py-1 text-muted">{product.sectionName ?? product.productType}</span>
            ) : null}
          </div>
        </div>

        <Link
          href={`/sellers/${product.sellerId}`}
          className="relative z-20 flex min-w-0 items-center gap-3 rounded-lg p-1 transition hover:bg-panel"
          onClick={(event) => event.stopPropagation()}
        >
          <span className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatar} text-sm font-black text-white`}>
            {product.sellerDisplayName.slice(0, 1).toUpperCase()}
            <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-card ${product.sellerOnline === true ? "bg-emerald-400" : product.sellerOnline === false ? "bg-muted/50" : "bg-action/70"}`} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black text-ink">{product.sellerDisplayName}</span>
            <span className="mt-0.5 flex items-center gap-1 text-xs font-bold text-muted">
              <Star className="h-3.5 w-3.5 fill-brand text-brand" />
              {Number(product.sellerRating ?? 0).toFixed(1)} ({product.sellerReviewCount ?? 0})
            </span>
          </span>
        </Link>

        <div className="text-right">
          {product.oldPriceCents ? <p className="text-xs font-bold text-muted line-through">{money(Number(product.oldPriceCents), product.currency)}</p> : null}
          <p className="text-xl font-black text-brand">{money(Number(product.priceCents), product.currency)}</p>
        </div>

        <button
          className={`relative z-20 grid h-11 w-11 place-items-center rounded-xl border transition ${
            liked
              ? "border-brand/50 bg-brand/10 text-brand"
              : "border-line bg-panel text-muted hover:border-brand/50 hover:text-brand"
          }`}
          type="button"
          aria-label={liked ? t("product.removeFavorite") : t("product.addFavorite")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavorite(liked);
          }}
        >
          <Heart className={`h-5 w-5 ${liked ? "fill-current" : ""}`} />
        </button>
      </div>
    </article>
  );
}

function RelatedGames({ currentSlug }: { currentSlug: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const games = useQuery({
    queryKey: ["games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games"),
    staleTime: 5 * 60 * 1000
  });

  const related = useMemo(() => {
    const all = games.data?.games ?? [];
    const groups = buildCatalogGroups(all);
    // Prefer siblings from the same themed group (platforms next to platforms, etc.);
    // fall back to the whole catalog if this game isn't in a themed group.
    const group =
      groups.find((candidate) => candidate.key !== "all" && candidate.games.some((game) => game.slug === currentSlug)) ??
      groups.find((candidate) => candidate.games.some((game) => game.slug === currentSlug));
    return (group?.games ?? all).filter((game) => game.slug !== currentSlug).slice(0, 8);
  }, [games.data, currentSlug]);

  if (!related.length) return null;

  return (
    <section className="rounded-lg border border-line bg-card p-4 shadow-soft">
      <h2 className="mb-3 text-sm font-black text-ink">{t("catalog.relatedTitle")}</h2>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        {related.map((game) => (
          <button
            key={game.id}
            type="button"
            className="group flex flex-col items-center gap-2 rounded-xl border border-line bg-panel/40 p-2.5 text-center transition hover:-translate-y-0.5 hover:border-brand/60"
            onClick={() => router.push(`/games/${game.slug}`)}
            title={game.name}
          >
            <GameIcon name={game.name} slug={game.slug} className="h-11 w-11" />
            <span className="line-clamp-2 min-h-[28px] text-[11px] font-bold leading-[14px] text-ink transition group-hover:text-brand">{game.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function FilterBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="p-4">
      <p className="mb-3 text-xs font-black text-muted">{label}</p>
      {children}
    </div>
  );
}

function formatSpecValue(value: unknown, t: (key: string) => string): string {
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

// Built entirely from the section's own active schema (key/label/type/options) - no
// hardcoded field names or per-game special cases, matching the no-code catalog principle.
function SchemaFilterControl({
  field,
  value,
  onChange
}: {
  field: CatalogField;
  value: MetaFilterValue | undefined;
  onChange: (value: MetaFilterValue | undefined) => void;
}) {
  const { t } = useI18n();
  const inputClass =
    "h-9 w-full rounded-md border border-line bg-panel px-2 text-sm font-semibold text-ink outline-none transition focus:border-brand";

  if (field.type === "number") {
    const current = (value as { min: string; max: string } | undefined) ?? { min: "", max: "" };
    return (
      <div>
        <p className="mb-1.5 text-xs font-bold text-muted">{field.label}</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputClass}
            type="number"
            placeholder={t("catalog.filterFrom")}
            value={current.min}
            onChange={(event) => onChange({ ...current, min: event.target.value })}
          />
          <input
            className={inputClass}
            type="number"
            placeholder={t("catalog.filterTo")}
            value={current.max}
            onChange={(event) => onChange({ ...current, max: event.target.value })}
          />
        </div>
      </div>
    );
  }

  if (field.type === "boolean" || field.type === "checkbox") {
    return (
      <div>
        <p className="mb-1.5 text-xs font-bold text-muted">{field.label}</p>
        <select
          className={inputClass}
          value={(value as string | undefined) ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        >
          <option value="">{t("catalog.filterAny")}</option>
          <option value="true">{t("common.yes")}</option>
          <option value="false">{t("common.no")}</option>
        </select>
      </div>
    );
  }

  if (field.type === "select" || field.type === "multiselect") {
    return (
      <div>
        <p className="mb-1.5 text-xs font-bold text-muted">{field.label}</p>
        <select
          className={inputClass}
          value={(value as string | undefined) ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        >
          <option value="">{t("catalog.filterAny")}</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-bold text-muted">{field.label}</p>
      <input
        className={inputClass}
        type="text"
        value={(value as string | undefined) ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      />
    </div>
  );
}

function sectionButton(active: boolean) {
  return `flex h-9 w-full items-center justify-between gap-3 rounded-md border px-3 text-left text-xs font-bold transition ${
    active
      ? "border-brand/45 bg-brand/10 text-brand"
      : "border-transparent text-muted hover:border-line hover:bg-panel hover:text-ink"
  }`;
}

type SectionRow = { value: string; label: string; count: number | null; kind: "all" | "section" | "type" };

function buildSectionRows(sections: GameSection[], total: number, t: (key: string) => string): SectionRow[] {
  const normalizedSections = sections.slice(0, 6).map((section) => ({
    value: section.slug,
    label: section.name,
    count: section.lotCount ?? 0,
    kind: "section" as const
  }));

  if (normalizedSections.length) {
    return [{ value: "", label: t("catalog.allSections"), count: total, kind: "all" as const }, ...normalizedSections];
  }

  // No real sections for this game yet: offer the generic product-type filters, but without
  // fabricating a per-type count - only the "all" row shows the real total.
  return productTypes.map(([value, label], index) => ({
    value,
    // The first row is a translation key; the rest are product-type names shown as-is.
    label: index === 0 ? t(label) : label,
    count: index === 0 ? total : null,
    kind: value ? ("type" as const) : ("all" as const)
  }));
}
