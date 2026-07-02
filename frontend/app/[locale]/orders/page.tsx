"use client";

import Link from "@/lib/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock3, type LucideIcon, PackageCheck, Search, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";
import { apiFetch, money, type Order } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";

const filters = [
  { value: "all", label: "common.all" },
  { value: "active", label: "orders.filterActive" },
  { value: "pending", label: "orders.filterPending" },
  { value: "in_progress", label: "orders.filterInProgress" },
  { value: "delivered", label: "orders.filterDelivered" },
  { value: "completed", label: "orders.filterCompleted" }
];

export default function OrdersPage() {
  return (
    <RequireAuth>
      <OrdersContent />
    </RequireAuth>
  );
}

function OrdersContent() {
  const { t } = useI18n();
  const user = useAuth((state) => state.user);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiFetch<{ orders: Order[] }>("/orders")
  });

  const list = orders.data?.orders ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((order) => {
      const active = !["completed", "refunded"].includes(order.status);
      const matchesStatus = status === "all" || (status === "active" ? active : order.status === status);
      const title = (order.productTitle ?? order.product_title ?? "").toLowerCase();
      const matchesSearch = !needle || title.includes(needle) || order.id.toLowerCase().includes(needle);
      return matchesStatus && matchesSearch;
    });
  }, [list, q, status]);

  const activeCount = list.filter((order) => !["completed", "refunded"].includes(order.status)).length;
  const completedCount = list.filter((order) => order.status === "completed").length;
  const totalAmount = list.reduce((sum, order) => sum + Number(order.amountCents ?? order.amount_cents ?? 0), 0);
  const currency = list[0]?.currency ?? "UAH";

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <section className="app-card overflow-hidden">
        <div className="grid gap-5 border-b border-line bg-panel/45 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="inline-flex rounded-full bg-card px-3 py-1 text-xs font-black uppercase text-brand">{t("orders.dealCenter")}</p>
            <h1 className="mt-3 text-2xl font-black text-ink">{t("orders.title")}</h1>
            <p className="mt-2 text-sm text-muted">{t("orders.subtitle")}</p>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:min-w-[520px]">
            <SummaryTile icon={PackageCheck} label={t("orders.totalLabel")} value={String(list.length)} />
            <SummaryTile icon={Clock3} label={t("orders.activeLabel")} value={String(activeCount)} />
            <SummaryTile icon={ShieldCheck} label={t("orders.turnoverLabel")} value={money(totalAmount, currency)} />
          </div>
        </div>

        <div className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="app-input h-11 w-full pl-10"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t("orders.searchPlaceholder")}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {filters.map((item) => (
              <button
                key={item.value}
                className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                  status === item.value ? "border-brand/70 bg-brand/10 text-brand" : "border-line bg-card text-muted hover:border-brand/60 hover:bg-panel hover:text-ink"
                }`}
                onClick={() => setStatus(item.value)}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        {orders.isLoading ? <div className="app-card p-8 text-center text-muted">{t("orders.loadingOrders")}</div> : null}
        {!orders.isLoading && !filtered.length ? (
          <div className="app-card grid min-h-[240px] place-items-center p-8 text-center">
            <div>
              <ShoppingBag className="mx-auto h-10 w-10 text-muted" />
              <h2 className="mt-4 text-xl font-black text-ink">{t("orders.noneFoundTitle")}</h2>
              <p className="mt-2 text-sm text-muted">{t("orders.noneFoundText")}</p>
            </div>
          </div>
        ) : null}
        {filtered.map((order) => (
          <OrderCard key={order.id} order={order} currentUserId={user?.id} />
        ))}
      </section>
    </div>
  );
}

function OrderCard({ order, currentUserId }: { order: Order; currentUserId?: string }) {
  const { language, t } = useI18n();
  const title = order.productTitle ?? order.product_title ?? t("common.order");
  const amount = order.amountCents ?? order.amount_cents;
  const buyerId = order.buyerId ?? order.buyer_id;
  const sellerId = order.sellerId ?? order.seller_id;
  const role = currentUserId === buyerId ? t("orders.purchase") : currentUserId === sellerId ? t("orders.sale") : t("orders.deal");

  return (
    <Link href={`/orders/${order.id}`} className="app-card block overflow-hidden transition hover:border-brand/60 hover:shadow-lift">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_170px_180px_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />
            <span className="rounded-full bg-panel px-2.5 py-1 text-xs font-bold text-muted">{role}</span>
            <span className="rounded-full bg-panel px-2.5 py-1 text-xs font-bold text-muted">#{order.id.slice(0, 8)}</span>
          </div>
          <p className="mt-3 truncate text-base font-black text-ink">{title}</p>
          <p className="mt-1 text-xs text-muted">{t("orders.createdAt", { date: formatDate(order.createdAt, language, t) })}</p>
        </div>

        <div className="rounded-lg border border-line bg-panel/35 p-3">
          <p className="text-xs font-bold uppercase text-muted">{t("orders.participants")}</p>
          <div className="mt-2 space-y-1 text-sm">
            <p className="flex items-center gap-2 truncate">
              <UserRound className="h-3.5 w-3.5 text-brand" />
              {order.buyerDisplayName ?? t("common.buyer")}
            </p>
            <p className="flex items-center gap-2 truncate">
              <UserRound className="h-3.5 w-3.5 text-action" />
              {order.sellerDisplayName ?? t("common.seller")}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-brand/25 bg-brand/10 p-3 lg:text-right">
          <p className="text-xs font-bold uppercase text-muted">{t("common.amount")}</p>
          <p className="mt-1 text-lg font-black text-brand">{money(amount, order.currency)}</p>
          <p className="mt-1 text-xs text-muted">{order.quantity} {t("product.unitsShort")}</p>
        </div>

        <span className="hidden h-10 w-10 place-items-center rounded-lg border border-line bg-card text-muted lg:grid">
          <ChevronRight className="h-5 w-5" />
        </span>
      </div>
    </Link>
  );
}

function SummaryTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-card/70 p-3">
      <Icon className="h-4 w-4 text-brand" />
      <p className="mt-2 text-xs font-bold uppercase text-muted">{label}</p>
      <p className="mt-1 truncate font-black text-ink">{value}</p>
    </div>
  );
}

function formatDate(value: string | undefined, language: string, t: (key: string) => string) {
  if (!value) return t("orders.notSpecified");
  return new Date(value).toLocaleString(language, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
