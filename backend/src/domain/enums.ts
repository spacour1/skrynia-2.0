/**
 * Canonical marketplace lifecycle definitions. The single source of truth shared by
 * Zod request schemas, services, and the schema-contract tests that pin the database
 * CHECK constraints to these exact sets (see test/domain-invariants.test.ts).
 *
 * Documented in docs/domain-invariants.md. Change a set only together with a
 * migration that changes the matching constraint, and vice versa.
 */

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

export const DISPUTE_STATUSES = ["open", "resolving", "resolved", "resolution_failed"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_DECISIONS = ["refund", "release"] as const;
export type DisputeDecision = (typeof DISPUTE_DECISIONS)[number];

/**
 * How a product is handed to the buyer. `service` is a ProductType, never a delivery
 * type: products have always been constrained to manual/instant at the DB level, and
 * migration 1783291000000 aligns game_sections.allowed_delivery_types with that.
 */
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

/** Lifecycle of catalog groups, games (catalog items), and game sections. */
export const CATALOG_STATUSES = ["draft", "active", "hidden", "archived", "deleted"] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/**
 * Lifecycle of versioned section schemas. Deliberately separate from CATALOG_STATUSES:
 * a schema version is never "hidden" or "deleted", it is archived when superseded.
 */
export const CATALOG_SCHEMA_STATUSES = ["draft", "active", "archived"] as const;
export type CatalogSchemaStatus = (typeof CATALOG_SCHEMA_STATUSES)[number];

export const ROLES = ["user", "moderator", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const MESSAGE_KINDS = ["user", "system"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export const isOrderStatus = (value: string): value is OrderStatus => includes(ORDER_STATUSES, value);
export const isProductStatus = (value: string): value is ProductStatus => includes(PRODUCT_STATUSES, value);
export const isDisputeStatus = (value: string): value is DisputeStatus => includes(DISPUTE_STATUSES, value);
export const isDeliveryType = (value: string): value is DeliveryType => includes(DELIVERY_TYPES, value);
export const isProductType = (value: string): value is ProductType => includes(PRODUCT_TYPES, value);
export const isCatalogStatus = (value: string): value is CatalogStatus => includes(CATALOG_STATUSES, value);
export const isRole = (value: string): value is Role => includes(ROLES, value);
