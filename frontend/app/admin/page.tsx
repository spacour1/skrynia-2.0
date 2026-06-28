"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Banknote, Flag, Headphones, ImageIcon, ListChecks, ShieldCheck, Users, WalletCards } from "lucide-react";
import { apiFetch, money } from "../../lib/api";
import { StatusBadge } from "../../components/StatusBadge";
import { RequireAuth } from "../../components/RequireAuth";

type Overview = {
  users: number;
  products: number;
  openDisputes: number;
  ordersByStatus: { status: string; count: number }[];
  revenue: { currency: string; revenueCents: number }[];
};

type Listing = {
  id: string;
  title: string;
  status: string;
  priceCents: number;
  currency: string;
  categoryName: string;
  sellerDisplayName: string;
};

type Transaction = {
  id: string;
  type: string;
  direction: string;
  amountCents: number;
  currency: string;
  displayName?: string;
  orderId?: string;
  createdAt: string;
};

export default function AdminPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminContent />
    </RequireAuth>
  );
}

function AdminContent() {
  const client = useQueryClient();
  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => apiFetch<Overview>("/admin/overview")
  });
  const listings = useQuery({
    queryKey: ["admin-listings"],
    queryFn: () => apiFetch<{ listings: Listing[] }>("/admin/listings")
  });
  const transactions = useQuery({
    queryKey: ["admin-transactions"],
    queryFn: () => apiFetch<{ transactions: Transaction[] }>("/admin/transactions")
  });
  const moderate = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/admin/listings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-listings"] })
  });

  return (
    <div className="space-y-6">
      <section className="app-card overflow-hidden">
        <div className="flex flex-col gap-5 bg-panel/70 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-20 w-20 place-items-center rounded-3xl bg-brand/10 text-brand shadow-soft">
              <ShieldCheck className="h-9 w-9" />
            </span>
            <div>
              <p className="rounded-full bg-card px-3 py-1 text-xs font-bold text-brand">Администратор SKRYNIA</p>
              <h1 className="mt-3 text-3xl font-extrabold">Панель управления</h1>
              <p className="mt-2 text-sm text-muted">Модерация, споры, пользователи и финансовый журнал.</p>
            </div>
          </div>
          <button className="app-button-secondary" onClick={() => window.open("https://t.me/skrynia_support", "_blank", "noopener,noreferrer")}>
            <Headphones className="h-4 w-4" />
            Telegram поддержка
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <AdminMetric href="/admin/users" icon={Users} label="Пользователи" value={overview.data?.users ?? 0} />
        <AdminMetric icon={ListChecks} label="Активные товары" value={overview.data?.products ?? 0} />
        <AdminMetric href="/admin/disputes" icon={AlertTriangle} label="Открытые споры" value={overview.data?.openDisputes ?? 0} danger />
        <AdminMetric icon={WalletCards} label="Доход платформы" value={overview.data?.revenue.map((item) => money(item.revenueCents, item.currency)).join(" / ") || "0"} />
      </section>

      <Link className="interactive-card flex items-center gap-4 p-5" href="/admin/support">
        <Headphones className="h-6 w-6 text-brand" />
        <div>
          <p className="font-bold">Обращения пользователей</p>
          <p className="text-sm text-muted">Тикеты поддержки и SLA модерации</p>
        </div>
      </Link>

      <Link className="interactive-card flex items-center gap-4 p-5" href="/admin/ops">
        <Activity className="h-6 w-6 text-brand" />
        <div>
          <p className="font-bold">Центр операций</p>
          <p className="text-sm text-muted">Журнал аудита, очереди, сверка, метрики</p>
        </div>
      </Link>

      <Link className="interactive-card flex items-center gap-4 p-5" href="/admin/finance">
        <Banknote className="h-6 w-6 text-brand" />
        <div>
          <p className="font-bold">Финансовый контроль</p>
          <p className="text-sm text-muted">Главная книга, эскроу, сверка, журнал транзакций</p>
        </div>
      </Link>

      <Link className="interactive-card flex items-center gap-4 p-5" href="/admin/payouts">
        <WalletCards className="h-6 w-6 text-brand" />
        <div>
          <p className="font-bold">Выплаты продавцам</p>
          <p className="text-sm text-muted">Подтверждение и отклонение заявок на вывод средств</p>
        </div>
      </Link>

      <Link className="interactive-card flex items-center gap-4 p-5" href="/admin/media">
        <ImageIcon className="h-6 w-6 text-brand" />
        <div>
          <p className="font-bold">Модерация изображений</p>
          <p className="text-sm text-muted">Проверка медиа товаров, скрытие нарушающих контент</p>
        </div>
      </Link>

      <Link className="interactive-card flex items-center gap-4 p-5" href="/admin/reports">
        <Flag className="h-6 w-6 text-brand" />
        <div>
          <p className="font-bold">Жалобы и модерация</p>
          <p className="text-sm text-muted">Жалобы на пользователей и сообщения, скрытие сообщений</p>
        </div>
      </Link>

      <section className="app-card p-5">
        <h2 className="text-xl font-extrabold">Последние транзакции</h2>
        <div className="table-shell mt-4 overflow-x-auto shadow-none">
          <table className="min-w-[760px]">
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Тип</th>
                <th>Направление</th>
                <th className="text-right">Сумма</th>
                <th className="text-right">Создано</th>
              </tr>
            </thead>
            <tbody>
              {transactions.data?.transactions.slice(0, 12).map((tx) => (
                <tr key={tx.id} className="border-b border-line transition last:border-b-0 hover:bg-panel/60">
                  <td>{tx.displayName ?? "-"}</td>
                  <td>{tx.type.replace("_", " ")}</td>
                  <td>{tx.direction}</td>
                  <td className="text-right">{money(Number(tx.amountCents), tx.currency)}</td>
                  <td className="text-right">{new Date(tx.createdAt).toLocaleString("ru-RU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-card p-5">
        <h2 className="text-xl font-extrabold">Модерация товаров</h2>
        <div className="mt-4 space-y-3">
          {listings.data?.listings.map((listing) => (
            <article key={listing.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 p-4">
              <div>
                <p className="font-semibold">{listing.title}</p>
                <p className="text-sm text-muted">
                  {listing.sellerDisplayName} · {listing.categoryName} · {money(Number(listing.priceCents), listing.currency)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={listing.status} />
                <button className="rounded-md border border-line px-3 py-1 text-sm transition hover:bg-panel" onClick={() => moderate.mutate({ id: listing.id, status: "active" })}>
                  Разрешить
                </button>
                <button className="rounded-md border border-line px-3 py-1 text-sm transition hover:bg-panel" onClick={() => moderate.mutate({ id: listing.id, status: "blocked" })}>
                  Блокировать
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminMetric({
  href,
  icon: Icon,
  label,
  value,
  danger
}: {
  href?: string;
  icon: typeof Users;
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  const body = (
    <>
      <Icon className={`h-6 w-6 ${danger ? "text-rose-500" : "text-brand"}`} />
      <p className="mt-3 text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </>
  );
  return href ? <Link className="interactive-card p-5" href={href}>{body}</Link> : <div className="app-card p-5">{body}</div>;
}
