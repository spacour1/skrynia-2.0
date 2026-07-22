"use client";

import Link from "@/lib/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { sumMoneyCentsByCurrency, useMoney, type MoneyFormatter, type WireMoneyCents } from "@/lib/currency";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";

type WalletResponse = {
  wallet?: { currency: string; availableCents: WireMoneyCents; escrowCents: WireMoneyCents } | null;
  wallets?: { currency: string; availableCents: WireMoneyCents; escrowCents: WireMoneyCents }[];
  transactions: { id: string; type: string; amountCents: WireMoneyCents; currency: string; createdAt: string }[];
};

export default function SellerEarningsPage() {
  return (
    <RequireAuth>
      <SellerEarningsContent />
    </RequireAuth>
  );
}

function SellerEarningsContent() {
  const money = useMoney();
  const { t } = useI18n();
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<WalletResponse>("/users/me/wallet")
  });

  const wallets = wallet.data?.wallets ?? (wallet.data?.wallet ? [wallet.data.wallet] : []);
  const releaseTx = wallet.data?.transactions.filter((tx) => tx.type === "escrow_release") ?? [];
  const gross = formatCurrencyTotals(
    sumMoneyCentsByCurrency(releaseTx.map((tx) => ({ currency: tx.currency, cents: tx.amountCents }))),
    money
  );

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="interactive-card p-5">
          <p className="text-sm text-muted">{t("seller.available")}</p>
          <p className="mt-2 text-2xl font-bold">{formatWalletTotals(wallets, "availableCents", money)}</p>
        </div>
        <div className="interactive-card p-5">
          <p className="text-sm text-muted">{t("seller.inEscrow")}</p>
          <p className="mt-2 text-2xl font-bold">{formatWalletTotals(wallets, "escrowCents", money)}</p>
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

function formatWalletTotals(wallets: NonNullable<WalletResponse["wallets"]>, field: "availableCents" | "escrowCents", money: MoneyFormatter) {
  const totals = sumMoneyCentsByCurrency(wallets.map((item) => ({ currency: item.currency, cents: item[field] })));
  return formatCurrencyTotals(totals, money);
}

function formatCurrencyTotals(totals: Map<string, bigint>, money: MoneyFormatter) {
  const rows = Array.from(totals).filter(([, amount]) => amount !== 0n);
  if (!rows.length) return money(0, "UAH", { preserveCurrency: true });
  return rows.map(([currency, amount]) => money(amount, currency, { preserveCurrency: true })).join(" / ");
}
