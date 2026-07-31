import {
  bigintToMoneyCents,
  type MoneyCentsInput
} from "../../domain/money.js";

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
  currency: string;
  status: string;
  delivery_note: string | null;
  auto_release_at: Date | string | null;
  paid_at: Date | string | null;
  delivered_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type RawOrderDetailRow = RawParticipantOrderRow & {
  product_title?: string;
  product_description?: string;
  buyer_display_name?: string;
  buyer_avatar_url?: string | null;
  seller_display_name?: string;
  seller_avatar_url?: string | null;
};

export type RawOrderRow = RawOrderDetailRow & {
  payment_provider: string | null;
  payment_reference: string | null;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

export function mapOrderDetailDto(row: RawOrderDetailRow) {
  const order = {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    productId: row.product_id,
    quantity: row.quantity,
    amountCents: bigintToMoneyCents(row.amount_cents),
    feeCents: bigintToMoneyCents(row.fee_cents),
    currency: row.currency,
    status: row.status,
    deliveryNote: row.delivery_note,
    autoReleaseAt: toNullableIsoString(row.auto_release_at),
    paidAt: toNullableIsoString(row.paid_at),
    deliveredAt: toNullableIsoString(row.delivered_at),
    completedAt: toNullableIsoString(row.completed_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };

  if (row.product_title === undefined) return order;
  return {
    ...order,
    productTitle: row.product_title,
    productDescription: row.product_description ?? "",
    buyerDisplayName: row.buyer_display_name ?? "",
    buyerAvatarUrl: row.buyer_avatar_url ?? null,
    sellerDisplayName: row.seller_display_name ?? "",
    sellerAvatarUrl: row.seller_avatar_url ?? null
  };
}

export function mapAdminOrderDto(row: RawOrderRow) {
  return {
    ...mapOrderDetailDto(row),
    paymentProvider: row.payment_provider,
    paymentReference: row.payment_reference
  };
}

export function mapOrderMoneyFields<
  T extends { amountCents: MoneyCentsInput; feeCents: MoneyCentsInput }
>(row: T): Omit<T, "amountCents" | "feeCents"> & {
  amountCents: string;
  feeCents: string;
} {
  return {
    ...row,
    amountCents: bigintToMoneyCents(row.amountCents),
    feeCents: bigintToMoneyCents(row.feeCents)
  };
}
