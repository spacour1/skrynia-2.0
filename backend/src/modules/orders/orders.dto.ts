/**
 * Order mutations use raw `orders` rows internally so transaction code can keep matching
 * PostgreSQL column names. Every raw row must pass through this mapper before crossing an
 * HTTP boundary so the public contract stays camelCase and timestamps are stable ISO
 * strings.
 */
export type RawOrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  quantity: number;
  amount_cents: number | string;
  fee_cents: number | string;
  currency: string;
  status: string;
  payment_provider: string | null;
  payment_reference: string | null;
  delivery_note: string | null;
  auto_release_at: Date | string | null;
  paid_at: Date | string | null;
  delivered_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

export function mapOrderRowDto(row: RawOrderRow) {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    productId: row.product_id,
    quantity: row.quantity,
    amountCents: row.amount_cents,
    feeCents: row.fee_cents,
    currency: row.currency,
    status: row.status,
    paymentProvider: row.payment_provider,
    paymentReference: row.payment_reference,
    deliveryNote: row.delivery_note,
    autoReleaseAt: toNullableIsoString(row.auto_release_at),
    paidAt: toNullableIsoString(row.paid_at),
    deliveredAt: toNullableIsoString(row.delivered_at),
    completedAt: toNullableIsoString(row.completed_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}
