import { describe, expect, it } from "vitest";
import {
  CATALOG_SCHEMA_STATUSES as backendCatalogSchemaStatuses,
  CATALOG_STATUSES as backendCatalogStatuses,
  DELIVERY_TYPES as backendDeliveryTypes,
  DISPUTE_DECISIONS as backendDisputeDecisions,
  DISPUTE_STATUSES as backendDisputeStatuses,
  MESSAGE_KINDS as backendMessageKinds,
  ORDER_STATUSES as backendOrderStatuses,
  PRODUCT_STATUSES as backendProductStatuses,
  PRODUCT_TYPES as backendProductTypes,
  ROLES as backendRoles
} from "../src/domain/enums.js";
import {
  bigintToMoneyCents as backendMoneyToWire,
  POSTGRES_BIGINT_MAX as backendBigintMax,
  POSTGRES_BIGINT_MIN as backendBigintMin
} from "../src/domain/money.js";
import {
  CATALOG_SCHEMA_STATUSES as sharedCatalogSchemaStatuses,
  CATALOG_STATUSES as sharedCatalogStatuses,
  DELIVERY_TYPES as sharedDeliveryTypes,
  DISPUTE_DECISIONS as sharedDisputeDecisions,
  DISPUTE_STATUSES as sharedDisputeStatuses,
  MESSAGE_KINDS as sharedMessageKinds,
  ORDER_STATUSES as sharedOrderStatuses,
  PRODUCT_STATUSES as sharedProductStatuses,
  PRODUCT_TYPES as sharedProductTypes,
  ROLES as sharedRoles
} from "../../shared/contracts/enums.js";
import {
  bigintToMoneyCents as sharedMoneyToWire,
  POSTGRES_BIGINT_MAX as sharedBigintMax,
  POSTGRES_BIGINT_MIN as sharedBigintMin
} from "../../shared/contracts/money.js";
import {
  DELIVERY_TYPES as frontendDeliveryTypes,
  DISPUTE_DECISIONS as frontendDisputeDecisions,
  DISPUTE_STATUSES as frontendDisputeStatuses,
  MESSAGE_KINDS as frontendMessageKinds,
  ORDER_STATUSES as frontendOrderStatuses,
  PRODUCT_STATUSES as frontendProductStatuses,
  PRODUCT_TYPES as frontendProductTypes,
  ROLES as frontendRoles
} from "../../frontend/lib/contracts.js";

const mirroredEnums = [
  ["roles", backendRoles, sharedRoles, frontendRoles],
  ["order statuses", backendOrderStatuses, sharedOrderStatuses, frontendOrderStatuses],
  [
    "product statuses",
    backendProductStatuses,
    sharedProductStatuses,
    frontendProductStatuses
  ],
  [
    "dispute statuses",
    backendDisputeStatuses,
    sharedDisputeStatuses,
    frontendDisputeStatuses
  ],
  ["message kinds", backendMessageKinds, sharedMessageKinds, frontendMessageKinds],
  ["delivery types", backendDeliveryTypes, sharedDeliveryTypes, frontendDeliveryTypes],
  ["product types", backendProductTypes, sharedProductTypes, frontendProductTypes],
  [
    "dispute decisions",
    backendDisputeDecisions,
    sharedDisputeDecisions,
    frontendDisputeDecisions
  ]
] as const;

describe("shared contract mirrors", () => {
  it.each(mirroredEnums)(
    "keeps %s identical across backend, shared, and frontend",
    (_name, backend, shared, frontend) => {
      expect(shared).toEqual(backend);
      expect(frontend).toEqual(backend);
    }
  );

  it("keeps backend-only catalog lifecycles in sync with shared contracts", () => {
    expect(sharedCatalogStatuses).toEqual(backendCatalogStatuses);
    expect(sharedCatalogSchemaStatuses).toEqual(backendCatalogSchemaStatuses);
  });

  it.each([
    backendBigintMin,
    -1n,
    0,
    "9007199254740993",
    backendBigintMax
  ])("serializes money identically for %s", (value) => {
    expect(sharedMoneyToWire(value)).toBe(backendMoneyToWire(value));
  });

  it("uses the same PostgreSQL bigint range", () => {
    expect(sharedBigintMin).toBe(backendBigintMin);
    expect(sharedBigintMax).toBe(backendBigintMax);
  });
});
