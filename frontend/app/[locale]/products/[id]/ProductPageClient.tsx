"use client";

import { useState, useEffect } from "react";
import Link from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgePercent,
  Clock,
  CreditCard,
  Flag,
  MessageCircle,
  PackageCheck,
  ShieldOff,
  Star,
  Tag,
  Timer,
  Truck
} from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { EmailNotVerifiedNotice } from "@/components/EmailNotVerifiedNotice";
import { ReportModal } from "@/components/ReportModal";
import { apiFetch, isEmailNotVerifiedError, money, type Product } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { fieldLabel, formatFieldValue } from "@/lib/product-fields";
import type { CatalogField } from "@/lib/catalog-api";
import { showAppToast } from "@/lib/toast-events";
import { captureEvent } from "@/lib/posthog";

const HIDDEN_METADATA_KEYS = new Set(["catalogKind", "shortDescription", "region", "rank"]);

const PRODUCT_TYPE_KEYS: Record<string, string> = {
  account: "product.type.account",
  key: "product.type.key",
  topup: "product.type.topup",
  boosting: "product.type.boosting",
  service: "product.type.service",
  item: "product.type.item",
  currency: "product.type.currency"
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
  const queryClient = useQueryClient();
  const user = useAuth((state) => state.user);
  const { t } = useI18n();
  const [reportOpen, setReportOpen] = useState(false);

  const product = useQuery({
    queryKey: ["product", id],
    queryFn: () => apiFetch<{ product: Product; reviews: ProductReview[] }>(`/marketplace/products/${id}`)
  });

  const productItem = product.data?.product;
  const isOwnProduct = Boolean(user && productItem && user.id === productItem.sellerId);
  const [productConversationId, setProductConversationId] = useState<string | null>(null);

  useEffect(() => {
    setProductConversationId(null);
  }, [id]);

  const existingProductConversation = useQuery({
    queryKey: ["product-conversation", id],
    queryFn: () => apiFetch<{ conversationId: string | null }>(`/chat/products/${id}/conversation`),
    enabled: Boolean(user && productItem && !isOwnProduct)
  });

  useEffect(() => {
    if (existingProductConversation.data) {
      setProductConversationId(existingProductConversation.data.conversationId);
    }
  }, [existingProductConversation.data]);

  useEffect(() => {
    if (!productItem) return;
    captureEvent("product_viewed", {
      product_id: productItem.id,
      category: productItem.categorySlug,
      game: productItem.gameSlug,
      product_type: productItem.productType,
      delivery_type: productItem.deliveryType,
      price_cents: productItem.priceCents,
      currency: productItem.currency,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productItem?.id]);

  const blockedUsers = useQuery({
    queryKey: ["blocked-users"],
    queryFn: () => apiFetch<{ blocked: { id: string }[] }>("/users/me/blocked"),
    enabled: Boolean(user)
  });
  const isBlocked = Boolean(productItem && blockedUsers.data?.blocked.some((blocked) => blocked.id === productItem.sellerId));

  const blockSeller = useMutation({
    mutationFn: () => apiFetch(`/users/${productItem!.sellerId}/block`, { method: "POST" }),
    onSuccess: () => {
      showAppToast({ title: t("product.userBlocked") });
      queryClient.invalidateQueries({ queryKey: ["blocked-users"] });
    }
  });

  // Provider choice (LiqPay/Monobank/WayForPay/manual transfer) happens on the order page,
  // not here — the product page only needs to create the order and hand off to checkout.
  const buySecurely = useMutation({
    mutationFn: async () => {
      captureEvent("checkout_started", { product_id: id });
      const { order } = await apiFetch<{ order: { id: string } }>("/orders", {
        method: "POST",
        body: JSON.stringify({ productId: id, quantity: 1 })
      });
      return order;
    },
    onSuccess: (order) => {
      captureEvent("order_created", { order_id: order.id, product_id: id });
      router.push(`/orders/${order.id}`);
    }
  });

  const buyError = buySecurely.error;

  if (product.isLoading) return <p className="text-muted">{t("common.loading")}</p>;
  if (!product.data) return <p className="text-rose-600">{t("home.noListings")}</p>;

  const item = product.data.product;
  const reviews = product.data.reviews ?? [];
  const isOwn = isOwnProduct;
  const discount =
    item.oldPriceCents && item.oldPriceCents > item.priceCents
      ? Math.round(((item.oldPriceCents - item.priceCents) / item.oldPriceCents) * 100)
      : 0;
  const metadata = item.metadata ?? {};
  // A lot created under a catalog-builder section carries its own field schema
  // (metadataFields, resolved against the schema version it was created under - see
  // catalog.service.ts:getSchemaByVersion) - its specs must be rendered by that schema's
  // labels, not the legacy hardcoded key->label heuristics in product-fields.ts, which only
  // apply to lots from sections that predate the catalog builder.
  const schemaSpecs = (item.metadataFields ?? [])
    .map((field) => ({ field, value: metadata[field.key] }))
    .filter(({ value }) => value !== null && value !== undefined && value !== "");
  const extraSpecs = schemaSpecs.length
    ? []
    : Object.entries(metadata).filter(
        ([key, value]) => !HIDDEN_METADATA_KEYS.has(key) && value !== null && value !== undefined && value !== ""
      );
  const tags = [
    item.gameName,
    item.sectionName,
    item.categoryName,
    item.platform,
    item.server,
    typeof metadata.region === "string" ? metadata.region : null,
    item.deliveryType === "instant" ? t("seller.instantDelivery") : t("seller.manualDelivery"),
    productTypeLabel(t, item.productType)
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
                {item.isHot ? <Pill className="bg-action text-stone-950">{t("product.hotBadge")}</Pill> : null}
                {item.isRecommended ? <Pill className="bg-brand/10 text-brand">{t("product.recommendedBadge")}</Pill> : null}
                {discount ? (
                  <Pill className="bg-rose-500 text-white">
                    <BadgePercent className="h-3.5 w-3.5" />-{discount}%
                  </Pill>
                ) : null}
                {item.deliveryType === "instant" ? (
                  <Pill className="bg-emerald-500/10 text-emerald-400">
                    <Timer className="h-3.5 w-3.5" />
                    {t("product.instant")}
                  </Pill>
                ) : null}
              </div>
            </div>

            <div className="border-t border-line bg-panel/40 p-5 lg:border-l lg:border-t-0">
              <p className="text-sm text-muted">{t("product.lotPrice")}</p>
              {item.oldPriceCents ? <p className="mt-2 text-sm font-semibold text-muted line-through">{money(item.oldPriceCents, item.currency)}</p> : null}
              <p className="mt-1 text-3xl font-black text-brand">{money(item.priceCents, item.currency)}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <MiniFact icon={PackageCheck} label={t("product.inStock")} value={`${item.stock} ${t("product.unitsShort")}`} />
                <MiniFact icon={Truck} label={t("product.delivery")} value={item.deliveryType === "instant" ? t("product.instant") : t("product.deliveryManualShort")} />
              </div>
              {isOwn ? null : item.stock < 1 ? (
                <p className="mt-5 rounded-lg bg-panel/35 p-3 text-center text-sm text-muted">{t("product.soldOut")}</p>
              ) : user ? (
                <div className="mt-5 grid gap-2">
                  <button className="app-button-action w-full py-3" disabled={buySecurely.isPending} onClick={() => buySecurely.mutate()}>
                    <CreditCard className="h-5 w-5" />
                    {buySecurely.isPending ? t("product.buying") : t("product.buySecurely")}
                  </button>
                </div>
              ) : (
                <button className="app-button-action mt-5 w-full py-3" onClick={() => router.push("/login")}>
                  <CreditCard className="h-5 w-5" />
                  {t("product.loginAndBuy")}
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
              <h2 className="text-xl font-black text-ink">{t("product.descriptionTitle")}</h2>
              <p className="text-sm text-muted">{t("product.descriptionSubtitle")}</p>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-line bg-panel/35 p-4">
            <p className="whitespace-pre-wrap text-base leading-8 text-ink">{item.description}</p>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="app-card p-5">
            <h2 className="text-lg font-black text-ink">{t("product.specsTitle")}</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Spec label={t("product.specGame")} value={item.gameName} />
              <Spec label={t("product.specSection")} value={item.sectionName ?? item.categoryName} />
              <Spec label={t("product.specType")} value={productTypeLabel(t, item.productType)} />
              <Spec label={t("product.specServer")} value={item.server} />
              <Spec label={t("product.specPlatform")} value={item.platform} />
              <Spec label={t("product.specRegion")} value={typeof metadata.region === "string" ? metadata.region : undefined} />
              <Spec label={t("product.specRank")} value={typeof metadata.rank === "string" ? metadata.rank : undefined} />
              {schemaSpecs.map(({ field, value }) => (
                <Spec key={field.key} label={field.label} value={formatSchemaFieldValue(field, value, t)} />
              ))}
              {extraSpecs.map(([key, value]) => (
                <Spec key={key} label={fieldLabel(key)} value={formatFieldValue(key, value)} />
              ))}
              <Spec label={t("product.specSold")} value={String(item.salesCount ?? 0)} />
            </dl>
          </div>

          <div className="app-card p-5">
            <h2 className="text-lg font-black text-ink">{t("product.tagsTitle")}</h2>
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
          <p className="text-sm text-muted">{t("product.sellerLabel")}</p>
          <Link className="mt-3 flex items-center gap-3 rounded-xl bg-panel/45 p-3 transition hover:bg-brand/10" href={`/users/${item.sellerId}`}>
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand/10 text-xl font-black text-brand">{item.sellerDisplayName.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0">
              <span className="block truncate font-black text-ink">{item.sellerDisplayName}</span>
              <span className="mt-1 flex items-center gap-1 text-sm text-muted">
                <Star className="h-4 w-4 fill-action text-action" />
                {Number(item.sellerRating ?? 0).toFixed(1)} / {item.sellerReviewCount ?? 0} {t("product.reviews")}
              </span>
              <span className="mt-1 flex items-center gap-1 text-xs font-bold text-muted">
                <span className={`h-2.5 w-2.5 rounded-full ${item.sellerOnline ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" : "bg-muted"}`} />
                {item.sellerOnline ? t("product.online") : t("product.offline")}
              </span>
            </span>
          </Link>

          {!isOwn && user ? (
            <div className="mt-3 flex items-center gap-3 text-xs font-bold text-muted">
              <button
                className="inline-flex items-center gap-1 hover:text-ink"
                onClick={() => {
                  if (isBlocked) return;
                  if (window.confirm(t("product.blockUserConfirm"))) blockSeller.mutate();
                }}
                disabled={isBlocked || blockSeller.isPending}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {isBlocked ? t("product.userBlocked") : t("product.blockUser")}
              </button>
              <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setReportOpen(true)}>
                <Flag className="h-3.5 w-3.5" />
                {t("product.report")}
              </button>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-line bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand/10 text-brand">
                <MessageCircle className="h-5 w-5" />
              </span>
              <div>
                <p className="font-black text-ink">{t("product.chatWithSeller")}</p>
                <p className="text-xs text-muted">{t("product.chatSubtitle")}</p>
              </div>
            </div>
            {productConversationId ? (
              <button
                className="app-button-secondary h-9 shrink-0 px-3 text-xs"
                type="button"
                onClick={() => router.push(`/messages?conversationId=${productConversationId}`)}
              >
                {t("product.openInMessages")}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {user && !isOwn ? (
            <Link
              className="mt-3 flex items-center gap-3 rounded-xl border border-line/60 bg-panel/45 p-3 transition hover:border-brand/40 hover:bg-brand/10"
              href={`/users/${item.sellerId}`}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-brand/10 text-base font-black text-brand">
                {item.sellerDisplayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-ink">{item.sellerDisplayName}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <span className={`h-2 w-2 rounded-full ${item.sellerOnline ? "bg-emerald-400" : "bg-muted"}`} />
                  {item.sellerOnline ? t("product.online") : t("product.offline")}
                </span>
              </span>
            </Link>
          ) : null}

          {!user ? (
            <button className="app-button-secondary mt-3 w-full py-3" onClick={() => router.push("/login")}>
              <MessageCircle className="h-5 w-5" />
              {t("product.loginAndMessage")}
            </button>
          ) : isOwn ? (
            <div className="mt-3 rounded-lg bg-panel/35 p-3 text-sm text-muted">
              {t("product.ownListingChatNotice")}
            </div>
          ) : (
            <div className="mt-3">
              <ChatPanel
                key={id}
                conversationId={productConversationId}
                mode="compact"
                disabledNotice={
                  existingProductConversation.isLoading
                    ? t("common.loading")
                    : isBlocked
                      ? t("product.blockedChatNotice")
                      : undefined
                }
                ensureConversation={async () => {
                  const created = await apiFetch<{ conversationId: string; existing: boolean }>(`/chat/products/${id}/start`, { method: "POST" });
                  return { conversationId: created.conversationId };
                }}
                onConversationReady={(conversationId) => {
                  setProductConversationId(conversationId);
                  queryClient.setQueryData(["product-conversation", id], { conversationId });
                  queryClient.invalidateQueries({ queryKey: ["chat-conversations-grouped"] });
                }}
              />
            </div>
          )}
        </section>

        <section className="app-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-ink">{t("product.sellerReviewsTitle")}</h2>
              <p className="mt-1 text-xs text-muted">{t("product.sellerReviewsSubtitle")}</p>
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
                    <p className="mt-1 truncate text-xs text-muted">{review.productTitle ?? t("product.orderFallback")}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-black text-brand">
                    <Star className="h-4 w-4 fill-action text-action" />
                    {review.rating}
                  </span>
                </div>
                {review.comment ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{review.comment}</p> : null}
              </article>
            ))}
            {!reviews.length ? <p className="rounded-lg border border-line bg-panel/35 p-3 text-sm text-muted">{t("product.noSellerReviews")}</p> : null}
          </div>
        </section>

      </aside>

      {reportOpen ? <ReportModal kind="user" targetId={item.sellerId} onClose={() => setReportOpen(false)} /> : null}
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

function formatSchemaFieldValue(field: CatalogField, value: unknown, t: (key: string) => string): string {
  switch (field.type) {
    case "boolean":
    case "checkbox":
      return value === true ? t("common.yes") : t("common.no");
    case "multiselect":
      return Array.isArray(value) ? value.join(", ") : String(value);
    default:
      return String(value);
  }
}

function productTypeLabel(t: (key: string) => string, productType?: string | null) {
  if (!productType) return undefined;
  const key = PRODUCT_TYPE_KEYS[productType];
  return key ? t(key) : productType;
}

function shortText(item: Product) {
  const shortDescription = item.metadata?.shortDescription;
  if (typeof shortDescription === "string" && shortDescription.trim()) return shortDescription;
  return item.description.length > 180 ? `${item.description.slice(0, 180)}...` : item.description;
}
