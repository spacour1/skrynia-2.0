"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgePercent, Star, Store, Timer } from "lucide-react";
import type { Product } from "../lib/api";
import { money } from "../lib/api";
import { GameIcon } from "./GameIcon";
import { firstProductMedia } from "../lib/product-media";

export function ProductCard({ product }: { product: Product }) {
  const router = useRouter();
  const imageUrl = firstProductMedia(product);
  const discount =
    product.oldPriceCents && Number(product.oldPriceCents) > Number(product.priceCents)
      ? Math.round(((Number(product.oldPriceCents) - Number(product.priceCents)) / Number(product.oldPriceCents)) * 100)
      : 0;

  return (
    <article
      className="interactive-card group relative cursor-pointer overflow-hidden"
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
      {imageUrl ? (
        <div className="relative z-0 overflow-hidden border-b border-line">
          <img className="aspect-[16/9] w-full object-cover transition duration-300 group-hover:scale-105" src={imageUrl} alt={product.title} />
        </div>
      ) : null}
      <div className="relative z-0 border-b border-line bg-panel/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              {product.isHot ? <span className="rounded-full bg-brand px-2 py-1 text-white dark:text-stone-950">ХИТ</span> : null}
              {discount ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-2 py-1 text-white">
                  <BadgePercent className="h-3 w-3" />-{discount}%
                </span>
              ) : null}
              {product.deliveryType === "instant" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-500">
                  <Timer className="h-3 w-3" /> instant
                </span>
              ) : null}
            </div>
            <h3 className="mt-3 line-clamp-2 text-base font-extrabold text-ink transition group-hover:text-brand">{product.title}</h3>
          </div>
          {product.gameName ? <GameIcon name={product.gameName} slug={product.gameSlug} className="h-11 w-11" /> : null}
        </div>
      </div>
      <div className="relative z-0 p-4">
        <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-6 text-muted">{product.description}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
          <span className="rounded-full bg-panel px-2 py-1">{product.gameName ?? product.categoryName}</span>
          <span className="rounded-full bg-panel px-2 py-1">{product.productType ?? product.sectionName ?? "service"}</span>
        </div>
        <div className="mt-5 flex items-end justify-between gap-3 border-t border-line pt-3">
          <Link href={`/sellers/${product.sellerId}`} className="relative z-20 inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-brand hover:underline" onClick={(event) => event.stopPropagation()}>
            <Store className="h-4 w-4 shrink-0" />
            <span className="truncate">{product.sellerDisplayName}</span>
          </Link>
          <div className="text-right">
            {product.oldPriceCents ? <p className="text-xs text-muted line-through">{money(Number(product.oldPriceCents), product.currency)}</p> : null}
            <p className="font-extrabold text-ink">{money(Number(product.priceCents), product.currency)}</p>
            <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted">
              <Star className="h-3.5 w-3.5 fill-action text-action" />
              {Number(product.sellerRating ?? 0).toFixed(1)}
            </p>
            <p className="mt-1 flex items-center justify-end gap-1 text-xs font-bold text-muted">
              <span className={`h-2.5 w-2.5 rounded-full ${product.sellerOnline ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" : "bg-muted"}`} />
              {product.sellerOnline ? "Онлайн" : "Не в сети"}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}
