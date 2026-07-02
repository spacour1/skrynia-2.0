"use client";

import Link from "@/lib/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Headphones,
  MessageCircle,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  UserRound,
  WalletCards
} from "lucide-react";
import { apiFetch, money, type Order } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { StatusBadge } from "@/components/StatusBadge";
import { RequireAuth } from "@/components/RequireAuth";

type WalletResponse = {
  wallet: {
    currency: string;
    availableCents: number;
    escrowCents: number;
  };
};

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

function DashboardContent() {
  const user = useAuth((state) => state.user);
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiFetch<{ orders: Order[] }>("/orders"),
    enabled: Boolean(user)
  });
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<WalletResponse>("/users/me/wallet"),
    enabled: Boolean(user)
  });

  if (!user) return null;

  const allOrders = orders.data?.orders ?? [];
  const activeOrders = allOrders.filter((order) => !["completed", "refunded"].includes(order.status));
  const buying = allOrders.filter((order) => order.buyerId === user.id || order.buyer_id === user.id);
  const selling = allOrders.filter((order) => order.sellerId === user.id || order.seller_id === user.id);
  const completed = allOrders.filter((order) => order.status === "completed").length;
  const pending = allOrders.filter((order) => order.status === "pending").length;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <section className="app-card overflow-hidden">
        <div className="bg-panel/70 p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-3xl bg-brand/10 text-3xl font-black text-brand shadow-soft">
                {user.avatarUrl ? <img className="h-full w-full object-cover" src={user.avatarUrl} alt={user.displayName} /> : user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <p className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1 text-xs font-bold text-brand">
                  <Sparkles className="h-3.5 w-3.5" />
                  {roleLabel(user.role)}
                </p>
                <h1 className="mt-3 text-3xl font-black text-ink">Привет, {user.displayName}</h1>
                <p className="mt-2 text-sm text-muted">{user.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {user.role === "admin" || user.role === "moderator" ? (
                <Link className="app-button" href="/admin">
                  Админ-панель
                </Link>
              ) : null}
              <button className="app-button-secondary" onClick={() => window.open("https://t.me/skrynia_support", "_blank", "noopener,noreferrer")}>
                <Headphones className="h-4 w-4" />
                Telegram поддержка
              </button>
            </div>
          </div>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={WalletCards} label="Доступно" value={money(wallet.data?.wallet.availableCents ?? 0, wallet.data?.wallet.currency ?? "UAH")} />
          <Stat icon={ShieldCheck} label="В escrow" value={money(wallet.data?.wallet.escrowCents ?? 0, wallet.data?.wallet.currency ?? "UAH")} />
          <Stat icon={PackageCheck} label="Завершено" value={completed} />
          <Stat icon={ReceiptText} label="Ожидает действий" value={pending} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <QuickLink icon={WalletCards} href="/wallet" title="Кошелек" text="Баланс, escrow и история операций" />
        <QuickLink icon={ShoppingBag} href="/orders" title="Мои заказы" text={`${buying.length} покупок / ${selling.length} продаж`} />
        <QuickLink icon={MessageCircle} href="/messages" title="Чаты" text="Переписка по сделкам" />
        <QuickLink icon={Store} href="/seller/products" title="Кабинет продавца" text="Лоты, цены и наличие" />
        <QuickLink icon={UserRound} href="/settings" title="Профиль" text="Аватар и настройки" />
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-panel/50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-ink">Активные заказы</h2>
            <p className="mt-1 text-sm text-muted">Сделки, где есть ожидание оплаты, работа, доставка или спор.</p>
          </div>
          <Link className="app-button-secondary" href="/orders">
            Все заказы
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="p-5">
          {orders.isLoading ? <p className="text-sm text-muted">Загружаем заказы...</p> : null}
          <div className="grid gap-3">
            {activeOrders.slice(0, 8).map((order) => (
              <OrderRow key={order.id} order={order} userId={user.id} />
            ))}
          </div>
          {!orders.isLoading && !activeOrders.length ? (
            <div className="grid min-h-[180px] place-items-center rounded-lg border border-dashed border-line bg-panel/25 p-8 text-center">
              <div>
                <ShoppingBag className="mx-auto h-9 w-9 text-muted" />
                <p className="mt-3 font-black text-ink">Активных заказов пока нет</p>
                <p className="mt-1 text-sm text-muted">Когда появится покупка, продажа или чат по лоту, он будет здесь.</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function OrderRow({ order, userId }: { order: Order; userId: string }) {
  const isBuyer = order.buyerId === userId || order.buyer_id === userId;
  const partner = isBuyer ? order.sellerDisplayName : order.buyerDisplayName;
  const amount = money(order.amountCents ?? order.amount_cents, order.currency);
  const productTitle = order.productTitle ?? order.product_title ?? "Заказ";

  return (
    <article className="rounded-lg border border-line bg-surface/60 p-4 transition hover:border-brand/50 hover:bg-panel/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />
            <span className="rounded-full bg-card px-2.5 py-1 text-xs font-bold text-muted">{isBuyer ? "Покупка" : "Продажа"}</span>
            <span className="text-xs text-muted">#{order.id.slice(0, 8)}</span>
          </div>
          <h3 className="mt-3 truncate text-base font-black text-ink">{productTitle}</h3>
          <p className="mt-1 text-sm text-muted">
            {partner ? `${isBuyer ? "Продавец" : "Покупатель"}: ${partner}` : "Контрагент не указан"} · Кол-во: {order.quantity}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[140px_1fr] lg:min-w-[360px]">
          <div className="rounded-lg border border-line bg-card p-3">
            <p className="text-xs text-muted">Сумма</p>
            <p className="mt-1 font-black text-ink">{amount}</p>
          </div>
          <div className="flex gap-2">
            <Link className="app-button-secondary flex-1 px-3" href={`/messages`}>
              <MessageCircle className="h-4 w-4" />
              Чат
            </Link>
            <Link className="app-button flex-1 px-3" href={`/orders/${order.id}`}>
              Открыть
            </Link>
          </div>
        </div>
      </div>
      <OrderHint status={order.status} isBuyer={isBuyer} />
    </article>
  );
}

function OrderHint({ status, isBuyer }: { status: string; isBuyer: boolean }) {
  const text =
    status === "pending"
      ? isBuyer
        ? "Ожидает оплаты. Можно открыть заказ, оплатить или продолжить переписку."
        : "Покупатель ещё не оплатил. Пока можно уточнить детали в чате."
      : status === "paid"
        ? isBuyer
          ? "Оплата в escrow. Продавец должен начать выполнение."
          : "Оплата получена в escrow. Пора начать работу."
        : status === "in_progress"
          ? "Заказ в работе. Держите договорённости в чате."
          : status === "delivered"
            ? isBuyer
              ? "Продавец отметил доставку. Проверьте результат и подтвердите."
              : "Ожидаем подтверждение покупателя."
            : status === "disputed"
              ? "Открыт спор. Администратор сможет принять решение."
              : "";

  if (!text) return null;
  return <p className="mt-3 rounded-lg bg-panel/45 px-3 py-2 text-sm leading-6 text-muted">{text}</p>;
}

function roleLabel(role: string) {
  if (role === "admin") return "Администратор";
  if (role === "moderator") return "Модератор";
  return "Пользователь";
}

function Stat({ icon: Icon, label, value }: { icon: typeof WalletCards; label: string; value: string | number }) {
  return (
    <article className="rounded-lg border border-line bg-card p-4">
      <Icon className="h-5 w-5 text-brand" />
      <p className="mt-3 text-sm text-muted">{label}</p>
      <p className="mt-1 text-xl font-black text-ink">{value}</p>
    </article>
  );
}

function QuickLink({ icon: Icon, href, title, text }: { icon: typeof WalletCards; href: string; title: string; text: string }) {
  return (
    <Link className="interactive-card p-4" href={href}>
      <Icon className="h-6 w-6 text-brand" />
      <p className="mt-3 font-black text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </Link>
  );
}
