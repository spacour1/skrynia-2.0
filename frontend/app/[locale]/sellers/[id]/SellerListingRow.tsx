"use client";

import { Heart, ShieldCheck, Star, Trophy, Zap } from "lucide-react";
import { useRouter } from "@/lib/navigation";
import { money, type Product } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type FeatureBadge = {
  key: string;
  label: string;
  icon: typeof Zap;
  tone: string;
};

export function SellerListingRow({
  product,
  sellerDisplayName,
  sellerAvatarUrl,
  sellerRating,
  sellerCreatedAt,
  isFavorite,
  favoritePending,
  onToggleFavorite
}: {
  product: Product;
  sellerDisplayName: string;
  sellerAvatarUrl?: string | null;
  sellerRating: number;
  sellerCreatedAt: string;
  isFavorite: boolean;
  favoritePending: boolean;
  onToggleFavorite: (product: Product) => void;
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const memberSince = new Date(sellerCreatedAt).toLocaleDateString(locale === "ua" ? "uk-UA" : locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const features = buildFeatureBadges(product, t);
  const description = buildDescription(product, features);

  function open() {
    router.push(`/products/${product.id}`);
  }

  return (
    <article
      className="group grid min-h-[112px] cursor-pointer grid-cols-1 items-center gap-4 border-b border-line/65 bg-[#050b14] px-5 py-4 transition hover:bg-[#07111d] last:border-b-0 lg:h-[86px] lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_320px_180px_56px] lg:gap-6 lg:px-6 lg:py-2"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="min-w-0 overflow-hidden">
        <h3 className="truncate text-[19px] font-black uppercase leading-6 text-white transition group-hover:text-brand lg:text-[18px] lg:leading-5">
          {product.title}
        </h3>
        <div className="mt-1 flex h-5 items-center gap-4 overflow-hidden text-sm font-medium leading-none text-slate-300">
          {features.map(({ key, label, icon: Icon, tone }) => (
            <span key={key} className="inline-flex shrink-0 items-center gap-1.5">
              <Icon className={`h-4 w-4 ${tone}`} />
              {label}
            </span>
          ))}
        </div>
        <p className="mt-1 truncate text-sm leading-4 text-slate-300">{description}</p>
      </div>

      <div className="flex min-w-0 items-center gap-4 text-sm font-bold text-slate-300">
        <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-800 text-base font-black text-white shadow-[0_14px_34px_rgba(168,85,247,0.28)]">
          {sellerAvatarUrl ? <img className="h-full w-full object-cover" src={sellerAvatarUrl} alt={sellerDisplayName} /> : "D"}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-base font-black text-white">{sellerDisplayName}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-300">
            <Star className="h-4 w-4 fill-action text-action" />
            {sellerRating.toFixed(1)} <span>({product.sellerReviewCount?.toLocaleString?.() ?? "1,246"})</span>
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-slate-400">{t("seller.memberSince", { date: memberSince })}</p>
        </div>
      </div>

      <p className="text-left text-[26px] font-black leading-none text-emerald-400 lg:text-right">{money(Number(product.priceCents), product.currency)}</p>

      <button
        type="button"
        className="ml-auto grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-[#07101b] text-muted transition hover:border-rose-400/60 hover:text-rose-400 disabled:opacity-50 lg:ml-0"
        disabled={favoritePending}
        aria-label={isFavorite ? t("product.removeFavorite") : t("product.addFavorite")}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite(product);
        }}
      >
        <Heart className={`h-6 w-6 ${isFavorite ? "fill-current text-rose-400" : ""}`} />
      </button>
    </article>
  );
}

function buildFeatureBadges(product: Product, t: (key: string) => string): FeatureBadge[] {
  const metadata = (product.cardMetadata ?? [])
    .map((entry) => formatCardValue(entry.value) || entry.label)
    .filter(Boolean);
  const labels = [
    product.deliveryType === "instant" ? t("product.instant") : metadata[0] || product.server || "Safe play",
    product.productType ? t(`product.type.${product.productType}`) : metadata[1] || product.sectionName || "Fast delivery",
    metadata[2] || product.platform || product.gameName || product.categoryName || "Safe trade"
  ];
  return [
    { key: "primary", label: labels[0], icon: Zap, tone: "fill-action text-action" },
    { key: "secondary", label: labels[1], icon: Trophy, tone: "fill-action text-action" },
    { key: "tertiary", label: labels[2], icon: ShieldCheck, tone: "text-sky-300" }
  ];
}

function buildDescription(product: Product, features: FeatureBadge[]) {
  if (product.description) return product.description;
  return features.map((feature) => feature.label).join(" • ");
}

function formatCardValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
