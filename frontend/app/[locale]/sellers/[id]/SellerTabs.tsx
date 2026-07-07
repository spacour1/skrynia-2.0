"use client";

import type { Product } from "@/lib/api";
import type { TranslateParams } from "@/i18n/dictionaries";

export type SellerTab = { key: string; label: string; count: number };

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
    <div className="flex gap-3 overflow-x-auto pb-0">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`inline-flex h-10 shrink-0 items-center gap-3 whitespace-nowrap rounded-xl border px-4 text-sm font-bold transition ${
            activeTab === tab.key
              ? "border-brand bg-brand text-stone-950 shadow-[0_12px_28px_rgba(246,190,78,0.18)]"
              : "border-line bg-card text-slate-200 hover:border-brand/60 hover:text-white"
          }`}
          onClick={() => onSelect(tab.key)}
        >
          <span>{tab.label}</span>
          <span className={`rounded-lg px-2 py-1 text-xs leading-none ${activeTab === tab.key ? "bg-stone-950/10 text-stone-950" : "bg-panel text-slate-300"}`}>
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  );
}
