import {
  bigintToMoneyCents,
  type MoneyCentsInput
} from "../../domain/money.js";
import type { CurrencyCode, OrderStatus } from "../../domain/enums.js";

/**
 * Order mutations use raw `orders` rows internally so transaction code can keep matching
 * PostgreSQL column names. Payment identifiers are deliberately absent from the
 * participant row type and are added only by the admin mapper.
 */
export type RawParticipantOrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  quantity: number;
  amount_cents: MoneyCentsInput;
  fee_cents: MoneyCentsInput;
  currency: CurrencyCode;
  status: OrderStatus;
  delivery_note: string | null;
  auto_release_at: Date | string | null;
  paid_at: Date | string | null;
  delivered_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type RawOrderDetailRow = RawParticipantOrderRow & {
  product_title: string;
  product_description: string;
  buyer_display_name: string;
  buyer_avatar_url: string | null;
  seller_display_name: string;
  seller_avatar_url: string | null;
};

export type RawOrderRow = RawParticipantOrderRow & {
  payment_provider: string | null;
  payment_reference: string | null;
};

export type RawAdminOrderDetailRow = RawOrderDetailRow & RawOrderRow;

export type OrderSummaryRow = {
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
  amountCents: MoneyCentsInput;
  feeCents: MoneyCentsInput;
  currency: CurrencyCode;
  createdAt: Date | string;
  paidAt: Date | string | null;
  deliveredAt: Date | string | null;
  autoReleaseAt: Date | string | null;
};

export type AdminPendingOrderRow = {
  id: string;
  amountCents: MoneyCentsInput;
  currency: CurrencyCode;
  createdAt: Date | string;
  productTitle: string;
  buyerId: string;
  buyerDisplayName: string;
  buyerEmail: string;
  sellerDisplayName: string;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

export function mapOrderMutationDto(row: RawParticipantOrderRow) {
  return {
    id: row.id,
    status: row.status,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    productId: row.product_id,
    quantity: row.quantity,
    amountCents: bigintToMoneyCents(row.amount_cents),
    feeCents: bigintToMoneyCents(row.fee_cents),
    currency: row.currency,
    deliveryNote: row.delivery_note,
    autoReleaseAt: toNullableIsoString(row.auto_release_at),
    paidAt: toNullableIsoString(row.paid_at),
    deliveredAt: toNullableIsoString(row.delivered_at),
    completedAt: toNullableIsoString(row.completed_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

export function mapOrderDetailDto(row: RawOrderDetailRow) {
  return {
    ...mapOrderMutationDto(row),
    productTitle: row.product_title,
    productDescription: row.product_description,
    buyerDisplayName: row.buyer_display_name,
    buyerAvatarUrl: row.buyer_avatar_url,
    sellerDisplayName: row.seller_display_name,
    sellerAvatarUrl: row.seller_avatar_url
  };
}

export function mapAdminOrderDto(row: RawAdminOrderDetailRow) {
  return {
    ...mapOrderDetailDto(row),
    paymentProvider: row.payment_provider,
    paymentReference: row.payment_reference
  };
}

export function mapAdminOrderMutationDto(row: RawOrderRow) {
  return {
    ...mapOrderMutationDto(row),
    paymentProvider: row.payment_provider,
    paymentReference: row.payment_reference
  };
}

export function mapOrderSummaryDto(row: OrderSummaryRow) {
  return {
    id: row.id,
    status: row.status,
    productId: row.productId,
    productTitle: row.productTitle,
    buyerId: row.buyerId,
    buyerDisplayName: row.buyerDisplayName,
    buyerAvatarUrl: row.buyerAvatarUrl,
    sellerId: row.sellerId,
    sellerDisplayName: row.sellerDisplayName,
    sellerAvatarUrl: row.sellerAvatarUrl,
    quantity: row.quantity,
    amountCents: bigintToMoneyCents(row.amountCents),
    feeCents: bigintToMoneyCents(row.feeCents),
    currency: row.currency,
    createdAt: toIsoString(row.createdAt),
    paidAt: toNullableIsoString(row.paidAt),
    deliveredAt: toNullableIsoString(row.deliveredAt),
    autoReleaseAt: toNullableIsoString(row.autoReleaseAt)
  };
}

export function mapAdminPendingOrderDto(row: AdminPendingOrderRow) {
  return {
    id: row.id,
    amountCents: bigintToMoneyCents(row.amountCents),
    currency: row.currency,
    createdAt: toIsoString(row.createdAt),
    productTitle: row.productTitle,
    buyerId: row.buyerId,
    buyerDisplayName: row.buyerDisplayName,
    buyerEmail: row.buyerEmail,
    sellerDisplayName: row.sellerDisplayName
  };
}
