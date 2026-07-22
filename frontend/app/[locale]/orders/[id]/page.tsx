"use client";

import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  FlaskConical,
  Hash,
  type LucideIcon,
  PackageCheck,
  Send,
  ShieldCheck,
  Star,
  Truck,
  UserRound,
  XCircle
} from "lucide-react";
import { apiFetch, money, type Order } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { StatusBadge } from "@/components/StatusBadge";
import { useI18n } from "@/lib/i18n";
import { showAppToast } from "@/lib/toast-events";
import { redirectToLiqpay, type LiqpayCheckout } from "@/lib/liqpay";
import { redirectToMonobank, type MonobankCheckout } from "@/lib/monobank";
import { ManualPaymentPanel } from "@/components/ManualPaymentPanel";
import { redirectToWayforpay, type WayforpayCheckout } from "@/lib/wayforpay";
import { captureEvent } from "@/lib/posthog";

// Mirrors the backend's NODE_ENV/ENABLE_TEST_PAYMENTS gate: hidden by default on a
// production build (Vercel always builds with NODE_ENV=production) unless the deployment
// opts in via NEXT_PUBLIC_ENABLE_TEST_PAYMENTS, same as the backend's ENABLE_TEST_PAYMENTS.
const SHOW_TEST_PAYMENTS_PANEL =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_TEST_PAYMENTS === "true";

const statusSteps = [
  { key: "pending", label: "Создан", text: "Заказ ожидает оплаты или подтверждения." },
  { key: "paid", label: "Оплачен", text: "Средства зарезервированы в escrow." },
  { key: "in_progress", label: "В работе", text: "Продавец выполняет заказ." },
  { key: "delivered", label: "Доставлен", text: "Покупатель проверяет результат." },
  { key: "completed", label: "Завершен", text: "Сделка закрыта, средства выплачены." }
];

type OrderEvent = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  actorDisplayName?: string | null;
  createdAt: string;
};

type OrderDetailResponse = {
  order: Order;
  events: OrderEvent[];
};

export default function OrderPage({ params }: { params: { id: string } }) {
  const user = useAuth((state) => state.user);
  const { t } = useI18n();
  const client = useQueryClient();
  const searchParams = useSearchParams();
  const [deliveryNote, setDeliveryNote] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [showManualPayment, setShowManualPayment] = useState(false);

  const order = useQuery({
    queryKey: ["order", params.id],
    queryFn: () => apiFetch<OrderDetailResponse>(`/orders/${params.id}`)
  });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["order", params.id] });
    client.invalidateQueries({ queryKey: ["orders"] });
  };

  const postAction = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
    onSuccess: refresh
  });

  const payWithLiqpay = useMutation({
    mutationFn: () => {
      captureEvent("payment_started", { order_id: params.id, provider: "liqpay" });
      return apiFetch<LiqpayCheckout>(`/payments/orders/${params.id}/liqpay/checkout`, { method: "POST" });
    },
    onSuccess: redirectToLiqpay
  });

  const payWithMonobank = useMutation({
    mutationFn: () => {
      captureEvent("payment_started", { order_id: params.id, provider: "monobank" });
      return apiFetch<MonobankCheckout>(`/payments/orders/${params.id}/monobank/checkout`, { method: "POST" });
    },
    onSuccess: redirectToMonobank
  });

  const payWithWayforpay = useMutation({
    mutationFn: () => {
      captureEvent("payment_started", { order_id: params.id, provider: "wayforpay" });
      return apiFetch<WayforpayCheckout>(`/payments/orders/${params.id}/wayforpay/checkout`, { method: "POST" });
    },
    onSuccess: redirectToWayforpay
  });

  const testSuccess = useMutation({
    mutationFn: () => apiFetch(`/payments/test/orders/${params.id}/success`, { method: "POST" }),
    onSuccess: refresh
  });
  const testFailure = useMutation({
    mutationFn: () => apiFetch(`/payments/test/orders/${params.id}/failure`, { method: "POST" }),
    onSuccess: refresh
  });
  const testWaitAccept = useMutation({
    mutationFn: () => apiFetch(`/payments/test/orders/${params.id}/wait-accept`, { method: "POST" }),
    onSuccess: () => showAppToast({ title: "Платеж в обработке", body: "Ожидаем подтверждения от платежной системы." })
  });

  // The buyer lands back here right after the checkout page; the provider's own
  // server-to-server webhook is what actually confirms payment, so poll briefly in case
  // it hasn't landed yet when this page re-mounts.
  const returningFromCheckout =
    searchParams.get("liqpay") === "return" ||
    searchParams.get("monobank") === "return" ||
    searchParams.get("wayforpay") === "return";
  const pollAttempts = useRef(0);
  useEffect(() => {
    if (!returningFromCheckout) return;
    const timer = window.setInterval(() => {
      pollAttempts.current += 1;
      refresh();
      if (pollAttempts.current >= 5) window.clearInterval(timer);
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returningFromCheckout]);

  if (order.isLoading) return <p className="text-muted">{t("orders.loadingOrder")}</p>;
  if (!order.data) return <p className="text-rose-600">{t("orders.notFound")}</p>;

  const item = order.data.order;
  const events = order.data.events ?? [];
  const buyerId = item.buyerId;
  const sellerId = item.sellerId;
  const amount = item.amountCents ?? 0;
  const fee = item.feeCents ?? 0;
  const isBuyer = user?.id === buyerId;
  const isSeller = user?.id === sellerId;
  const productTitle = item.productTitle ?? "Заказ";
  const activeStep = Math.max(0, statusSteps.findIndex((step) => step.key === item.status));
  const canDispute = ["paid", "in_progress", "delivered"].includes(item.status);

  const roleLabel = isBuyer ? "Вы покупатель" : isSeller ? "Вы продавец" : "Участник сделки";
  const nextHint = getNextHint(item.status, isBuyer, isSeller);

  function deliver(event: FormEvent) {
    event.preventDefault();
    postAction.mutate({ path: `/orders/${params.id}/deliver`, body: { deliveryNote } });
  }

  function dispute(event: FormEvent) {
    event.preventDefault();
    postAction.mutate({ path: `/disputes/orders/${params.id}/dispute`, body: { reason: disputeReason } });
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    postAction.mutate({
      path: `/orders/${params.id}/review`,
      body: { rating: Number(form.get("rating")), comment: reviewComment }
    });
  }

  return (
    <div className="mx-auto max-w-[1040px] space-y-5">
        <section className="app-card overflow-hidden">
          <div className="grid gap-5 border-b border-line bg-panel/45 p-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={item.status} />
                <span className="rounded-full bg-card px-3 py-1 text-xs font-bold text-muted">{roleLabel}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1 text-xs font-bold text-muted">
                  <Hash className="h-3.5 w-3.5" />
                  {item.id.slice(0, 8)}
                </span>
              </div>
              <h1 className="mt-3 truncate text-2xl font-black text-ink">{productTitle}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{nextHint}</p>
            </div>
            <div className="rounded-lg border border-brand/25 bg-brand/10 px-5 py-4 text-left lg:min-w-[220px] lg:text-right">
              <p className="text-xs font-black uppercase text-muted">Сумма сделки</p>
              <p className="mt-1 text-2xl font-black text-brand">{money(amount, item.currency)}</p>
              <p className="mt-1 text-xs text-muted">Escrow удерживает оплату до завершения</p>
            </div>
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <InfoTile icon={PackageCheck} label="Товар" value={productTitle} />
            <InfoTile icon={Truck} label="Количество" value={`${item.quantity} шт.`} />
            <InfoTile icon={UserRound} label="Покупатель" value={item.buyerDisplayName ?? "Покупатель"} />
            <InfoTile icon={UserRound} label="Продавец" value={item.sellerDisplayName ?? "Продавец"} />
            <InfoTile icon={CreditCard} label="Комиссия" value={money(fee, item.currency)} />
            <InfoTile icon={Clock3} label="Создан" value={formatDate(item.createdAt)} />
            <InfoTile icon={ShieldCheck} label="Защита" value="Escrow активен" />
          </div>
        </section>

        <section className="app-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-ink">Ход сделки</h2>
              <p className="mt-1 text-sm text-muted">Коротко показывает, что уже произошло и какой следующий шаг.</p>
            </div>
            {item.autoReleaseAt ? (
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-300">
                Автовыплата: {formatDate(item.autoReleaseAt)}
              </span>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-5">
            {statusSteps.map((step, index) => {
              const done = index <= activeStep || item.status === "completed";
              const current = step.key === item.status;
              return (
                <div key={step.key} className={`rounded-lg border p-3 ${done ? "border-brand/40 bg-brand/10" : "border-line bg-panel/30"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`grid h-7 w-7 place-items-center rounded-full ${done ? "bg-brand text-white dark:text-stone-950" : "bg-card text-muted"}`}>
                      {done ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                    </span>
                    <p className={`text-sm font-black ${current ? "text-brand" : "text-ink"}`}>{step.label}</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">{step.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="app-card p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand/10 text-brand">
              <Clock3 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-black text-ink">История сделки</h2>
              <p className="text-xs text-muted">Фактическая лента действий по заказу.</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {events.length ? (
              events.map((event, index) => (
                <div key={event.id} className="grid gap-3 rounded-lg border border-line bg-panel/35 p-4 sm:grid-cols-[34px_minmax(0,1fr)_150px]">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/10 text-brand">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-black text-ink">{event.title}</p>
                    {event.body ? <p className="mt-1 text-sm leading-6 text-muted">{event.body}</p> : null}
                    {event.actorDisplayName ? <p className="mt-2 text-xs text-muted">Участник: {event.actorDisplayName}</p> : null}
                  </div>
                  <p className="text-sm text-muted sm:text-right">{formatDate(event.createdAt)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-line bg-panel/35 p-4 text-sm leading-6 text-muted">
                Для старых заказов история может быть пустой. Новые действия будут появляться здесь автоматически.
              </div>
            )}
          </div>
        </section>

        {item.deliveryNote ? (
          <section className="app-card p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-black text-ink">{t("orders.deliveryNote")}</h2>
                <p className="text-xs text-muted">Данные, которые продавец передал по заказу.</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-line bg-panel/50 p-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{item.deliveryNote}</p>
            </div>
          </section>
        ) : null}

        <section className="app-card p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-action/15 text-action">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-black text-ink">{t("common.actions")}</h2>
              <p className="text-xs text-muted">Доступные действия зависят от роли и текущего статуса заказа.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {isBuyer && item.status === "pending" ? (
              <ActionCard title="Оплатить заказ" text="Деньги будут удержаны в escrow до подтверждения доставки.">
                <div className="grid gap-2">
                  <button className="app-button-action w-full" disabled={payWithLiqpay.isPending} onClick={() => payWithLiqpay.mutate()}>
                    <CreditCard className="h-4 w-4" />
                    {payWithLiqpay.isPending ? "Переходим к оплате..." : "Оплатить через LiqPay"}
                  </button>
                  <button className="app-button-action w-full" disabled={payWithMonobank.isPending} onClick={() => payWithMonobank.mutate()}>
                    <CreditCard className="h-4 w-4" />
                    {payWithMonobank.isPending ? "Переходим к оплате..." : "Оплатить через Monobank"}
                  </button>
                  <button className="app-button-action w-full" disabled={payWithWayforpay.isPending} onClick={() => payWithWayforpay.mutate()}>
                    <CreditCard className="h-4 w-4" />
                    {payWithWayforpay.isPending ? "Переходим к оплате..." : "Оплатить через WayForPay"}
                  </button>
                  <button className="app-button-secondary w-full" onClick={() => setShowManualPayment((value) => !value)}>
                    <CreditCard className="h-4 w-4" />
                    {showManualPayment ? "Скрыть реквизиты для перевода" : "Оплатить переводом"}
                  </button>
                </div>
                {payWithLiqpay.error ? <p className="mt-2 text-sm text-rose-600">{payWithLiqpay.error.message}</p> : null}
                {payWithMonobank.error ? <p className="mt-2 text-sm text-rose-600">{payWithMonobank.error.message}</p> : null}
                {payWithWayforpay.error ? <p className="mt-2 text-sm text-rose-600">{payWithWayforpay.error.message}</p> : null}
                {showManualPayment ? (
                  <div className="mt-3">
                    <ManualPaymentPanel orderId={params.id} />
                  </div>
                ) : null}
              </ActionCard>
            ) : null}

            {isBuyer && item.status === "pending" && SHOW_TEST_PAYMENTS_PANEL ? (
              <ActionCard title="Тестовая оплата (dev)" text="Эмулирует ответ платежной системы без реальных денег — только для разработки.">
                <div className="grid gap-2 sm:grid-cols-3">
                  <button className="app-button-action w-full" disabled={testSuccess.isPending} onClick={() => testSuccess.mutate()}>
                    <CheckCircle2 className="h-4 w-4" />
                    Success
                  </button>
                  <button className="app-button-danger w-full" disabled={testFailure.isPending} onClick={() => testFailure.mutate()}>
                    <XCircle className="h-4 w-4" />
                    Failure
                  </button>
                  <button className="app-button-secondary w-full" disabled={testWaitAccept.isPending} onClick={() => testWaitAccept.mutate()}>
                    <FlaskConical className="h-4 w-4" />
                    Wait accept
                  </button>
                </div>
                {testSuccess.error ? <p className="mt-2 text-sm text-rose-600">{testSuccess.error.message}</p> : null}
                {testFailure.error ? <p className="mt-2 text-sm text-rose-600">{testFailure.error.message}</p> : null}
                {testWaitAccept.error ? <p className="mt-2 text-sm text-rose-600">{testWaitAccept.error.message}</p> : null}
              </ActionCard>
            ) : null}

            {isSeller && item.status === "paid" ? (
              <ActionCard title="Начать выполнение" text="Покупатель увидит, что заказ принят в работу.">
                <button className="app-button-action w-full" disabled={postAction.isPending} onClick={() => postAction.mutate({ path: `/orders/${params.id}/start` })}>
                  {t("orders.startWork")}
                </button>
              </ActionCard>
            ) : null}

            {isSeller && ["paid", "in_progress"].includes(item.status) ? (
              <ActionCard title="Передать результат" text="Добавьте доступы, инструкцию или итог выполненной услуги.">
                <form className="space-y-2" onSubmit={deliver}>
                  <textarea
                    className="app-input h-24 w-full resize-none text-sm"
                    placeholder={t("orders.deliveryPlaceholder")}
                    value={deliveryNote}
                    onChange={(event) => setDeliveryNote(event.target.value)}
                  />
                  <button className="app-button w-full" disabled={postAction.isPending}>{t("orders.markDelivered")}</button>
                </form>
              </ActionCard>
            ) : null}

            {isBuyer && item.status === "delivered" ? (
              <ActionCard title="Проверить и завершить" text="Если все в порядке, подтвердите доставку. Деньги уйдут продавцу.">
                <button className="app-button w-full" disabled={postAction.isPending} onClick={() => postAction.mutate({ path: `/orders/${params.id}/confirm` })}>
                  {t("orders.confirm")}
                </button>
              </ActionCard>
            ) : null}

            {canDispute ? (
              <ActionCard title="Открыть спор" text="Используйте только если проблему не удалось решить в чате.">
                <form className="space-y-2" onSubmit={dispute}>
                  <textarea
                    className="app-input h-20 w-full resize-none text-sm"
                    placeholder={t("orders.disputePlaceholder")}
                    value={disputeReason}
                    onChange={(event) => setDisputeReason(event.target.value)}
                  />
                  <button className="app-button-danger w-full" disabled={postAction.isPending}>
                    <AlertTriangle className="h-4 w-4" />
                    {t("orders.openDispute")}
                  </button>
                </form>
              </ActionCard>
            ) : null}

            {isBuyer && item.status === "completed" ? (
              <ActionCard title="Оставить отзыв" text="Оценка помогает другим покупателям выбрать продавца.">
                <form className="space-y-2" onSubmit={review}>
                  <select className="app-input w-full" name="rating" defaultValue="5">
                    <option value="5">5 звезд</option>
                    <option value="4">4 звезды</option>
                    <option value="3">3 звезды</option>
                    <option value="2">2 звезды</option>
                    <option value="1">1 звезда</option>
                  </select>
                  <textarea
                    className="app-input h-20 w-full resize-none text-sm"
                    placeholder={t("orders.reviewPlaceholder")}
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                  />
                  <button className="app-button w-full" disabled={postAction.isPending}>
                    <Star className="h-4 w-4" />
                    {t("orders.submitReview")}
                  </button>
                </form>
              </ActionCard>
            ) : null}

            {!isSeller && !isBuyer ? (
              <p className="rounded-lg border border-line bg-panel/40 p-4 text-sm text-muted">Вы просматриваете заказ без доступных действий.</p>
            ) : null}
            {postAction.error ? <p className="text-sm text-rose-600">{postAction.error.message}</p> : null}
          </div>
        </section>
    </div>
  );
}

function InfoTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-card/70 p-3">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="h-4 w-4 text-brand" />
        <p className="text-xs font-bold uppercase">{label}</p>
      </div>
      <p className="mt-2 truncate text-sm font-black text-ink">{value}</p>
    </div>
  );
}

function ActionCard({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel/35 p-4">
      <div className="mb-3">
        <p className="font-black text-ink">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{text}</p>
      </div>
      {children}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "Не указано";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getNextHint(status: string, isBuyer: boolean, isSeller: boolean) {
  if (status === "pending") return "Заказ создан. После оплаты средства будут удержаны в escrow до завершения сделки.";
  if (status === "paid" && isSeller) return "Покупатель оплатил заказ. Начните выполнение и держите покупателя в курсе через чат.";
  if (status === "paid") return "Оплата зарезервирована. Дождитесь, пока продавец начнет выполнение заказа.";
  if (status === "in_progress") return "Заказ находится в работе. Все уточнения лучше фиксировать в чате справа.";
  if (status === "delivered" && isBuyer) return "Продавец передал результат. Проверьте данные и подтвердите доставку, если все хорошо.";
  if (status === "delivered") return "Результат передан покупателю. Ожидается подтверждение или открытие спора.";
  if (status === "completed") return "Сделка завершена. История заказа и чат остаются доступны для просмотра.";
  if (status === "disputed") return "По заказу открыт спор. Администратор проверит историю сделки и сообщения.";
  if (status === "refunded") return "Заказ был возвращен покупателю. Подробности можно посмотреть в истории сделки.";
  if (status === "canceled") return "Оплата по заказу не прошла. Можно создать новый заказ и попробовать снова.";
  return "Следите за статусом заказа и используйте чат для уточнений.";
}
