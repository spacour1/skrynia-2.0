"use client";

import Link from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgePercent,
  ChevronDown,
  Filter,
  Heart,
  RotateCcw,
  SlidersHorizontal,
  Star
} from "lucide-react";
import { GameIcon } from "@/components/GameIcon";
import { apiFetch, money, type Game, type GameSection, type Product } from "@/lib/api";
import { catalogApi, type CatalogField } from "@/lib/catalog-api";
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
    <div className="mx-auto max-w-[1380px] space-y-5 text-slate-100">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-900/80 text-slate-400 transition hover:border-amber-400/60 hover:text-slate-100"
            href="/"
            aria-label={t("common.back")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <GameIcon name={game?.name ?? slug} slug={slug} className="h-16 w-16 rounded-xl" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black text-slate-100 md:text-3xl">{game?.name ?? t("common.loading")}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-400">{t("catalog.totalListings", { count: total.toLocaleString(language) })}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <p className="whitespace-nowrap text-sm font-bold text-slate-500">{t("catalog.sortBy")}</p>
            <div className="relative w-full min-w-[220px] sm:w-[240px]">
              <select
                className="h-11 w-full appearance-none rounded-lg border border-slate-800 bg-slate-900 px-4 pr-10 text-sm font-black text-slate-100 outline-none transition hover:border-amber-400/50 focus:border-amber-400"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                {sortOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <h2 className="font-black text-slate-100">{t("catalog.filters")}</h2>
              </div>
              <button
                className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 transition hover:text-amber-300"
                type="button"
                onClick={resetFilters}
              >
                {t("catalog.resetAll")}
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-800">
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
                      <span className="font-black text-slate-500">{item.count.toLocaleString(language)}</span>
                    </button>
                  ))}
                </div>
              </FilterBlock>

              <FilterBlock label={t("catalog.autoDelivery")}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 text-sm font-semibold text-slate-400 transition hover:text-slate-100">
                  <input
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-amber-400"
                    type="checkbox"
                    checked={autoDeliveryOnly}
                    onChange={(event) => setAutoDeliveryOnly(event.target.checked)}
                  />
                  {t("catalog.autoDeliveryAfterPurchase")}
                </label>
              </FilterBlock>

              <FilterBlock label={t("catalog.sellers")}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 text-sm font-semibold text-slate-400 transition hover:text-slate-100">
                  <input
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-amber-400"
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
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 text-sm font-black text-slate-200 transition hover:border-amber-400/50 hover:text-amber-300"
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

        <main className="min-w-0">
          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/65">
            {products.isLoading ? <div className="p-10 text-center text-sm font-bold text-slate-500">{t("catalog.loadingOffers")}</div> : null}
            {!products.isLoading && !visibleList.length ? (
              <div className="grid min-h-[260px] place-items-center p-10 text-center">
                <div>
                  <Filter className="mx-auto h-10 w-10 text-slate-600" />
                  <h2 className="mt-4 text-xl font-black text-slate-100">{t("catalog.noOffersTitle")}</h2>
                  <p className="mt-2 text-sm text-slate-500">{t("catalog.noOffersText")}</p>
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
              <button className="flex h-14 w-full items-center justify-center gap-2 border-t border-slate-800 bg-slate-900/50 text-sm font-black text-slate-400 transition hover:bg-slate-900 hover:text-amber-300">
                {t("catalog.showMore")}
                <ChevronDown className="h-4 w-4" />
              </button>
            ) : null}
          </section>
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
  const tenure = index % 3 === 0 ? t("catalog.tenureOneYear") : index % 3 === 1 ? t("catalog.tenureTwoYears") : t("catalog.tenureMonths");
  const metrics = offerMetrics(product, index, t);

  return (
    <article
      className="group relative cursor-pointer border-b border-slate-800 bg-slate-950/35 transition hover:bg-slate-900/65"
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
      <div className="relative grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_190px_120px_44px] md:items-center lg:px-6">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase leading-6 text-slate-100 transition group-hover:text-amber-200">
            {product.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-black text-slate-200">
            {metrics.map((metric) => (
              <span key={metric.label} className="inline-flex items-center gap-1">
                <span>{metric.icon}</span>
                {metric.label}
              </span>
            ))}
          </div>
          <p className="mt-1 line-clamp-1 text-xs font-semibold text-slate-500">
            <span className="text-amber-300">⚡</span> {product.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black">
            {product.deliveryType === "instant" ? <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-400">{t("catalog.autoDeliveryBadge")}</span> : null}
            {discount ? (
              <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-1 text-rose-300">
                <BadgePercent className="h-3 w-3" />
                -{discount}%
              </span>
            ) : null}
            <span className="rounded bg-slate-900 px-2 py-1 text-slate-400">{product.productType ?? product.sectionName ?? "Account"}</span>
          </div>
        </div>

        <Link
          href={`/sellers/${product.sellerId}`}
          className="relative z-20 flex min-w-0 items-center gap-3 rounded-lg p-1 transition hover:bg-slate-950"
          onClick={(event) => event.stopPropagation()}
        >
          <span className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatar} text-sm font-black text-white`}>
            {product.sellerDisplayName.slice(0, 1).toUpperCase()}
            <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-slate-950 ${product.sellerOnline ? "bg-emerald-400" : "bg-slate-600"}`} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black text-slate-100">{product.sellerDisplayName}</span>
            <span className="mt-0.5 flex items-center gap-1 text-xs font-bold text-slate-400">
              <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />
              {Number(product.sellerRating ?? 0).toFixed(1)} ({product.sellerReviewCount ?? 0})
            </span>
            <span className="mt-0.5 block text-xs font-semibold text-slate-500">{tenure}</span>
          </span>
        </Link>

        <div className="text-right">
          {product.oldPriceCents ? <p className="text-xs font-bold text-slate-600 line-through">{money(Number(product.oldPriceCents), product.currency)}</p> : null}
          <p className="text-xl font-black text-emerald-400">{money(Number(product.priceCents), product.currency)}</p>
        </div>

        <button
          className={`relative z-20 grid h-11 w-11 place-items-center rounded-xl border transition ${
            liked
              ? "border-rose-400/50 bg-rose-500/15 text-rose-300"
              : "border-slate-800 bg-slate-900/70 text-slate-500 hover:border-rose-400/50 hover:text-rose-300"
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

function FilterBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="p-4">
      <p className="mb-3 text-xs font-black text-slate-300">{label}</p>
      {children}
    </div>
  );
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
    "h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-2 text-sm font-semibold text-slate-100 outline-none transition focus:border-amber-400";

  if (field.type === "number") {
    const current = (value as { min: string; max: string } | undefined) ?? { min: "", max: "" };
    return (
      <div>
        <p className="mb-1.5 text-xs font-bold text-slate-400">{field.label}</p>
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
        <p className="mb-1.5 text-xs font-bold text-slate-400">{field.label}</p>
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
        <p className="mb-1.5 text-xs font-bold text-slate-400">{field.label}</p>
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
      <p className="mb-1.5 text-xs font-bold text-slate-400">{field.label}</p>
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
      ? "border-amber-400/45 bg-amber-400/10 text-amber-300"
      : "border-transparent text-slate-500 hover:border-slate-800 hover:bg-slate-900 hover:text-slate-200"
  }`;
}

function buildSectionRows(sections: GameSection[], total: number, t: (key: string) => string) {
  const normalizedSections = sections.slice(0, 6).map((section) => ({
    value: section.slug,
    label: section.name,
    count: section.lotCount ?? 0,
    kind: "section" as const
  }));

  if (normalizedSections.length) {
    return [{ value: "", label: t("catalog.allSections"), count: total, kind: "all" as const }, ...normalizedSections];
  }

  return productTypes.map(([value, label], index) => ({
    value,
    // The first row is a translation key; the rest are product-type names shown as-is.
    label: index === 0 ? t(label) : label,
    count: index === 0 ? total : Math.max(0, Math.floor(total / (index + 2))),
    kind: value ? ("type" as const) : ("all" as const)
  }));
}

function offerMetrics(product: Product, index: number, t: (key: string, params?: Record<string, string | number>) => string) {
  const base = Number(product.priceCents ?? 0);
  return [
    { icon: "🔑", label: `${Math.max(1200, Math.round(base / 12))} MMR` },
    { icon: "🏆", label: t("catalog.metricIntegrity", { value: Math.max(2500, Number(product.salesCount ?? 0) * 150 + 5000) }) },
    { icon: index % 2 ? "🍀" : "🛡️", label: t("catalog.metricPoliteness", { value: Math.max(3000, Math.round(base / 8)) }) }
  ];
}
