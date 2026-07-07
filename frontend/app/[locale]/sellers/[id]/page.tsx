"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/lib/navigation";
import { apiFetch, type Product, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { showAppToast } from "@/lib/toast-events";
import { EditSellerBannerModal } from "./EditSellerBannerModal";
import { EditSellerProfileModal } from "./EditSellerProfileModal";
import { SellerHero } from "./SellerHero";
import { SellerListingRow } from "./SellerListingRow";
import { buildSellerTabs, SellerTabs } from "./SellerTabs";

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
    favoriteCount: number;
    activeOrders?: number;
    disputedOrders?: number;
    completedRevenueCents?: string | number;
  };
  products: Product[];
  reviews?: Array<{
    id: string;
    rating: number;
    comment?: string | null;
    buyerDisplayName: string;
    productTitle?: string;
    createdAt: string;
  }>;
};

function readSetting(settings: Record<string, unknown> | undefined, ...keys: string[]): string {
  for (const key of keys) {
    const value = settings?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

export default function SellerPage({ params }: { params: { id: string } }) {
  const { t } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const userSession = useAuth((state) => state.user);
  const hydrated = useAuth((state) => state.hydrated);
  const setAuthUser = useAuth((state) => state.setUser);

  const [activeTab, setActiveTab] = useState("all");
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showEditBanner, setShowEditBanner] = useState(false);

  const seller = useQuery({
    queryKey: ["seller", params.id],
    queryFn: () => apiFetch<SellerResponse>(`/users/${params.id}`)
  });

  const sellerFavorites = useQuery({
    queryKey: ["seller-favorites"],
    queryFn: () => apiFetch<{ sellerIds: string[] }>("/users/me/seller-favorites"),
    enabled: Boolean(userSession)
  });

  const productFavoriteIds = useQuery({
    queryKey: ["favorite-ids"],
    queryFn: () => apiFetch<{ productIds: string[] }>("/marketplace/favorites/ids"),
    enabled: Boolean(userSession)
  });

  const sellerFavoriteMutation = useMutation({
    mutationFn: (liked: boolean) => apiFetch(`/users/${params.id}/favorite`, { method: liked ? "DELETE" : "PUT" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["seller-favorites"] });
      client.invalidateQueries({ queryKey: ["seller", params.id] });
    },
    onError: () => showAppToast({ title: t("common.somethingWentWrong") })
  });

  const productFavoriteMutation = useMutation({
    mutationFn: ({ productId, liked }: { productId: string; liked: boolean }) =>
      apiFetch(`/marketplace/favorites/${productId}`, { method: liked ? "DELETE" : "PUT" }),
    onMutate: async ({ productId, liked }) => {
      await client.cancelQueries({ queryKey: ["favorite-ids"] });
      const previous = client.getQueryData<{ productIds: string[] }>(["favorite-ids"]);
      client.setQueryData<{ productIds: string[] }>(["favorite-ids"], (current) => {
        const ids = current?.productIds ?? [];
        return { productIds: liked ? ids.filter((id) => id !== productId) : Array.from(new Set([productId, ...ids])) };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(["favorite-ids"], context.previous);
    },
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ["favorite-ids"] });
      client.invalidateQueries({ queryKey: ["favorites"] });
      client.invalidateQueries({ queryKey: ["seller", params.id] });
      showAppToast({
        type: "favorite",
        title: variables.liked ? t("seller.listingFavoriteRemoved") : t("seller.listingFavoriteAdded"),
        productId: variables.productId
      });
    }
  });

  const startChat = useMutation({
    mutationFn: () => apiFetch<{ conversationId: string }>(`/chat/users/${params.id}/start`, { method: "POST" }),
    onSuccess: ({ conversationId }) => router.push(`/messages?conversationId=${conversationId}`)
  });

  const avatarUpload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      const uploaded = await apiFetch<{ url: string }>("/storage/upload", { method: "POST", body });
      const updated = await apiFetch<{ user: User }>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ avatarUrl: uploaded.url, settings: seller.data?.user.settings ?? {} })
      });
      return updated.user;
    },
    onSuccess: (updated) => {
      client.invalidateQueries({ queryKey: ["seller", params.id] });
      if (userSession?.id === updated.id) setAuthUser({ ...userSession, ...updated });
    },
    onError: () => showAppToast({ title: t("seller.profileSaveFailed") })
  });

  const products = seller.data?.products ?? [];
  const tabs = useMemo(() => buildSellerTabs(products, t), [products, t]);
  const visibleProducts = useMemo(() => {
    if (activeTab === "all") return products;
    return products.filter((product) => {
      const label = product.gameName || product.categoryName || (product.productType ? t(`product.type.${product.productType}`) : null);
      return label === activeTab;
    });
  }, [products, activeTab, t]);

  if (seller.isLoading) {
    return (
      <div className="w-full max-w-none space-y-3 lg:-mt-[17px] lg:ml-[6px] lg:w-[calc(100vw-196px)] lg:max-w-none min-[1720px]:ml-[calc(866px-50vw)]">
        <div className="app-card h-[360px] animate-pulse bg-panel/40" />
        <div className="app-card h-32 animate-pulse bg-panel/40" />
      </div>
    );
  }

  if (seller.isError || !seller.data) {
    return <p className="w-full max-w-none text-rose-600 lg:-mt-[17px] lg:ml-[6px] lg:w-[calc(100vw-196px)] lg:max-w-none min-[1720px]:ml-[calc(866px-50vw)]">{t("orders.notFound")}</p>;
  }

  const { user, stats } = seller.data;
  const reviews = seller.data.reviews ?? [];
  const rating = Number(user.ratingAverage ?? 0);
  const isOwn = userSession?.id === user.id;
  const isFavorite = sellerFavorites.data?.sellerIds.includes(user.id) ?? false;
  const favoriteProductIds = new Set(productFavoriteIds.data?.productIds ?? []);
  const tagline = readSetting(user.settings, "sellerTagline", "headline") || t("seller.trustedSeller");
  const bannerUrl = readSetting(user.settings, "sellerBannerUrl", "bannerUrl") || undefined;

  function requireAuth(next: () => void) {
    if (!hydrated) return;
    if (!userSession) {
      router.push(`/login?next=${encodeURIComponent(`/sellers/${params.id}`)}`);
      return;
    }
    next();
  }

  function handleMessage() {
    requireAuth(() => {
      startChat.reset();
      startChat.mutate();
    });
  }

  function handleToggleSellerFavorite() {
    requireAuth(() => sellerFavoriteMutation.mutate(isFavorite));
  }

  function handleToggleProductFavorite(product: Product) {
    requireAuth(() => productFavoriteMutation.mutate({ productId: product.id, liked: favoriteProductIds.has(product.id) }));
  }

  function handleAvatarPick(file: File) {
    avatarUpload.mutate(file);
  }

  function handleProfileSaved(updated: User) {
    client.invalidateQueries({ queryKey: ["seller", params.id] });
    if (userSession?.id === updated.id) setAuthUser({ ...userSession, ...updated });
    showAppToast({ title: t("seller.profileSaved") });
    setShowEditProfile(false);
  }

  function handleBannerSaved(updated: User) {
    client.invalidateQueries({ queryKey: ["seller", params.id] });
    if (userSession?.id === updated.id) setAuthUser({ ...userSession, ...updated });
    showAppToast({ title: t("seller.bannerSaved") });
    setShowEditBanner(false);
  }

  return (
    <div className="w-full max-w-none space-y-3 lg:-mt-[17px] lg:ml-[6px] lg:w-[calc(100vw-196px)] lg:max-w-none min-[1720px]:ml-[calc(866px-50vw)]">
      <SellerHero
        displayName={user.displayName}
        avatarUrl={user.avatarUrl}
        online={user.online}
        createdAt={user.createdAt}
        bannerUrl={bannerUrl}
        rating={rating}
        reviewCount={user.reviewCount}
        completedOrders={stats.completedOrders || stats.totalSales}
        tagline={tagline}
        isOwn={isOwn}
        isFavorite={isFavorite}
        favoritePending={sellerFavoriteMutation.isPending}
        onToggleFavorite={handleToggleSellerFavorite}
        messagePending={startChat.isPending}
        messageError={startChat.error}
        onMessage={handleMessage}
        onEditProfile={() => setShowEditProfile(true)}
        onEditBanner={() => setShowEditBanner(true)}
        onAvatarPick={handleAvatarPick}
        avatarUploadPending={avatarUpload.isPending}
        stats={{
          activeListings: stats.activeListings,
          completedSales: stats.completedOrders || stats.totalSales,
          successRate: stats.successRate,
          favoriteCount: stats.favoriteCount
        }}
      />

      <SellerTabs tabs={tabs} activeTab={activeTab} onSelect={setActiveTab} />

      {visibleProducts.length ? (
        <div className="overflow-hidden rounded-xl border border-line/80 bg-[#050a12] shadow-soft">
          {visibleProducts.map((product) => (
            <SellerListingRow
              key={product.id}
              product={product}
              sellerDisplayName={user.displayName}
              sellerAvatarUrl={user.avatarUrl}
              sellerRating={rating}
              sellerCreatedAt={user.createdAt}
              isFavorite={favoriteProductIds.has(product.id)}
              favoritePending={productFavoriteMutation.isPending && productFavoriteMutation.variables?.productId === product.id}
              onToggleFavorite={handleToggleProductFavorite}
            />
          ))}
        </div>
      ) : (
        <div className="app-card grid min-h-[140px] place-items-center p-6 text-center text-sm text-muted">{t("seller.noActiveOffers")}</div>
      )}

      <section className="app-card p-4">
        <h2 className="text-base font-black text-ink">{t("seller.reviews")}</h2>
        {reviews.length ? (
          <div className="mt-3 space-y-2">
            {reviews.slice(0, 5).map((review) => (
              <div key={review.id} className="rounded-lg border border-line/70 p-3">
                <div className="flex items-center justify-between gap-3 text-sm font-bold text-ink">
                  <span>{review.buyerDisplayName}</span>
                  <span className="text-action">{"★".repeat(Math.round(review.rating))}</span>
                </div>
                {review.comment ? <p className="mt-1 text-sm text-muted">{review.comment}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">{t("seller.noReviews")}</p>
        )}
      </section>

      {showEditProfile ? (
        <EditSellerProfileModal user={user} onClose={() => setShowEditProfile(false)} onSaved={handleProfileSaved} />
      ) : null}
      {showEditBanner ? (
        <EditSellerBannerModal currentBannerUrl={bannerUrl} settings={user.settings} onClose={() => setShowEditBanner(false)} onSaved={handleBannerSaved} />
      ) : null}
    </div>
  );
}
