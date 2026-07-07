"use client";

import { Heart, Timer } from "lucide-react";
import { useRouter } from "@/lib/navigation";
import { money, type Product } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function SellerListingRow({
  product,
  sellerDisplayName,
  sellerAvatarUrl,
  sellerRating,
  sellerMemberSince,
  isFavorite,
  favoritePending,
  onToggleFavorite
}: {
  product: Product;
  sellerDisplayName: string;
  sellerAvatarUrl?: string | null;
  sellerRating: number;
  sellerMemberSince: string;
  isFavorite: boolean;
  favoritePending: boolean;
  onToggleFavorite: (product: Product) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();

  const badges: string[] = [];
  if (product.gameName) badges.push(product.gameName);
  if (product.sectionName) badges.push(product.sectionName);
  if (!product.gameName && product.categoryName) badges.push(product.categoryName);
  if (product.server) badges.push(product.server);
  if (product.platform) badges.push(product.platform);

  function open() {
    router.push(`/products/${product.id}`);
  }

  return (
    <article
      className="group grid cursor-pointer grid-cols-1 items-center gap-3 rounded-xl border border-line/70 bg-card px-4 py-2.5 transition hover:border-brand/60 lg:grid-cols-[minmax(0,1fr)_240px_140px_40px] lg:gap-4"
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
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-muted">
          {product.deliveryType === "instant" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-emerald-500">
              <Timer className="h-2.5 w-2.5" /> {t("product.instant")}
            </span>
          ) : null}
          {product.productType ? (
            <span className="rounded-full bg-panel px-1.5 py-0.5">{t(`product.type.${product.productType}`)}</span>
          ) : null}
          {badges.map((badge) => (
            <span key={badge} className="rounded-full bg-panel px-1.5 py-0.5">
              {badge}
            </span>
          ))}
          {(product.cardMetadata ?? []).map((entry) => (
            <span key={entry.key} className="rounded-full bg-panel px-1.5 py-0.5">
              {entry.label}: {Array.isArray(entry.value) ? entry.value.join(", ") : String(entry.value)}
            </span>
          ))}
        </div>
        <h3 className="mt-1 truncate text-sm font-extrabold text-ink transition group-hover:text-brand">{product.title}</h3>
        <p className="truncate text-xs text-muted">{product.description}</p>
      </div>

      <div className="flex items-center gap-2 text-xs font-bold text-muted lg:min-w-0">
        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-600 to-slate-900 text-[11px] font-black text-white">
          {sellerAvatarUrl ? (
            <img className="h-full w-full object-cover" src={sellerAvatarUrl} alt={sellerDisplayName} />
          ) : (
            sellerDisplayName.slice(0, 1).toUpperCase()
          )}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-ink">{sellerDisplayName}</p>
          <p className="truncate text-[11px] font-normal text-muted">
            ★ {sellerRating.toFixed(1)} <span aria-hidden className="opacity-40">•</span> {t("seller.memberSince", { date: sellerMemberSince })}
          </p>
        </div>
      </div>

      <p className="text-left text-lg font-black text-emerald-400 lg:text-right">{money(Number(product.priceCents), product.currency)}</p>

      <button
        type="button"
        className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-rose-400/60 hover:text-rose-400 disabled:opacity-50 lg:ml-0"
        disabled={favoritePending}
        aria-label={isFavorite ? t("product.removeFavorite") : t("product.addFavorite")}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite(product);
        }}
      >
        <Heart className={`h-4 w-4 ${isFavorite ? "fill-current text-rose-400" : ""}`} />
      </button>
    </article>
  );
}
