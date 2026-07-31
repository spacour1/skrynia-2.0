import { describe, expect, it } from "vitest";
import {
  mapAdminDisputeMessageDto,
  mapDisputeMessageDto,
  mapMessageDto
} from "../src/modules/chat/message.dto.js";
import {
  mapAdminProductDto,
  mapProductCardDto,
  mapProductDetailDto,
  mapProductSuggestionDto,
  mapSellerProductDto
} from "../src/modules/marketplace/product.dto.js";
import {
  mapAdminOrderDto,
  mapOrderDetailDto
} from "../src/modules/orders/orders.dto.js";
import {
  mapDisputeAdminDto,
  mapDisputeAdminSummaryDto,
  mapDisputeModeratorDto,
  mapDisputeModeratorSummaryDto,
  mapDisputeParticipantDto
} from "../src/modules/disputes/dispute.dto.js";

const createdAt = new Date("2026-07-20T10:20:30.000Z");

const messageRow = {
  id: "message-1",
  conversationId: "conversation-1",
  senderId: "user-1",
  clientMessageId: "client-1",
  senderDisplayName: "Buyer",
  body: "Hello",
  attachmentUrl: "/media/public.webp",
  attachmentStorageObjectId: "private-storage-object",
  createdAt,
  hidden: false,
  kind: "system" as const,
  systemType: "order_created",
  metadata: {
    bodyKey: "system.orderCreated",
    params: { quantity: 1 },
    internalTrace: "must-not-leak"
  },
  internalSecret: "must-not-leak"
};

const disputeMessageRow = {
  id: "dispute-message-1",
  disputeId: "dispute-1",
  authorId: "user-1",
  authorDisplayName: "Buyer",
  authorRole: "user" as const,
  body: "Evidence",
  attachmentUrl: null,
  attachmentStorageObjectId: "private-storage-object",
  hiddenAt: createdAt,
  hiddenBy: "admin-1",
  moderationReason: "Private moderation reason",
  createdAt,
  internalSecret: "must-not-leak"
};

const disputeRow = {
  id: "dispute-1",
  orderId: "order-1",
  openedBy: "buyer-1",
  reason: "The delivered credentials do not work",
  status: "resolution_failed" as const,
  resolution: null,
  resolutionDecision: "refund" as const,
  resolutionOperationId: "operation-1",
  resolvingStartedAt: createdAt,
  resolutionAttempts: "2",
  lastResolutionError: "private recovery failure",
  adminId: "admin-1",
  adminNote: "private admin note",
  createdAt,
  resolvedAt: null,
  buyerId: "buyer-1",
  sellerId: "seller-1",
  amountCents: 9_007_199_254_740_993n,
  currency: "UAH",
  orderStatus: "disputed" as const,
  productTitle: "Product",
  buyerDisplayName: "Buyer",
  sellerDisplayName: "Seller",
  conversationId: "internal-conversation-1",
  internalSecret: "must-not-leak"
};

const cardRow = {
  id: "product-1",
  title: "Product",
  description: "Description",
  priceCents: 9_007_199_254_740_993n,
  oldPriceCents: "9007199254740994",
  currency: "UAH",
  stock: "2",
  deliveryType: "manual" as const,
  productType: "account" as const,
  server: null,
  platform: "PC",
  salesCount: "3",
  isHot: true,
  isRecommended: false,
  createdAt,
  categorySlug: "accounts",
  categoryName: "Accounts",
  gameSlug: "game",
  gameName: "Game",
  sectionId: "section-1",
  sectionSlug: "ranked",
  sectionName: "Ranked",
  sellerId: "seller-1",
  sellerDisplayName: "Seller",
  sellerRating: "4.5",
  sellerReviewCount: "7",
  sellerOnline: null,
  favoriteCount: "8",
  media: [
    {
      id: "media-1",
      url: "/media/one.webp",
      type: "image",
      status: "approved",
      storageObjectId: "private-media-object"
    },
    {
      id: "media-1",
      url: "/media/one.webp",
      type: "image",
      status: "approved",
      storageObjectId: "duplicate-private-media-object"
    },
    {
      id: "media-2",
      url: "/media/rejected.webp",
      type: "image",
      status: "rejected",
      storageObjectId: "private-rejected-media-object"
    }
  ],
  cardMetadata: [{ key: "account_rank", label: "Rank", value: "Gold" }],
  metadata: { account_rank: "Gold", private_note: "no" },
  schemaVersion: 2,
  sellerIsBanned: true,
  internalSecret: "must-not-leak"
};

const detailRow = {
  ...cardRow,
  status: "active" as const,
  categoryId: "category-1",
  gameId: "game-1",
  metadataFields: [
    {
      key: "account_rank",
      label: "Rank",
      type: "select",
      required: true,
      options: ["Gold", "Silver"],
      showInCard: true
    }
  ]
};

const sellerRow = {
  id: "product-1",
  title: "Product",
  description: "Description",
  priceCents: 5000n,
  oldPriceCents: null,
  currency: "UAH",
  stock: "4",
  status: "paused" as const,
  deliveryType: "instant" as const,
  productType: "key" as const,
  server: null,
  platform: null,
  metadata: { activation_region: "EU" },
  schemaVersion: "3",
  sectionId: "section-1",
  categoryId: "category-1",
  categoryName: "Keys",
  gameId: "game-1",
  gameName: "Game",
  sectionName: "Keys",
  salesCount: "2",
  isHot: false,
  isRecommended: true,
  createdAt,
  media: [
    {
      id: "media-1",
      url: "/media/one.webp",
      type: "image",
      status: "rejected",
      storageObjectId: "private-media-object"
    }
  ],
  cardMetadata: [
    { key: "activation_region", label: "Region", value: "EU" }
  ],
  deliveryTemplate: "private fulfillment secret",
  internalSecret: "must-not-leak"
};

const suggestionRow = {
  id: "product-1",
  title: "Product",
  description: "Description",
  priceCents: 5000n,
  oldPriceCents: null,
  currency: "UAH",
  productType: "key" as const,
  deliveryType: "instant" as const,
  isHot: true,
  gameSlug: "game",
  gameName: "Game",
  categoryName: "Keys",
  sellerDisplayName: "Seller",
  media: [
    {
      id: "media-1",
      url: "/media/one.webp",
      type: "image",
      storageObjectId: "private-media-object"
    }
  ],
  searchRelevanceTier: 0,
  internalSecret: "must-not-leak"
};

const orderRow = {
  id: "order-1",
  buyer_id: "buyer-1",
  seller_id: "seller-1",
  product_id: "product-1",
  quantity: 1,
  amount_cents: 5000n,
  fee_cents: 500n,
  currency: "UAH",
  status: "paid",
  payment_provider: "mock",
  payment_reference: "provider-secret-reference",
  delivery_note: null,
  auto_release_at: null,
  paid_at: createdAt,
  delivered_at: null,
  completed_at: null,
  created_at: createdAt,
  updated_at: createdAt,
  internal_secret: "must-not-leak"
};

const cases = [
  {
    name: "message",
    map: mapMessageDto,
    row: messageRow,
    keys: [
      "attachmentUrl",
      "body",
      "clientMessageId",
      "conversationId",
      "createdAt",
      "hidden",
      "id",
      "kind",
      "metadata",
      "senderDisplayName",
      "senderId",
      "systemType"
    ]
  },
  {
    name: "participant dispute message",
    map: mapDisputeMessageDto,
    row: disputeMessageRow,
    keys: [
      "attachmentUrl",
      "authorDisplayName",
      "authorId",
      "authorRole",
      "body",
      "createdAt",
      "disputeId",
      "id"
    ]
  },
  {
    name: "admin dispute message",
    map: mapAdminDisputeMessageDto,
    row: disputeMessageRow,
    keys: [
      "attachmentUrl",
      "authorDisplayName",
      "authorId",
      "authorRole",
      "body",
      "createdAt",
      "disputeId",
      "hiddenAt",
      "hiddenBy",
      "id",
      "moderationReason"
    ]
  },
  {
    name: "participant dispute",
    map: mapDisputeParticipantDto,
    row: disputeRow,
    keys: [
      "createdAt",
      "id",
      "openedBy",
      "orderId",
      "reason",
      "resolution",
      "resolutionDecision",
      "resolvedAt",
      "status"
    ]
  },
  {
    name: "moderator dispute",
    map: mapDisputeModeratorDto,
    row: disputeRow,
    keys: [
      "amountCents",
      "createdAt",
      "currency",
      "id",
      "openedBy",
      "orderId",
      "orderStatus",
      "productTitle",
      "reason",
      "resolution",
      "resolutionDecision",
      "resolvedAt",
      "status"
    ]
  },
  {
    name: "admin dispute",
    map: mapDisputeAdminDto,
    row: disputeRow,
    keys: [
      "adminId",
      "adminNote",
      "amountCents",
      "buyerId",
      "createdAt",
      "currency",
      "id",
      "lastResolutionError",
      "openedBy",
      "orderId",
      "orderStatus",
      "productTitle",
      "reason",
      "resolution",
      "resolutionAttempts",
      "resolutionDecision",
      "resolutionOperationId",
      "resolvedAt",
      "resolvingStartedAt",
      "sellerId",
      "status"
    ]
  },
  {
    name: "moderator dispute summary",
    map: mapDisputeModeratorSummaryDto,
    row: disputeRow,
    keys: [
      "amountCents",
      "buyerDisplayName",
      "createdAt",
      "currency",
      "id",
      "openedBy",
      "orderId",
      "orderStatus",
      "productTitle",
      "reason",
      "resolution",
      "resolutionDecision",
      "resolvedAt",
      "sellerDisplayName",
      "status"
    ]
  },
  {
    name: "admin dispute summary",
    map: mapDisputeAdminSummaryDto,
    row: disputeRow,
    keys: [
      "adminId",
      "adminNote",
      "amountCents",
      "buyerDisplayName",
      "buyerId",
      "createdAt",
      "currency",
      "id",
      "lastResolutionError",
      "openedBy",
      "orderId",
      "orderStatus",
      "productTitle",
      "reason",
      "resolution",
      "resolutionAttempts",
      "resolutionDecision",
      "resolutionOperationId",
      "resolvedAt",
      "resolvingStartedAt",
      "sellerDisplayName",
      "sellerId",
      "status"
    ]
  },
  {
    name: "product card",
    map: mapProductCardDto,
    row: cardRow,
    keys: [
      "cardMetadata",
      "categoryName",
      "categorySlug",
      "createdAt",
      "currency",
      "deliveryType",
      "description",
      "favoriteCount",
      "gameName",
      "gameSlug",
      "id",
      "isHot",
      "isRecommended",
      "media",
      "metadata",
      "oldPriceCents",
      "platform",
      "priceCents",
      "productType",
      "salesCount",
      "sectionId",
      "sectionName",
      "sectionSlug",
      "sellerDisplayName",
      "sellerId",
      "sellerOnline",
      "sellerRating",
      "sellerReviewCount",
      "server",
      "stock",
      "title"
    ]
  },
  {
    name: "product detail",
    map: mapProductDetailDto,
    row: detailRow,
    keys: [
      "cardMetadata",
      "categoryId",
      "categoryName",
      "categorySlug",
      "createdAt",
      "currency",
      "deliveryType",
      "description",
      "favoriteCount",
      "gameId",
      "gameName",
      "gameSlug",
      "id",
      "isHot",
      "isRecommended",
      "media",
      "metadata",
      "metadataFields",
      "oldPriceCents",
      "platform",
      "priceCents",
      "productType",
      "salesCount",
      "schemaVersion",
      "sectionId",
      "sectionName",
      "sectionSlug",
      "sellerDisplayName",
      "sellerId",
      "sellerOnline",
      "sellerRating",
      "sellerReviewCount",
      "server",
      "status",
      "stock",
      "title"
    ]
  },
  {
    name: "seller product",
    map: mapSellerProductDto,
    row: sellerRow,
    keys: [
      "cardMetadata",
      "categoryId",
      "categoryName",
      "createdAt",
      "currency",
      "deliveryType",
      "description",
      "gameId",
      "gameName",
      "id",
      "isHot",
      "isRecommended",
      "media",
      "metadata",
      "oldPriceCents",
      "platform",
      "priceCents",
      "productType",
      "salesCount",
      "schemaVersion",
      "sectionId",
      "sectionName",
      "server",
      "status",
      "stock",
      "title"
    ]
  },
  {
    name: "admin product",
    map: mapAdminProductDto,
    row: {
      ...sellerRow,
      sellerId: "seller-1",
      sellerDisplayName: "Seller",
      moderationReason: "Requires review"
    },
    keys: [
      "cardMetadata",
      "categoryId",
      "categoryName",
      "createdAt",
      "currency",
      "deliveryType",
      "description",
      "gameId",
      "gameName",
      "id",
      "isHot",
      "isRecommended",
      "media",
      "metadata",
      "moderationReason",
      "oldPriceCents",
      "platform",
      "priceCents",
      "productType",
      "salesCount",
      "schemaVersion",
      "sectionId",
      "sectionName",
      "sellerDisplayName",
      "sellerId",
      "server",
      "status",
      "stock",
      "title"
    ]
  },
  {
    name: "product suggestion",
    map: mapProductSuggestionDto,
    row: suggestionRow,
    keys: [
      "categoryName",
      "currency",
      "deliveryType",
      "description",
      "gameName",
      "gameSlug",
      "id",
      "isHot",
      "media",
      "oldPriceCents",
      "priceCents",
      "productType",
      "sellerDisplayName",
      "title"
    ]
  },
  {
    name: "participant order",
    map: mapOrderDetailDto,
    row: orderRow,
    keys: [
      "amountCents",
      "autoReleaseAt",
      "buyerId",
      "completedAt",
      "createdAt",
      "currency",
      "deliveredAt",
      "deliveryNote",
      "feeCents",
      "id",
      "paidAt",
      "productId",
      "quantity",
      "sellerId",
      "status",
      "updatedAt"
    ]
  },
  {
    name: "admin order",
    map: mapAdminOrderDto,
    row: orderRow,
    keys: [
      "amountCents",
      "autoReleaseAt",
      "buyerId",
      "completedAt",
      "createdAt",
      "currency",
      "deliveredAt",
      "deliveryNote",
      "feeCents",
      "id",
      "paidAt",
      "paymentProvider",
      "paymentReference",
      "productId",
      "quantity",
      "sellerId",
      "status",
      "updatedAt"
    ]
  }
] as const;

function assertNoSnakeCaseKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSnakeCaseKeys(item, `${path}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== "object" || value instanceof Date) return;
  for (const [key, nested] of Object.entries(value)) {
    expect(key, `unexpected snake_case key at ${path}.${key}`).not.toMatch(/_/u);
    assertNoSnakeCaseKeys(nested, `${path}.${key}`);
  }
}

describe.each(cases)("$name DTO mapper", ({ map, row, keys }) => {
  it("emits an explicit JSON-safe allowlist without mutating the DB row", () => {
    const snapshot = structuredClone(row);
    const dto = (map as (value: never) => Record<string, unknown>)(row as never);

    expect(Object.keys(dto).sort()).toEqual([...keys].sort());
    expect(row).toEqual(snapshot);
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(JSON.stringify(dto)).not.toContain("must-not-leak");
    expect(JSON.stringify(dto)).not.toContain("private-storage-object");
    assertNoSnakeCaseKeys(dto);
  });
});

describe("nested DTO rules", () => {
  it("sanitizes system metadata and public media", () => {
    const message = mapMessageDto(messageRow);
    expect(message.metadata).toEqual({
      bodyKey: "system.orderCreated",
      params: { quantity: 1 }
    });

    const product = mapProductCardDto(cardRow);
    expect(product.media).toEqual([
      { id: "media-1", url: "/media/one.webp", type: "image" }
    ]);
    expect(product.cardMetadata).toEqual([
      { key: "accountRank", label: "Rank", value: "Gold" }
    ]);
    expect(product.metadata).toEqual({ accountRank: "Gold" });
    expect(product.priceCents).toBe("9007199254740993");
    expect(product.createdAt).toBe(createdAt.toISOString());
  });

  it("exposes only historical schema metadata for schema-backed products", () => {
    const detail = mapProductDetailDto(detailRow);
    expect(detail.metadata).toEqual({ accountRank: "Gold" });
    expect(detail.metadataFields[0]).toMatchObject({
      key: "accountRank",
      label: "Rank",
      required: true
    });
  });

  it("does not expose arbitrary legacy metadata when no schema allowlist exists", () => {
    const detail = mapProductDetailDto({
      ...detailRow,
      metadata: { activation_region: "EU" },
      metadataFields: []
    });
    expect(detail.metadata).toEqual({});
  });

  it("keeps moderation data admin-only", () => {
    expect(mapDisputeMessageDto(disputeMessageRow)).not.toHaveProperty("hiddenAt");
    expect(mapAdminDisputeMessageDto(disputeMessageRow)).toMatchObject({
      hiddenAt: createdAt.toISOString(),
      hiddenBy: "admin-1",
      moderationReason: "Private moderation reason"
    });
  });

  it("keeps dispute recovery and audit data admin-only", () => {
    const participant = mapDisputeParticipantDto(disputeRow);
    const moderator = mapDisputeModeratorDto(disputeRow);
    const admin = mapDisputeAdminDto(disputeRow);

    for (const dto of [participant, moderator]) {
      expect(dto).not.toHaveProperty("resolutionOperationId");
      expect(dto).not.toHaveProperty("resolvingStartedAt");
      expect(dto).not.toHaveProperty("resolutionAttempts");
      expect(dto).not.toHaveProperty("lastResolutionError");
      expect(dto).not.toHaveProperty("adminId");
      expect(dto).not.toHaveProperty("adminNote");
      expect(dto).not.toHaveProperty("conversationId");
    }
    expect(admin).toMatchObject({
      amountCents: "9007199254740993",
      resolvingStartedAt: createdAt.toISOString(),
      resolutionAttempts: 2,
      lastResolutionError: "private recovery failure",
      adminId: "admin-1",
      adminNote: "private admin note"
    });
    expect(admin.createdAt).toBe(createdAt.toISOString());
    expect(admin.resolvedAt).toBeNull();
    expect(admin).not.toHaveProperty("conversationId");
  });

  it("keeps payment identifiers admin-only", () => {
    expect(mapOrderDetailDto(orderRow)).not.toHaveProperty("paymentProvider");
    expect(mapOrderDetailDto(orderRow)).not.toHaveProperty("paymentReference");
    expect(mapAdminOrderDto(orderRow)).toMatchObject({
      paymentProvider: "mock",
      paymentReference: "provider-secret-reference"
    });
  });
});
