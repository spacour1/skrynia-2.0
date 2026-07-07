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

  const stats: Array<{ key: string; label: string; value: string; subtext?: string; icon: typeof Box }> = [
    { key: "active", label: t("seller.activeListings"), value: activeListings.toLocaleString(), icon: Box },
    { key: "sales", label: t("seller.completedSales"), value: completedSales.toLocaleString(), icon: CheckCircle2 },
    { key: "success", label: t("seller.successRate"), value: `${successRate}%`, subtext: "Orders completed", icon: ShieldCheck },
    { key: "favorites", label: t("seller.addedToFavorites"), value: favoriteCount.toLocaleString(), subtext: "users", icon: Heart }
  ];

  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[550px] xl:w-[620px]">
      {stats.map(({ key, label, value, subtext, icon: Icon }) => (
        <div
          key={key}
          className="grid h-[118px] grid-cols-[34px_minmax(0,1fr)] gap-4 rounded-xl border border-line/80 bg-[#07101b]/86 px-6 py-5 shadow-[0_18px_42px_rgba(0,0,0,0.24)] backdrop-blur-md transition hover:border-brand/70"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-medium leading-tight text-slate-200">{label}</p>
            <p className="mt-4 text-[28px] font-black leading-none text-white">{value}</p>
            {subtext ? <p className="mt-2 text-sm font-medium text-slate-300">{subtext}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
