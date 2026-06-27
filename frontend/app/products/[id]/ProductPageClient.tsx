"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BadgePercent,
  Clock,
  CreditCard,
  MessageCircle,
  PackageCheck,
  Star,
  Tag,
  Timer,
  Truck
} from "lucide-react";
import { ChatPanel } from "../../../components/ChatPanel";
import { EmailNotVerifiedNotice } from "../../../components/EmailNotVerifiedNotice";
import { apiFetch, isEmailNotVerifiedError, money, type Product } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-store";
import { useI18n } from "../../../lib/i18n";
import { fieldLabel, formatFieldValue } from "../../../lib/product-fields";
import { redirectToLiqpay, type LiqpayCheckout } from "../../../lib/liqpay";
import { redirectToMonobank, type MonobankCheckout } from "../../../lib/monobank";
import { redirectToWayforpay, type WayforpayCheckout } from "../../../lib/wayforpay";

const HIDDEN_METADATA_KEYS = new Set(["catalogKind", "shortDescription", "region", "rank"]);

const productTypeLabels: Record<string, string> = {
  account: "Аккаунт",
  key: "Ключ / код",
  topup: "Пополнение",
  boosting: "Бустинг",
  service: "Услуга",
  item: "Предмет",
  currency: "Валюта"
};

type ProductReview = {
  id: string;
  rating: number;
  comment?: string | null;
  buyerDisplayName: string;
  productTitle?: string;
  createdAt: string;
};

export function ProductPageClient({ id }: { id: string }) {
  const router = useRouter();
  const user = useAuth((state) => state.user);
  const { t } = useI18n();

  const product = useQuery({
    queryKey: ["product", id],
    queryFn: () => apiFetch<{ product: Product; reviews: ProductReview[] }>(`/marketplace/products/${id}`)
  });

  const productItem = product.data?.product;
  const autoChat = useQuery({
    queryKey: ["product-chat", id, user?.id],
    queryFn: () => apiFetch<{ conversationId: string; existing: boolean }>(`/chat/products/${id}/start`, { method: "POST" }),
    enabled: Boolean(user && productItem && user.id !== productItem.sellerId),
    retry: false
  });

  async function createOrder() {
    const { order } = await apiFetch<{ order: { id: string } }>("/orders", {
      method: "POST",
      body: JSON.stringify({ productId: id, quantity: 1 })
    });
    return order;
  }

  const buyWithLiqpay = useMutation({
    mutationFn: async () => {
      const order = await createOrder();
      return apiFetch<LiqpayCheckout>(`/payments/orders/${order.id}/liqpay/checkout`, { method: "POST" });
    },
    onSuccess: redirectToLiqpay
  });

  const buyWithMonobank = useMutation({
    mutationFn: async () => {
      const order = await createOrder();
      return apiFetch<MonobankCheckout>(`/payments/orders/${order.id}/monobank/checkout`, { method: "POST" });
    },
    onSuccess: redirectToMonobank
  });

  const buyWithWayforpay = useMutation({
    mutationFn: async () => {
      const order = await createOrder();
      return apiFetch<WayforpayCheckout>(`/payments/orders/${order.id}/wayforpay/checkout`, { method: "POST" });
    },
    onSuccess: redirectToWayforpay
  });

  const buyWithManualTransfer = useMutation({
    mutationFn: () => createOrder(),
    onSuccess: (order) => router.push(`/orders/${order.id}`)
  });

  const buyError = buyWithLiqpay.error ?? buyWithMonobank.error ?? buyWithWayforpay.error ?? buyWithManualTransfer.error;

  if (product.isLoading) return <p className="text-muted">{t("common.loading")}</p>;
  if (!product.data) return <p className="text-rose-600">{t("home.noListings")}</p>;

  const item = product.data.product;
  const reviews = product.data.reviews ?? [];
  const isOwn = user?.id === item.sellerId;
  const discount =
    item.oldPriceCents && item.oldPriceCents > item.priceCents
      ? Math.round(((item.oldPriceCents - item.priceCents) / item.oldPriceCents) * 100)
      : 0;
  const metadata = item.metadata ?? {};
  const extraSpecs = Object.entries(metadata).filter(
    ([key, value]) => !HIDDEN_METADATA_KEYS.has(key) && value !== null && value !== undefined && value !== ""
  );
  const tags = [
    item.gameName,
    item.sectionName,
    item.categoryName,
    item.platform,
    item.server,
    typeof metadata.region === "string" ? metadata.region : null,
    item.deliveryType === "instant" ? "Мгновенная доставка" : "Ручная доставка",
    productTypeLabels[item.productType ?? ""] ?? item.productType
  ].filter(Boolean) as string[];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <main className="space-y-5">
        <section className="app-card overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="p-5 sm:p-6">
              <p className="inline-flex rounded-full border border-line bg-panel px-3 py-1 text-xs font-bold text-muted">
                {[item.gameName, item.sectionName, item.categoryName].filter(Boolean).join(" / ")}
              </p>
              <h1 className="mt-4 text-3xl font-black leading-tight text-ink">{item.title}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{shortText(item)}</p>

              <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
                {item.isHot ? <Pill className="bg-action text-stone-950">Хит продаж</Pill> : null}
                {item.isRecommended ? <Pill className="bg-brand/10 text-brand">Рекомендовано SKRYNIA</Pill> : null}
                {discount ? (
                  <Pill className="bg-rose-500 text-white">
                    <BadgePercent className="h-3.5 w-3.5" />-{discount}%
                  </Pill>
                ) : null}
                {item.deliveryType === "instant" ? (
                  <Pill className="bg-emerald-500/10 text-emerald-400">
                    <Timer className="h-3.5 w-3.5" />
                    Мгновенно
                  </Pill>
                ) : null}
              </div>
            </div>

            <div className="border-t border-line bg-panel/40 p-5 lg:border-l lg:border-t-0">
              <p className="text-sm text-muted">Цена лота</p>
              {item.oldPriceCents ? <p className="mt-2 text-sm font-semibold text-muted line-through">{money(item.oldPriceCents, item.currency)}</p> : null}
              <p className="mt-1 text-3xl font-black text-brand">{money(item.priceCents, item.currency)}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <MiniFact icon={PackageCheck} label="В наличии" value={`${item.stock} шт.`} />
                <MiniFact icon={Truck} label="Доставка" value={item.deliveryType === "instant" ? "Сразу" : "Ручная"} />
              </div>
              {isOwn ? null : item.stock < 1 ? (
                <p className="mt-5 rounded-lg bg-panel/35 p-3 text-center text-sm text-muted">Лот распродан</p>
              ) : user ? (
                <div className="mt-5 grid gap-2">
                  <button className="app-button-action w-full py-3" disabled={buyWithLiqpay.isPending} onClick={() => buyWithLiqpay.mutate()}>
                    <CreditCard className="h-5 w-5" />
                    {buyWithLiqpay.isPending ? "Переходим к оплате..." : "Купить через LiqPay"}
                  </button>
                  <button className="app-button-action w-full py-3" disabled={buyWithMonobank.isPending} onClick={() => buyWithMonobank.mutate()}>
                    <CreditCard className="h-5 w-5" />
                    {buyWithMonobank.isPending ? "Переходим к оплате..." : "Купить через Monobank"}
                  </button>
                  <button className="app-button-action w-full py-3" disabled={buyWithWayforpay.isPending} onClick={() => buyWithWayforpay.mutate()}>
                    <CreditCard className="h-5 w-5" />
                    {buyWithWayforpay.isPending ? "Переходим к оплате..." : "Купить через WayForPay"}
                  </button>
                  <button className="app-button-secondary w-full py-3" disabled={buyWithManualTransfer.isPending} onClick={() => buyWithManualTransfer.mutate()}>
                    <CreditCard className="h-5 w-5" />
                    {buyWithManualTransfer.isPending ? "Создаём заказ..." : "Оплатить переводом"}
                  </button>
                </div>
              ) : (
                <button className="app-button-action mt-5 w-full py-3" onClick={() => router.push("/login")}>
                  <CreditCard className="h-5 w-5" />
                  Войти и купить
                </button>
              )}
              {buyError ? (
                isEmailNotVerifiedError(buyError) ? (
                  <div className="mt-3">
                    <EmailNotVerifiedNotice />
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-rose-600">{buyError.message}</p>
                )
              ) : null}
            </div>
          </div>
        </section>

        <section className="app-card p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand/10 text-brand">
              <Tag className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-black text-ink">Описание лота</h2>
              <p className="text-sm text-muted">Основные детали, которые стоит проверить перед покупкой.</p>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-line bg-panel/35 p-4">
            <p className="whitespace-pre-wrap text-base leading-8 text-ink">{item.description}</p>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="app-card p-5">
            <h2 className="text-lg font-black text-ink">Характеристики</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Spec label="Игра" value={item.gameName} />
              <Spec label="Раздел" value={item.sectionName ?? item.categoryName} />
              <Spec label="Тип товара" value={productTypeLabels[item.productType ?? ""] ?? item.productType} />
              <Spec label="Сервер" value={item.server} />
              <Spec label="Платформа" value={item.platform} />
              <Spec label="Регион" value={typeof metadata.region === "string" ? metadata.region : undefined} />
              <Spec label="Ранг / уровень" value={typeof metadata.rank === "string" ? metadata.rank : undefined} />
              {extraSpecs.map(([key, value]) => (
                <Spec key={key} label={fieldLabel(key)} value={formatFieldValue(key, value)} />
              ))}
              <Spec label="Продано" value={String(item.salesCount ?? 0)} />
            </dl>
          </div>

          <div className="app-card p-5">
            <h2 className="text-lg font-black text-ink">Теги</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={tag} className="rounded-full border border-line bg-panel px-3 py-1.5 text-sm font-semibold text-muted">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
        <section className="rounded-xl border border-line bg-card p-4">
          <p className="text-sm text-muted">Продавец</p>
          <Link className="mt-3 flex items-center gap-3 rounded-xl bg-panel/45 p-3 transition hover:bg-brand/10" href={`/sellers/${item.sellerId}`}>
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand/10 text-xl font-black text-brand">{item.sellerDisplayName.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0">
              <span className="block truncate font-black text-ink">{item.sellerDisplayName}</span>
              <span className="mt-1 flex items-center gap-1 text-sm text-muted">
                <Star className="h-4 w-4 fill-action text-action" />
                {Number(item.sellerRating ?? 0).toFixed(1)} / {item.sellerReviewCount ?? 0} отзывов
              </span>
              <span className="mt-1 flex items-center gap-1 text-xs font-bold text-muted">
                <span className={`h-2.5 w-2.5 rounded-full ${item.sellerOnline ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" : "bg-muted"}`} />
                {item.sellerOnline ? "Онлайн" : "Не в сети"}
              </span>
            </span>
          </Link>

        </section>

        <section className="rounded-xl border border-line bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand/10 text-brand">
                <MessageCircle className="h-5 w-5" />
              </span>
              <div>
                <p className="font-black text-ink">Чат с продавцом</p>
                <p className="text-xs text-muted">Уточните детали по этому лоту.</p>
              </div>
            </div>
            {autoChat.data?.conversationId ? (
              <div className="mt-3 overflow-hidden rounded-lg bg-surface/35">
                <ChatPanel conversationId={autoChat.data.conversationId} compact />
              </div>
            ) : autoChat.isLoading ? (
              <div className="mt-3 grid min-h-[130px] place-items-center rounded-lg bg-panel/35 text-sm text-muted">
                Открываем мини-чат...
              </div>
            ) : !user ? (
              <button className="app-button-secondary mt-3 w-full py-3" onClick={() => router.push("/login")}>
                <MessageCircle className="h-5 w-5" />
                Войти и написать продавцу
              </button>
            ) : isOwn ? (
              <div className="mt-3 rounded-lg bg-panel/35 p-3 text-sm text-muted">
                Это ваш лот. Покупатели смогут написать вам со страницы товара.
              </div>
            ) : (
              <button
                className="app-button-secondary mt-3 w-full py-3"
                onClick={() => autoChat.refetch()}
              >
                <MessageCircle className="h-5 w-5" />
                Открыть чат
              </button>
            )}
          {autoChat.error ? (
            isEmailNotVerifiedError(autoChat.error) ? (
              <div className="mt-3">
                <EmailNotVerifiedNotice />
              </div>
            ) : (
              <p className="mt-2 text-sm text-rose-600">{autoChat.error.message}</p>
            )
          ) : null}
        </section>

        <section className="app-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-ink">Отзывы о продавце</h2>
              <p className="mt-1 text-xs text-muted">Последние оценки после завершенных сделок.</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-panel px-3 py-1 text-xs font-bold text-muted">
              <Star className="h-3.5 w-3.5 fill-action text-action" />
              {Number(item.sellerRating ?? 0).toFixed(1)}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {reviews.map((review) => (
              <article key={review.id} className="rounded-lg border border-line bg-panel/35 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-ink">{review.buyerDisplayName}</p>
                    <p className="mt-1 truncate text-xs text-muted">{review.productTitle ?? "Заказ"}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-black text-brand">
                    <Star className="h-4 w-4 fill-action text-action" />
                    {review.rating}
                  </span>
                </div>
                {review.comment ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{review.comment}</p> : null}
              </article>
            ))}
            {!reviews.length ? <p className="rounded-lg border border-line bg-panel/35 p-3 text-sm text-muted">У продавца пока нет отзывов.</p> : null}
          </div>
        </section>

      </aside>
    </div>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${className}`}>{children}</span>;
}

function MiniFact({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <Icon className="h-4 w-4 text-brand" />
      <p className="mt-2 text-xs text-muted">{label}</p>
      <p className="mt-1 font-black text-ink">{value}</p>
    </div>
  );
}

function Spec({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-panel/40 p-3">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 font-black text-ink">{value || "-"}</dd>
    </div>
  );
}

function shortText(item: Product) {
  const shortDescription = item.metadata?.shortDescription;
  if (typeof shortDescription === "string" && shortDescription.trim()) return shortDescription;
  return item.description.length > 180 ? `${item.description.slice(0, 180)}...` : item.description;
}
