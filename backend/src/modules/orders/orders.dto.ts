/**
 * `lockEscrow`/`releaseEscrow`/`refundEscrow` return the raw `orders` row (`returning *`,
 * snake_case) for their own internal callers. This mapper is for the one place that row
 * crosses into an HTTP response outside `orders.routes.ts` itself (the admin dispute
 * resolve endpoint) - keeps the private repository-layer shape unchanged while the wire
 * contract stays camelCase.
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
    autoReleaseAt: row.auto_release_at,
    paidAt: row.paid_at,
    deliveredAt: row.delivered_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
