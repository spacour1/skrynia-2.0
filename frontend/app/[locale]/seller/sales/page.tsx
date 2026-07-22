"use client";

import Link from "@/lib/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronRight, Clock3, MessageCircle, PackageCheck, Search, Store } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch, money, type Order } from "@/lib/api";

const statusFilters = [
  ["all", "Все"],
  ["active", "Активные"],
  ["pending", "Ожидают"],
  ["paid", "Оплачены"],
  ["in_progress", "В работе"],
  ["delivered", "Доставлены"],
  ["completed", "Завершены"]
];

export default function SellerSalesPage() {
  return (
    <RequireAuth>
      <SellerSalesContent />
    </RequireAuth>
  );
}

function SellerSalesContent() {
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const sales = useQuery({
    queryKey: ["seller-sales"],
    queryFn: () => apiFetch<{ orders: Order[] }>("/orders?role=seller")
  });

  const orders = sales.data?.orders ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.filter((order) => {
      const active = !["completed", "refunded"].includes(order.status);
      const matchesStatus = status === "all" || (status === "active" ? active : order.status === status);
      const title = (order.productTitle ?? "").toLowerCase();
      return matchesStatus && (!needle || title.includes(needle) || order.id.toLowerCase().includes(needle));
    });
  }, [orders, q, status]);

  const activeCount = orders.filter((order) => !["completed", "refunded"].includes(order.status)).length;
  const completedCount = orders.filter((order) => order.status === "completed").length;
  const totalAmount = orders.reduce((sum, order) => sum + Number(order.amountCents ?? 0), 0);
  const currency = orders[0]?.currency ?? "UAH";

  return (
    <div className="mx-auto max-w-[1360px] space-y-5">
      <section className="app-card overflow-hidden">
        <div className="grid gap-5 border-b border-line bg-panel/55 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="inline-flex rounded-full bg-card px-3 py-1 text-xs font-black uppercase text-brand">Кабинет продавца</p>
            <h1 className="mt-3 text-3xl font-black text-ink">Мои продажи</h1>
            <p className="mt-2 text-sm text-muted">Список всех заказов, где вы продавец: статусы, покупатели, суммы и быстрый переход в чат.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:min-w-[500px]">
            <Summary icon={Store} label="Всего" value={String(orders.length)} />
            <Summary icon={Clock3} label="Активные" value={String(activeCount)} />
            <Summary icon={BarChart3} label="Оборот" value={money(totalAmount, currency)} />
          </div>
        </div>

        <div className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="app-input h-11 w-full pl-10" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Поиск по товару или номеру заказа" />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {statusFilters.map(([value, label]) => (
              <button
                key={value}
                className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                  status === value ? "border-brand/70 bg-brand/10 text-brand" : "border-line bg-card text-muted hover:border-brand/60 hover:bg-panel hover:text-ink"
                }`}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {sales.isLoading ? <section className="app-card p-8 text-center text-muted">Загружаем продажи...</section> : null}
      {!sales.isLoading && !filtered.length ? (
        <section className="app-card grid min-h-[260px] place-items-center p-8 text-center">
          <div>
            <PackageCheck className="mx-auto h-11 w-11 text-muted" />
            <h2 className="mt-4 text-xl font-black text-ink">Продаж пока нет</h2>
            <p className="mt-2 text-sm text-muted">Когда покупатели оформят заказ, он появится в этом списке.</p>
            <Link className="app-button mt-5" href="/seller/products">Создать лот</Link>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        {filtered.map((order) => (
          <article key={order.id} className="app-card overflow-hidden transition hover:border-brand/60 hover:shadow-lift">
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={order.status} />
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs font-bold text-muted">#{order.id.slice(0, 8)}</span>
                </div>
                <Link className="mt-3 block truncate text-base font-black text-ink hover:text-brand" href={`/orders/${order.id}`}>
                  {order.productTitle ?? "Заказ"}
                </Link>
                <p className="mt-1 text-xs text-muted">Покупатель: {order.buyerDisplayName ?? "Покупатель"}</p>
              </div>

              <div className="rounded-lg border border-line bg-panel/35 p-3">
                <p className="text-xs font-bold uppercase text-muted">Дата</p>
                <p className="mt-1 text-sm font-bold">{formatDate(order.createdAt)}</p>
              </div>

              <div className="rounded-lg border border-brand/25 bg-brand/10 p-3 lg:text-right">
                <p className="text-xs font-bold uppercase text-muted">Сумма</p>
                <p className="mt-1 text-lg font-black text-brand">{money(order.amountCents ?? 0, order.currency)}</p>
              </div>

              <div className="flex gap-2 lg:justify-end">
                <Link className="app-button-secondary h-10 px-3" href={`/messages?order=${order.id}`} aria-label="Открыть чат">
                  <MessageCircle className="h-4 w-4" />
                </Link>
                <Link className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-card text-muted transition hover:border-brand/60 hover:text-brand" href={`/orders/${order.id}`} aria-label="Открыть заказ">
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function Summary({ icon: Icon, label, value }: { icon: typeof Store; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-card/70 p-3">
      <Icon className="h-4 w-4 text-brand" />
      <p className="mt-2 text-xs font-bold uppercase text-muted">{label}</p>
      <p className="mt-1 truncate font-black text-ink">{value}</p>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
