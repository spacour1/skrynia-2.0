"use client";

import { Box, CheckCircle2, Heart, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function SellerStatsGrid({
  activeListings,
  completedSales,
  successRate,
  favoriteCount
}: {
  activeListings: number;
  completedSales: number;
  successRate: number;
  favoriteCount: number;
}) {
  const { t } = useI18n();

  const stats: Array<{ key: string; label: string; value: string | number; icon: typeof Box }> = [
    { key: "active", label: t("seller.activeListings"), value: activeListings, icon: Box },
    { key: "sales", label: t("seller.completedSales"), value: completedSales, icon: CheckCircle2 },
    { key: "success", label: t("seller.successRate"), value: `${successRate}%`, icon: ShieldCheck },
    { key: "favorites", label: t("seller.addedToFavorites"), value: favoriteCount, icon: Heart }
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map(({ key, label, value, icon: Icon }) => (
        <div
          key={key}
          className="flex min-h-[88px] items-center gap-3 rounded-xl border border-line/80 bg-card/80 p-3.5 backdrop-blur-sm transition hover:border-brand/70"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold leading-tight text-muted">{label}</p>
            <p className="mt-0.5 text-lg font-black text-ink">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
