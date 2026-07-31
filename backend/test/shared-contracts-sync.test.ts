import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type * as Shared from "../../shared/contracts/index.js";
import type * as Frontend from "../../frontend/lib/contracts.js";
import {
  CATALOG_SCHEMA_STATUSES as backendCatalogSchemaStatuses,
  CATALOG_STATUSES as backendCatalogStatuses,
  CURRENCY_CODES as backendCurrencyCodes,
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
  CURRENCY_CODES as sharedCurrencyCodes,
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
  CURRENCY_CODES as frontendCurrencyCodes,
  DISPUTE_DECISIONS as frontendDisputeDecisions,
  DISPUTE_STATUSES as frontendDisputeStatuses,
  MESSAGE_KINDS as frontendMessageKinds,
  ORDER_STATUSES as frontendOrderStatuses,
  PRODUCT_STATUSES as frontendProductStatuses,
  PRODUCT_TYPES as frontendProductTypes,
  ROLES as frontendRoles
} from "../../frontend/lib/contracts.js";
import {
  mapAdminDisputeMessageDto,
  mapDisputeMessageDto,
  mapMessageDto
} from "../src/modules/chat/message.dto.js";
import {
  mapDisputeAdminDto,
  mapDisputeAdminSummaryDto,
  mapDisputeModeratorDto,
  mapDisputeModeratorSummaryDto,
  mapDisputeParticipantDto
} from "../src/modules/disputes/dispute.dto.js";
import {
  mapAdminProductDto,
  mapAdminProductMutationDto,
  mapAdminProductSummaryDto,
  mapProductCardDto,
  mapProductDetailDto,
  mapProductSuggestionDto,
  mapSellerProductDto
} from "../src/modules/marketplace/product.dto.js";
import {
  mapAdminOrderDto,
  mapAdminOrderMutationDto,
  mapAdminPendingOrderDto,
  mapOrderDetailDto,
  mapOrderMutationDto,
  mapOrderSummaryDto
} from "../src/modules/orders/orders.dto.js";
import {
  toPublicSellerDto,
  toPublicSellerStatsDto
} from "../src/modules/users/public-seller.dto.js";

type Same<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type AllTrue<T extends readonly true[]> = T;

type FrontendContractParity = AllTrue<[
  Same<Shared.AuthUserDto, Frontend.AuthUserDto>,
  Same<Shared.OrderMutationDto, Frontend.OrderMutationDto>,
  Same<Shared.OrderSummaryDto, Frontend.OrderSummaryDto>,
  Same<Shared.OrderDetailDto, Frontend.OrderDetailDto>,
  Same<Shared.AdminOrderDto, Frontend.AdminOrderDto>,
  Same<Shared.AdminOrderMutationDto, Frontend.AdminOrderMutationDto>,
  Same<Shared.AdminPendingOrderDto, Frontend.AdminPendingOrderDto>,
  Same<Shared.ProductCardDto, Frontend.ProductCardDto>,
  Same<Shared.ProductDetailDto, Frontend.ProductDetailDto>,
  Same<Shared.SellerProductDto, Frontend.SellerProductDto>,
  Same<Shared.AdminProductDto, Frontend.AdminProductDto>,
  Same<Shared.AdminProductSummaryDto, Frontend.AdminProductSummaryDto>,
  Same<Shared.AdminProductMutationDto, Frontend.AdminProductMutationDto>,
  Same<Shared.ProductSuggestionDto, Frontend.ProductSuggestionDto>,
  Same<Shared.MessageDto, Frontend.MessageDto>,
  Same<Shared.DisputeMessageDto, Frontend.DisputeMessageDto>,
  Same<Shared.AdminDisputeMessageDto, Frontend.AdminDisputeMessageDto>,
  Same<Shared.DisputeParticipantDto, Frontend.DisputeParticipantDto>,
  Same<Shared.DisputeModeratorDto, Frontend.DisputeModeratorDto>,
  Same<Shared.DisputeAdminDto, Frontend.DisputeAdminDto>,
  Same<Shared.PublicSellerDto, Frontend.PublicSellerDto>,
  Same<Shared.PublicSellerStatsDto, Frontend.PublicSellerStatsDto>
]>;

type BackendMapperParity = AllTrue<[
  Same<ReturnType<typeof mapOrderMutationDto>, Shared.OrderMutationDto>,
  Same<ReturnType<typeof mapOrderSummaryDto>, Shared.OrderSummaryDto>,
  Same<ReturnType<typeof mapOrderDetailDto>, Shared.OrderDetailDto>,
  Same<ReturnType<typeof mapAdminOrderDto>, Shared.AdminOrderDto>,
  Same<ReturnType<typeof mapAdminOrderMutationDto>, Shared.AdminOrderMutationDto>,
  Same<ReturnType<typeof mapAdminPendingOrderDto>, Shared.AdminPendingOrderDto>,
  Same<ReturnType<typeof mapProductCardDto>, Shared.ProductCardDto>,
  Same<ReturnType<typeof mapProductDetailDto>, Shared.ProductDetailDto>,
  Same<ReturnType<typeof mapSellerProductDto>, Shared.SellerProductDto>,
  Same<ReturnType<typeof mapAdminProductDto>, Shared.AdminProductDto>,
  Same<ReturnType<typeof mapAdminProductSummaryDto>, Shared.AdminProductSummaryDto>,
  Same<ReturnType<typeof mapAdminProductMutationDto>, Shared.AdminProductMutationDto>,
  Same<ReturnType<typeof mapProductSuggestionDto>, Shared.ProductSuggestionDto>,
  Same<ReturnType<typeof mapMessageDto>, Shared.MessageDto>,
  Same<ReturnType<typeof mapDisputeMessageDto>, Shared.DisputeMessageDto>,
  Same<ReturnType<typeof mapAdminDisputeMessageDto>, Shared.AdminDisputeMessageDto>,
  Same<ReturnType<typeof mapDisputeParticipantDto>, Shared.DisputeParticipantDto>,
  Same<ReturnType<typeof mapDisputeModeratorDto>, Shared.DisputeModeratorDto>,
  Same<ReturnType<typeof mapDisputeAdminDto>, Shared.DisputeAdminDto>,
  Same<ReturnType<typeof mapDisputeModeratorSummaryDto>, Shared.DisputeModeratorSummaryDto>,
  Same<ReturnType<typeof mapDisputeAdminSummaryDto>, Shared.DisputeAdminSummaryDto>,
  Same<ReturnType<typeof toPublicSellerDto>, Shared.PublicSellerDto>,
  Same<ReturnType<typeof toPublicSellerStatsDto>, Shared.PublicSellerStatsDto>
]>;

const frontendContractParity: FrontendContractParity | null = null;
const backendMapperParity: BackendMapperParity | null = null;
void frontendContractParity;
void backendMapperParity;

const mirroredEnums = [
  ["roles", backendRoles, sharedRoles, frontendRoles],
  ["currency codes", backendCurrencyCodes, sharedCurrencyCodes, frontendCurrencyCodes],
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
  it("typechecks DTO parity against the root contracts", () => {
    const backendRoot = fileURLToPath(new URL("../", import.meta.url));
    const tscPath = fileURLToPath(
      new URL("../node_modules/typescript/bin/tsc", import.meta.url)
    );
    execFileSync(
      process.execPath,
      [
        tscPath,
        "--noEmit",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--esModuleInterop",
        "--types",
        "node,vitest/globals",
        "test/shared-contracts-sync.test.ts"
      ],
      { cwd: backendRoot, stdio: "pipe" }
    );
  });

  it("maps admin list rows through explicit DTO allowlists", () => {
    const createdAt = new Date("2026-07-31T12:00:00.000Z");
    const productRow = {
      id: "product-1",
      title: "Product",
      status: "active" as const,
      priceCents: 9007199254740993n,
      currency: "UAH" as const,
      createdAt,
      categoryName: "Accounts",
      gameName: null,
      sectionName: null,
      sellerDisplayName: "Seller",
      internalSecret: "must-not-leak"
    };
    expect(mapAdminProductSummaryDto(productRow)).toEqual({
      id: "product-1",
      title: "Product",
      status: "active",
      priceCents: "9007199254740993",
      currency: "UAH",
      createdAt: createdAt.toISOString(),
      categoryName: "Accounts",
      gameName: null,
      sectionName: null,
      sellerDisplayName: "Seller"
    });
    const orderRow = {
      id: "order-1",
      amountCents: 9007199254740993n,
      currency: "UAH" as const,
      createdAt,
      productTitle: "Product",
      buyerId: "buyer-1",
      buyerDisplayName: "Buyer",
      buyerEmail: "buyer@example.test",
      sellerDisplayName: "Seller",
      internalSecret: "must-not-leak"
    };
    expect(mapAdminPendingOrderDto(orderRow)).toEqual({
      id: "order-1",
      amountCents: "9007199254740993",
      currency: "UAH",
      createdAt: createdAt.toISOString(),
      productTitle: "Product",
      buyerId: "buyer-1",
      buyerDisplayName: "Buyer",
      buyerEmail: "buyer@example.test",
      sellerDisplayName: "Seller"
    });
  });

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
