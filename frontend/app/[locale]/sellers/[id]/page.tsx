"use client";

import Link from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Heart, MessageCircle, Star, Store } from "lucide-react";
import { EmailNotVerifiedNotice } from "@/components/EmailNotVerifiedNotice";
import { apiFetch, isEmailNotVerifiedError, type Product } from "@/lib/api";
import { ProductCard } from "@/components/ProductCard";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";

type SellerResponse = {
  user: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
    role: string;
    settings?: Record<string, unknown>;
    createdAt: string;
    ratingAverage: number;
    reviewCount: number;
    online?: boolean;
  };
  stats: {
    activeListings: number;
    totalSales: number;
    completedOrders: number;
    successRate: number;
  };
  products: Product[];
};

export default function SellerPage({ params }: { params: { id: string } }) {
  const { t } = useI18n();
  const router = useRouter();
  const userSession = useAuth((state) => state.user);
  const hydrated = useAuth((state) => state.hydrated);
  const client = useQueryClient();
  const seller = useQuery({
    queryKey: ["seller", params.id],
    queryFn: () => apiFetch<SellerResponse>(`/users/${params.id}`)
  });
  const favorites = useQuery({
    queryKey: ["seller-favorites"],
    queryFn: () => apiFetch<{ sellerIds: string[] }>("/users/me/seller-favorites"),
    enabled: Boolean(userSession)
  });
  const favoriteMutation = useMutation({
    mutationFn: (liked: boolean) => apiFetch(`/users/${params.id}/favorite`, { method: liked ? "DELETE" : "PUT" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["seller-favorites"] })
  });
  const startChat = useMutation({
    mutationFn: () => apiFetch<{ conversationId: string }>(`/chat/users/${params.id}/start`, { method: "POST" }),
    onSuccess: ({ conversationId }) => router.push(`/messages?conversation=${conversationId}`)
  });

  if (seller.isLoading) return <p className="text-muted">{t("common.loading")}</p>;
  if (!seller.data) return <p className="text-rose-600">{t("orders.notFound")}</p>;

  const { user, stats, products } = seller.data;
  const rating = Number(user.ratingAverage ?? 0);
  const isFavorite = favorites.data?.sellerIds.includes(user.id) ?? false;
  const isOwn = userSession?.id === user.id;
  const headline = typeof user.settings?.headline === "string" ? user.settings.headline : "SKRYNIA seller";
  const specialty = typeof user.settings?.specialty === "string" ? user.settings.specialty : "Digital goods";
  const responseTime = typeof user.settings?.responseTime === "string" ? user.settings.responseTime : "Usually fast";
  const startChatError = startChat.error;

  function writeSeller() {
    if (!hydrated) return;
    if (!userSession) {
      router.push(`/login?next=${encodeURIComponent(`/users/${params.id}`)}`);
      return;
    }
    startChat.reset();
    startChat.mutate();
  }

  return (
    <div className="mx-auto grid max-w-[1180px] gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
        <section className="app-card p-5">
          <div className="flex flex-col items-center text-center">
            <span className="grid h-24 w-24 place-items-center overflow-hidden rounded-2xl border border-line bg-panel text-3xl font-black text-brand">
              {user.avatarUrl ? <img className="h-full w-full object-cover" src={user.avatarUrl} alt={user.displayName} /> : user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <h1 className="mt-4 max-w-full truncate text-xl font-black text-ink">{user.displayName}</h1>
            <p className="mt-1 text-sm font-bold text-muted">{headline}</p>
            <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-panel px-3 py-1 text-xs font-bold text-muted">
              <span className={`h-2.5 w-2.5 rounded-full ${user.online ? "bg-emerald-400" : "bg-muted"}`} />
              {user.online ? "Online" : "Offline"}
            </span>
          </div>

          <div className="mt-5 grid gap-2 text-sm">
            <InfoRow label="Rating" value={rating ? rating.toFixed(1) : "New"} />
            <InfoRow label="Reviews" value={user.reviewCount} />
            <InfoRow label="Deals" value={stats.completedOrders} />
            <InfoRow label="Response" value={responseTime} />
            <InfoRow label="Focus" value={specialty} />
          </div>

          {!isOwn ? (
            <div className="mt-5 grid gap-2">
              <button className="app-button h-11 w-full" type="button" disabled={!hydrated || startChat.isPending} onClick={writeSeller}>
                <MessageCircle className="h-4 w-4" />
                {t("seller.messageUser")}
              </button>
              <button className={isFavorite ? "app-button h-11 w-full" : "app-button-secondary h-11 w-full"} disabled={!userSession || favoriteMutation.isPending} onClick={() => favoriteMutation.mutate(isFavorite)}>
                <Heart className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
                {isFavorite ? t("seller.saved") : t("seller.saveUser")}
              </button>
              {startChatError ? (
                isEmailNotVerifiedError(startChatError) ? (
                  <EmailNotVerifiedNotice />
                ) : (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-300">
                    {startChatError instanceof Error ? startChatError.message : t("common.somethingWentWrong")}
                  </p>
                )
              ) : null}
            </div>
          ) : null}
        </section>

        <Link className="app-card flex items-center justify-between px-4 py-3 text-sm font-bold text-muted transition hover:text-brand" href="/">
          <span className="inline-flex items-center gap-2">
            <Store className="h-4 w-4" />
            {t("nav.home")}
          </span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </aside>

      <main className="space-y-4">
        <section className="app-card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-xs font-black uppercase text-brand">{t("seller.activeListings")}</p>
            <h2 className="mt-1 text-xl font-black text-ink">{t("seller.activeOffersCount", { count: products.length })}</h2>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-panel px-3 py-1 text-sm font-bold text-muted">
            <Star className="h-4 w-4 fill-action text-action" />
            {rating ? rating.toFixed(1) : "New seller"}
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={{
                ...product,
                sellerId: user.id,
                sellerDisplayName: user.displayName,
                sellerRating: rating,
                sellerReviewCount: user.reviewCount,
                sellerOnline: user.online
              }}
            />
          ))}
        </div>

        {!products.length ? (
          <div className="app-card grid min-h-[220px] place-items-center p-8 text-center text-sm text-muted">
            {t("seller.noActiveOffers")}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/70 py-2 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-right font-black text-ink">{value}</span>
    </div>
  );
}
