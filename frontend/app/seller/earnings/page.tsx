"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, money } from "../../../lib/api";
import { RequireAuth } from "../../../components/RequireAuth";
import { useI18n } from "../../../lib/i18n";

type WalletResponse = {
  wallet?: { currency: string; availableCents: number; escrowCents: number } | null;
  wallets?: { currency: string; availableCents: number; escrowCents: number }[];
  transactions: { id: string; type: string; amountCents: number; currency: string; createdAt: string }[];
};

export default function SellerEarningsPage() {
  return (
    <RequireAuth>
      <SellerEarningsContent />
    </RequireAuth>
  );
}

function SellerEarningsContent() {
  const { t } = useI18n();
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<WalletResponse>("/users/me/wallet")
  });

  const wallets = wallet.data?.wallets ?? (wallet.data?.wallet ? [wallet.data.wallet] : []);
  const releaseTx = wallet.data?.transactions.filter((tx) => tx.type === "escrow_release") ?? [];
  const gross = formatCurrencyTotals(
    releaseTx.reduce<Record<string, number>>((sum, tx) => {
      sum[tx.currency] = (sum[tx.currency] ?? 0) + Number(tx.amountCents);
      return sum;
    }, {})
  );

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="interactive-card p-5">
          <p className="text-sm text-muted">{t("seller.available")}</p>
          <p className="mt-2 text-2xl font-bold">{formatWalletTotals(wallets, "availableCents")}</p>
        </div>
        <div className="interactive-card p-5">
          <p className="text-sm text-muted">{t("seller.inEscrow")}</p>
          <p className="mt-2 text-2xl font-bold">{formatWalletTotals(wallets, "escrowCents")}</p>
        </div>
        <div className="interactive-card p-5">
          <p className="text-sm text-muted">{t("seller.releasedNet")}</p>
          <p className="mt-2 text-2xl font-bold">{gross}</p>
        </div>
      </section>
      <Link className="app-button" href="/seller/products">
        {t("seller.productManagement")}
      </Link>
    </div>
  );
}

function formatWalletTotals(wallets: NonNullable<WalletResponse["wallets"]>, field: "availableCents" | "escrowCents") {
  const totals = wallets.reduce<Record<string, number>>((result, item) => {
    result[item.currency] = (result[item.currency] ?? 0) + Number(item[field]);
    return result;
  }, {});
  return formatCurrencyTotals(totals);
}

function formatCurrencyTotals(totals: Record<string, number>) {
  const rows = Object.entries(totals).filter(([, amount]) => amount !== 0);
  if (!rows.length) return money(0, "UAH", { preserveCurrency: true });
  return rows.map(([currency, amount]) => money(amount, currency, { preserveCurrency: true })).join(" / ");
}
