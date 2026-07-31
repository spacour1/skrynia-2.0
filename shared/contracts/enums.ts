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

export const PRODUCT_STATUSES = ["active", "paused", "blocked", "deleted"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// `resolving` and `resolution_failed` are recovery-significant states. They remain
// visible to staff contracts even though participant contracts hide recovery metadata.
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

export const CATALOG_STATUSES = [
  "draft",
  "active",
  "hidden",
  "archived",
  "deleted"
] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const CATALOG_SCHEMA_STATUSES = ["draft", "active", "archived"] as const;
export type CatalogSchemaStatus = (typeof CATALOG_SCHEMA_STATUSES)[number];

export const DISPUTE_DECISIONS = ["refund", "release"] as const;
export type DisputeDecision = (typeof DISPUTE_DECISIONS)[number];

export const CURRENCY_CODES = ["UAH", "USD", "EUR"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

function includes<T extends string>(
  values: readonly T[],
  value: string
): value is T {
  return (values as readonly string[]).includes(value);
}

export const isRole = (value: string): value is Role => includes(ROLES, value);
export const isOrderStatus = (value: string): value is OrderStatus =>
  includes(ORDER_STATUSES, value);
export const isProductStatus = (value: string): value is ProductStatus =>
  includes(PRODUCT_STATUSES, value);
export const isDisputeStatus = (value: string): value is DisputeStatus =>
  includes(DISPUTE_STATUSES, value);
export const isMessageKind = (value: string): value is MessageKind =>
  includes(MESSAGE_KINDS, value);
export const isDeliveryType = (value: string): value is DeliveryType =>
  includes(DELIVERY_TYPES, value);
export const isProductType = (value: string): value is ProductType =>
  includes(PRODUCT_TYPES, value);
export const isCatalogStatus = (value: string): value is CatalogStatus =>
  includes(CATALOG_STATUSES, value);
export const isCurrencyCode = (value: string): value is CurrencyCode =>
  includes(CURRENCY_CODES, value);
