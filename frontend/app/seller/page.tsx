"use client";

import Link from "next/link";
import { PackagePlus, TrendingUp } from "lucide-react";
import { useI18n } from "../../lib/i18n";

export default function SellerPage() {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Link className="interactive-card p-5" href="/seller/products">
        <PackagePlus className="h-7 w-7 text-brand" />
        <h1 className="mt-4 text-xl font-semibold">{t("seller.productManagement")}</h1>
        <p className="mt-1 text-sm text-muted">{t("seller.productManagementText")}</p>
      </Link>
      <Link className="interactive-card p-5" href="/seller/earnings">
        <TrendingUp className="h-7 w-7 text-brand" />
        <h1 className="mt-4 text-xl font-semibold">{t("seller.earnings")}</h1>
        <p className="mt-1 text-sm text-muted">{t("seller.earningsText")}</p>
      </Link>
    </div>
  );
}
