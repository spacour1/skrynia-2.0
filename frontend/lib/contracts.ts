/**
 * Browser-local mirror of the enum portion of `shared/contracts`.
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
