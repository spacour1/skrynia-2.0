"use client";

import type { LucideIcon } from "lucide-react";
import Link from "@/lib/navigation";
import { useLocale } from "@/lib/i18n";
import { formatNumber } from "@/lib/locale-format";

type MarketplaceCategory = {
  slug: string;
  activeProductCount: number;
};

export function MarketplaceCategoryLink({
  category,
  Icon,
  label,
  itemsLabel
}: {
  category: MarketplaceCategory;
  Icon: LucideIcon;
  label: string;
  itemsLabel: string;
}) {
  const locale = useLocale();
  return (
    <Link
      href={`/marketplace?category=${encodeURIComponent(category.slug)}`}
      className="flex items-center gap-3 rounded-xl border border-line bg-card p-3 shadow-soft transition hover:-translate-y-0.5 hover:border-brand/60"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-brand/40 bg-brand/10 text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black text-ink">{label}</span>
        <span className="block truncate text-xs text-muted">
          {formatNumber(category.activeProductCount, locale)} {itemsLabel}
        </span>
      </span>
    </Link>
  );
}
