"use client";

import type { Product } from "@/lib/api";
import type { TranslateParams } from "@/i18n/dictionaries";

export type SellerTab = { key: string; label: string; count: number };

/** Groups a seller's products into tabs: by game name, then category name, then product type. */
export function buildSellerTabs(products: Product[], t: (key: string, params?: TranslateParams) => string): SellerTab[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    const label = product.gameName || product.categoryName || (product.productType ? t(`product.type.${product.productType}`) : null);
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const groups = Array.from(counts.entries())
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count);

  return [{ key: "all", label: t("seller.allListings"), count: products.length }, ...groups];
}

export function SellerTabs({
  tabs,
  activeTab,
  onSelect
}: {
  tabs: SellerTab[];
  activeTab: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-bold transition ${
            activeTab === tab.key
              ? "border-brand bg-brand text-stone-950"
              : "border-line bg-card text-muted hover:border-brand/60 hover:text-ink"
          }`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label} <span className="opacity-70">{tab.count}</span>
        </button>
      ))}
    </div>
  );
}
