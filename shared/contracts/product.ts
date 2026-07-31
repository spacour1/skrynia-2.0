import type { IsoDateString } from "./common.js";
import type {
  CurrencyCode,
  DeliveryType,
  ProductStatus,
  ProductType
} from "./enums.js";
import type { MoneyCents } from "./money.js";

export type ProductMediaDto = {
  id: string;
  url: string;
  type: string;
};

export type ProductCardMetadataDto = {
  key: string;
  label: string;
  value: unknown;
};

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
  /** Schema-approved showInCard values only; never the raw product metadata row. */
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

export type SellerProductMediaDto = ProductMediaDto & {
  status: string;
};

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
