/**
 * Browser-local mirror of the public wire contracts in `shared/contracts`.
 *
 * Production Docker builds intentionally use `frontend/` as their isolated build
 * context, so importing a file from the repository root would make the image build
 * depend on files outside that context. The backend contract-sync test pins this
 * mirror to both the root contracts and backend domain enums.
 */
export const ROLES = ["user", "moderator", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "in_progress",
  "delivered",
  "disputed",
  "completed",
  "refunded",
  "canceled"
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PRODUCT_STATUSES = [
  "active",
  "paused",
  "blocked",
  "deleted"
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const DISPUTE_STATUSES = [
  "open",
  "resolving",
  "resolved",
  "resolution_failed"
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const MESSAGE_KINDS = ["user", "system"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const DELIVERY_TYPES = ["manual", "instant"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const PRODUCT_TYPES = [
  "account",
  "key",
  "topup",
  "boosting",
  "service",
  "item",
  "currency"
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const DISPUTE_DECISIONS = ["refund", "release"] as const;
export type DisputeDecision = (typeof DISPUTE_DECISIONS)[number];

export const CURRENCY_CODES = ["UAH", "USD", "EUR"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export type IsoDateString = string;
export type MoneyCents = string;

export type AuthUserDto = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  avatarUrl: string | null;
  pushEnabled: boolean;
  twoFactorEnabled: boolean;
  createdAt: IsoDateString;
  online: boolean | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  telegramConnected: boolean;
};

export type OrderMutationDto = {
  id: string;
  status: OrderStatus;
  productId: string;
  buyerId: string;
  sellerId: string;
  quantity: number;
  amountCents: MoneyCents;
  feeCents: MoneyCents;
  currency: CurrencyCode;
  deliveryNote: string | null;
  autoReleaseAt: IsoDateString | null;
  paidAt: IsoDateString | null;
  deliveredAt: IsoDateString | null;
  completedAt: IsoDateString | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type OrderSummaryDto = {
  id: string;
  status: OrderStatus;
  productId: string;
  productTitle: string;
  buyerId: string;
  buyerDisplayName: string;
  buyerAvatarUrl: string | null;
  sellerId: string;
  sellerDisplayName: string;
  sellerAvatarUrl: string | null;
  quantity: number;
  amountCents: MoneyCents;
  feeCents: MoneyCents;
  currency: CurrencyCode;
  createdAt: IsoDateString;
  paidAt: IsoDateString | null;
  deliveredAt: IsoDateString | null;
  autoReleaseAt: IsoDateString | null;
};

export type OrderDetailDto = OrderSummaryDto & {
  productDescription: string;
  deliveryNote: string | null;
  completedAt: IsoDateString | null;
  updatedAt: IsoDateString;
};

export type AdminOrderDto = OrderDetailDto & {
  paymentProvider: string | null;
  paymentReference: string | null;
};

export type AdminOrderMutationDto = OrderMutationDto & {
  paymentProvider: string | null;
  paymentReference: string | null;
};

export type AdminPendingOrderDto = {
  id: string;
  amountCents: MoneyCents;
  currency: CurrencyCode;
  createdAt: IsoDateString;
  productTitle: string;
  buyerId: string;
  buyerDisplayName: string;
  buyerEmail: string;
  sellerDisplayName: string;
};

export type ProductMediaDto = { id: string; url: string; type: string };
export type ProductCardMetadataDto = { key: string; label: string; value: unknown };

export type ProductCardDto = {
  id: string;
  title: string;
  description: string;
  priceCents: MoneyCents;
  oldPriceCents: MoneyCents | null;
  currency: CurrencyCode;
  stock: number;
  deliveryType: DeliveryType;
  productType: ProductType;
  server: string | null;
  platform: string | null;
  salesCount: number;
  isHot: boolean;
  isRecommended: boolean;
  createdAt: IsoDateString;
  categorySlug: string;
  categoryName: string;
  gameSlug: string | null;
  gameName: string | null;
  sectionId: string | null;
  sectionSlug: string | null;
  sectionName: string | null;
  sellerId: string;
  sellerDisplayName: string;
  sellerRating: number;
  sellerReviewCount: number;
  sellerOnline: boolean | null;
  favoriteCount: number;
  media: ProductMediaDto[];
  metadata: Record<string, unknown>;
  cardMetadata: ProductCardMetadataDto[];
};

export type ProductMetadataFieldDto = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder: string | null;
  helpText: string | null;
  options: unknown[];
  min: number | null;
  max: number | null;
  filterable: boolean;
  showInCard: boolean;
  sortOrder: number;
};

export type ProductDetailDto = ProductCardDto & {
  status: ProductStatus;
  categoryId: string;
  gameId: string | null;
  schemaVersion: number | null;
  metadata: Record<string, unknown>;
  metadataFields: ProductMetadataFieldDto[];
};

export type SellerProductMediaDto = ProductMediaDto & { status: string };
export type SellerProductDto = {
  id: string;
  title: string;
  description: string;
  priceCents: MoneyCents;
  oldPriceCents: MoneyCents | null;
  currency: CurrencyCode;
  stock: number;
  status: ProductStatus;
  deliveryType: DeliveryType;
  productType: ProductType;
  server: string | null;
  platform: string | null;
  metadata: Record<string, unknown>;
  schemaVersion: number | null;
  sectionId: string | null;
  categoryId: string;
  categoryName: string;
  gameId: string | null;
  gameName: string | null;
  sectionName: string | null;
  salesCount: number;
  isHot: boolean;
  isRecommended: boolean;
  createdAt: IsoDateString;
  media: SellerProductMediaDto[];
  cardMetadata: ProductCardMetadataDto[];
};

export type AdminProductDto = SellerProductDto & {
  sellerId: string;
  sellerDisplayName: string;
  moderationReason: string | null;
};

export type AdminProductSummaryDto = {
  id: string;
  title: string;
  status: ProductStatus;
  priceCents: MoneyCents;
  currency: CurrencyCode;
  createdAt: IsoDateString;
  categoryName: string;
  gameName: string | null;
  sectionName: string | null;
  sellerDisplayName: string;
};

export type AdminProductMutationDto = {
  id: string;
  title: string;
  status: ProductStatus;
  isHot: boolean;
  isRecommended: boolean;
};

export type ProductSuggestionDto = {
  id: string;
  title: string;
  description: string;
  priceCents: MoneyCents;
  oldPriceCents: MoneyCents | null;
  currency: CurrencyCode;
  productType: ProductType;
  deliveryType: DeliveryType;
  isHot: boolean;
  gameSlug: string | null;
  gameName: string | null;
  categoryName: string;
  sellerDisplayName: string;
  media: ProductMediaDto[];
};

export type MessageDto = {
  id: string;
  conversationId: string;
  clientMessageId: string | null;
  senderId: string | null;
  senderDisplayName: string;
  kind: MessageKind;
  systemType: string | null;
  body: string;
  attachmentUrl: string | null;
  createdAt: IsoDateString;
  hidden: boolean;
  metadata: Record<string, unknown> | null;
};

export type DisputeMessageDto = {
  id: string;
  disputeId: string;
  authorId: string;
  authorDisplayName: string;
  authorRole: Role;
  body: string;
  attachmentUrl: string | null;
  createdAt: IsoDateString;
};

export type AdminDisputeMessageDto = DisputeMessageDto & {
  hiddenAt: IsoDateString | null;
  hiddenBy: string | null;
  moderationReason: string | null;
};

export type DisputeParticipantDto = {
  id: string;
  orderId: string;
  openedBy: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  resolutionDecision: DisputeDecision | null;
  createdAt: IsoDateString;
  resolvedAt: IsoDateString | null;
};

export type DisputeModeratorDto = DisputeParticipantDto & {
  amountCents: MoneyCents;
  currency: CurrencyCode;
  orderStatus: OrderStatus;
  productTitle: string;
};

export type DisputeAdminDto = DisputeParticipantDto & {
  resolutionOperationId: string | null;
  resolvingStartedAt: IsoDateString | null;
  resolutionAttempts: number;
  lastResolutionError: string | null;
  adminId: string | null;
  adminNote: string | null;
  buyerId: string;
  sellerId: string;
  amountCents: MoneyCents;
  currency: CurrencyCode;
  orderStatus: OrderStatus;
  productTitle: string;
};

export type DisputeModeratorSummaryDto = DisputeModeratorDto & {
  buyerDisplayName: string;
  sellerDisplayName: string;
};

export type DisputeAdminSummaryDto = DisputeAdminDto & {
  buyerDisplayName: string;
  sellerDisplayName: string;
};

export type PublicSellerDto = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: IsoDateString;
  ratingAverage: number;
  reviewCount: number;
  online: boolean | null;
};

export type PublicSellerStatsDto = {
  activeListings: number;
  totalSales: number;
  favoriteCount: number;
  activeOrders: number;
  completedOrders: number;
  disputedOrders: number;
  refundedOrders: number;
  completedRevenueCents: MoneyCents;
  successRate: number | null;
  hasEnoughData: boolean;
};
