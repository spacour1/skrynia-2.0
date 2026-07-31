import type {
  CurrencyCode,
  DeliveryType,
  ProductStatus,
  ProductType
} from "../../domain/enums.js";
import type { MoneyCentsInput } from "../../domain/money.js";
import {
  toInteger,
  toIsoDate,
  toMoneyCents,
  toNullableMoneyCents,
  toNullableString,
  toNumber,
  type DbDate
} from "../../common/dto.js";

type ProductMediaRow = {
  id: string;
  url: string;
  type: string;
  status?: string;
  storageObjectId?: string;
};

type CardMetadataRow = {
  key: string;
  label: string;
  value: unknown;
};

export type ProductMetadataFieldRow = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: unknown[];
  min?: number;
  max?: number;
  filterable?: boolean;
  showInCard?: boolean;
  sortOrder?: number;
};

export type ProductCardRow = {
  id: string;
  title: string;
  description: string;
  priceCents: MoneyCentsInput;
  oldPriceCents?: MoneyCentsInput | null;
  currency: CurrencyCode;
  stock: number | string;
  deliveryType: DeliveryType;
  productType: ProductType;
  server?: string | null;
  platform?: string | null;
  salesCount?: number | string;
  isHot?: boolean;
  isRecommended?: boolean;
  createdAt: DbDate;
  categorySlug: string;
  categoryName: string;
  gameSlug?: string | null;
  gameName?: string | null;
  sectionId?: string | null;
  schemaVersion?: number | string | null;
  sectionSlug?: string | null;
  sectionName?: string | null;
  sellerId: string;
  sellerDisplayName: string;
  sellerRating?: number | string;
  sellerReviewCount?: number | string;
  sellerOnline?: boolean | null;
  favoriteCount?: number | string;
  media?: ProductMediaRow[] | null;
  cardMetadata?: CardMetadataRow[] | null;
};

export type ProductDetailRow = ProductCardRow & {
  status: ProductStatus;
  categoryId: string;
  gameId?: string | null;
  metadata?: Record<string, unknown> | null;
  metadataFields?: ProductMetadataFieldRow[] | null;
};

export type SellerProductRow = {
  id: string;
  title: string;
  description: string;
  priceCents: MoneyCentsInput;
  oldPriceCents?: MoneyCentsInput | null;
  currency: CurrencyCode;
  stock: number | string;
  status: ProductStatus;
  deliveryType: DeliveryType;
  productType: ProductType;
  server?: string | null;
  platform?: string | null;
  metadata?: Record<string, unknown> | null;
  schemaVersion?: number | string | null;
  sectionId?: string | null;
  categoryId: string;
  categoryName: string;
  gameId?: string | null;
  gameName?: string | null;
  sectionName?: string | null;
  salesCount?: number | string;
  isHot?: boolean;
  isRecommended?: boolean;
  createdAt: DbDate;
  media?: ProductMediaRow[] | null;
  cardMetadata?: CardMetadataRow[] | null;
};

export type AdminProductRow = SellerProductRow & {
  sellerId: string;
  sellerDisplayName: string;
  moderationReason?: string | null;
};

export type AdminProductSummaryRow = {
  id: string;
  title: string;
  status: ProductStatus;
  priceCents: MoneyCentsInput;
  currency: CurrencyCode;
  createdAt: DbDate;
  categoryName: string;
  gameName: string | null;
  sectionName: string | null;
  sellerDisplayName: string;
};

export type AdminProductMutationRow = {
  id: string;
  title: string;
  status: ProductStatus;
  isHot: boolean;
  isRecommended: boolean;
};

export type ProductSuggestionRow = {
  id: string;
  title: string;
  description: string;
  priceCents: MoneyCentsInput;
  oldPriceCents?: MoneyCentsInput | null;
  currency: CurrencyCode;
  productType: ProductType;
  deliveryType: DeliveryType;
  isHot?: boolean;
  gameSlug?: string | null;
  gameName?: string | null;
  categoryName: string;
  sellerDisplayName: string;
  media?: ProductMediaRow[] | null;
};

function mapPublicMedia(media: ProductMediaRow[] | null | undefined) {
  return Array.from(
    new Map(
      (media ?? [])
        .filter(
          (item) => item.status === undefined || item.status === "approved"
        )
        .map((item) => [item.id, item])
    ).values(),
    (item) => ({
      id: item.id,
      url: item.url,
      type: item.type
    })
  );
}

function camelKey(value: string) {
  return value.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase()
  );
}

function mapMetadataRecord(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [camelKey(key), value])
  );
}

function mapSellerMedia(media: ProductMediaRow[] | null | undefined) {
  return Array.from(
    new Map((media ?? []).map((item) => [item.id, item])).values(),
    (item) => ({
      id: item.id,
      url: item.url,
      type: item.type,
      status: item.status ?? "pending"
    })
  );
}

function mapCardMetadata(
  metadata: CardMetadataRow[] | null | undefined
) {
  return (metadata ?? []).map((item) => ({
    key: camelKey(item.key),
    label: item.label,
    value: item.value
  }));
}

function mapCardMetadataRecord(
  metadata: CardMetadataRow[] | null | undefined
) {
  return Object.fromEntries(
    mapCardMetadata(metadata).map((item) => [item.key, item.value])
  );
}

function mapMetadataFields(
  fields: ProductMetadataFieldRow[] | null | undefined
) {
  return (fields ?? []).map((field) => ({
    key: camelKey(field.key),
    label: field.label,
    type: field.type,
    required: field.required ?? false,
    placeholder: field.placeholder ?? null,
    helpText: field.helpText ?? null,
    options: Array.isArray(field.options) ? [...field.options] : [],
    min: field.min ?? null,
    max: field.max ?? null,
    filterable: field.filterable ?? false,
    showInCard: field.showInCard ?? false,
    sortOrder: field.sortOrder ?? 0
  }));
}

function mapValidatedMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fields: ProductMetadataFieldRow[] | null | undefined
) {
  const source = metadata ?? {};
  // Only schema-declared keys may cross the public boundary. Legacy sectionless lots
  // have no historical allowlist, so their arbitrary metadata stays private.
  if (!fields?.length) return {};
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(source, field.key))
      .map((field) => [camelKey(field.key), source[field.key]])
  );
}

export function mapProductCardDto(row: ProductCardRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceCents: toMoneyCents(row.priceCents),
    oldPriceCents: toNullableMoneyCents(row.oldPriceCents),
    currency: row.currency,
    stock: toInteger(row.stock),
    deliveryType: row.deliveryType,
    productType: row.productType,
    server: toNullableString(row.server),
    platform: toNullableString(row.platform),
    salesCount: toInteger(row.salesCount ?? 0),
    isHot: row.isHot ?? false,
    isRecommended: row.isRecommended ?? false,
    createdAt: toIsoDate(row.createdAt),
    categorySlug: row.categorySlug,
    categoryName: row.categoryName,
    gameSlug: toNullableString(row.gameSlug),
    gameName: toNullableString(row.gameName),
    sectionId: toNullableString(row.sectionId),
    sectionSlug: toNullableString(row.sectionSlug),
    sectionName: toNullableString(row.sectionName),
    sellerId: row.sellerId,
    sellerDisplayName: row.sellerDisplayName,
    sellerRating: toNumber(row.sellerRating ?? 0),
    sellerReviewCount: toInteger(row.sellerReviewCount ?? 0),
    sellerOnline: row.sellerOnline ?? null,
    favoriteCount: toInteger(row.favoriteCount ?? 0),
    media: mapPublicMedia(row.media),
    // Cards expose only fields selected by the historical schema's showInCard
    // allowlist. The raw metadata object may contain private/non-display fields.
    metadata: mapCardMetadataRecord(row.cardMetadata),
    cardMetadata: mapCardMetadata(row.cardMetadata)
  };
}

export function mapProductDetailDto(row: ProductDetailRow) {
  const fields = mapMetadataFields(row.metadataFields);
  return {
    ...mapProductCardDto(row),
    status: row.status,
    categoryId: row.categoryId,
    gameId: toNullableString(row.gameId),
    schemaVersion:
      row.schemaVersion == null ? null : toInteger(row.schemaVersion),
    metadata: mapValidatedMetadata(row.metadata, row.metadataFields),
    metadataFields: fields
  };
}

export function mapSellerProductDto(row: SellerProductRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceCents: toMoneyCents(row.priceCents),
    oldPriceCents: toNullableMoneyCents(row.oldPriceCents),
    currency: row.currency,
    stock: toInteger(row.stock),
    status: row.status,
    deliveryType: row.deliveryType,
    productType: row.productType,
    server: toNullableString(row.server),
    platform: toNullableString(row.platform),
    metadata: mapMetadataRecord(row.metadata ?? {}),
    schemaVersion:
      row.schemaVersion == null ? null : toInteger(row.schemaVersion),
    sectionId: toNullableString(row.sectionId),
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    gameId: toNullableString(row.gameId),
    gameName: toNullableString(row.gameName),
    sectionName: toNullableString(row.sectionName),
    salesCount: toInteger(row.salesCount ?? 0),
    isHot: row.isHot ?? false,
    isRecommended: row.isRecommended ?? false,
    createdAt: toIsoDate(row.createdAt),
    media: mapSellerMedia(row.media),
    cardMetadata: mapCardMetadata(row.cardMetadata)
  };
}

export function mapAdminProductDto(row: AdminProductRow) {
  return {
    ...mapSellerProductDto(row),
    sellerId: row.sellerId,
    sellerDisplayName: row.sellerDisplayName,
    moderationReason: toNullableString(row.moderationReason)
  };
}

export function mapAdminProductSummaryDto(row: AdminProductSummaryRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priceCents: toMoneyCents(row.priceCents),
    currency: row.currency,
    createdAt: toIsoDate(row.createdAt),
    categoryName: row.categoryName,
    gameName: row.gameName,
    sectionName: row.sectionName,
    sellerDisplayName: row.sellerDisplayName
  };
}

export function mapAdminProductMutationDto(row: AdminProductMutationRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    isHot: row.isHot,
    isRecommended: row.isRecommended
  };
}

export function mapProductSuggestionDto(row: ProductSuggestionRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceCents: toMoneyCents(row.priceCents),
    oldPriceCents: toNullableMoneyCents(row.oldPriceCents),
    currency: row.currency,
    productType: row.productType,
    deliveryType: row.deliveryType,
    isHot: row.isHot ?? false,
    gameSlug: toNullableString(row.gameSlug),
    gameName: toNullableString(row.gameName),
    categoryName: row.categoryName,
    sellerDisplayName: row.sellerDisplayName,
    media: mapPublicMedia(row.media)
  };
}
