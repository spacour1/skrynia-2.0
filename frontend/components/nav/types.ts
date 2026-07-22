import type { WireMoneyCents } from "@/lib/currency";

export type SuggestProduct = {
  id: string;
  title: string;
  description: string;
  priceCents: WireMoneyCents;
  currency: string;
  productType?: string;
  deliveryType?: string;
  metadata?: Record<string, unknown>;
  media?: { id: string; url: string; type: string }[];
  isHot?: boolean;
  oldPriceCents?: WireMoneyCents | null;
  gameSlug?: string;
  gameName?: string;
  categoryName?: string;
  sellerDisplayName?: string;
};

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  titleKey?: string | null;
  bodyKey?: string | null;
  params?: Record<string, string | number> | null;
  orderId?: string | null;
  productId?: string | null;
  conversationId?: string | null;
  readAt?: string | null;
  createdAt: string;
};
