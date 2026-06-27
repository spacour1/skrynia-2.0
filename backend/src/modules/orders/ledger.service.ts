import { env } from "../../config/env.js";
import type { DbClient } from "../../db/pool.js";
import { inSerializableTx } from "../../db/pool.js";
import { badRequest, forbidden, notFound } from "../../common/errors.js";
import { cacheDel, cacheDelPattern } from "../../common/redis.js";
import { getPaymentProvider, type PaymentProviderName } from "../payments/payment.providers.js";
import {
  recordEscrowReleaseLedger,
  recordPaymentCaptureLedger,
  recordRefundLedger
} from "./accounting.service.js";

type OrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  quantity: number;
  amount_cents: number;
  fee_cents: number;
  currency: string;
  status: string;
};

type ProductEscrowRow = {
  stock: number;
  status: string;
  delivery_type: string;
  delivery_template: string | null;
};

export async function ensureWallet(client: DbClient, userId: string, currency: string) {
  const wallet = await client.query<{ id: string }>(
    `insert into wallets(user_id, currency)
     values ($1, $2)
     on conflict (user_id, currency) do update set updated_at = now()
     returning id`,
    [userId, currency]
  );
  return wallet.rows[0].id;
}

function feeFor(amountCents: number) {
  return Math.floor((amountCents * env.PLATFORM_FEE_BPS) / 10_000);
}

export async function lockEscrow(
  orderId: string,
  buyerId: string,
  providerName: PaymentProviderName,
  externalReference?: string
) {
  return inSerializableTx(async (client) => {
    const orderResult = await client.query<OrderRow>(`select * from orders where id = $1 for update`, [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== buyerId) throw forbidden("Only the buyer can pay this order");
    if (order.status !== "pending") throw badRequest("Only pending orders can be paid");

    const productResult = await client.query<ProductEscrowRow>(
      `select stock, status, delivery_type, delivery_template from products where id = $1 for update`,
      [order.product_id]
    );
    const product = productResult.rows[0];
    if (!product || product.status !== "active") throw badRequest("Product is no longer available");
    if (Number(product.stock) < Number(order.quantity)) throw badRequest("Not enough stock");
    await client.query(`update products set stock = stock - $2, updated_at = now() where id = $1`, [
      order.product_id,
      order.quantity
    ]);

    // Captured while holding the order's row lock so a retried/concurrent pay
    // request can never reach the provider for an order that is no longer pending.
    const provider = getPaymentProvider(providerName);
    const payment = await provider.capture({
      orderId: order.id,
      amountCents: Number(order.amount_cents),
      currency: order.currency,
      idempotencyKey: `payment:${order.id}`,
      externalReference
    });

    const sellerWalletId = await ensureWallet(client, order.seller_id, order.currency);
    const buyerWalletId = await ensureWallet(client, order.buyer_id, order.currency);
    const feeCents = feeFor(order.amount_cents);

    await client.query(
      `update wallets
       set escrow_cents = escrow_cents + $2, updated_at = now()
       where id = $1`,
      [sellerWalletId, order.amount_cents]
    );

    await client.query(
      `insert into transactions(wallet_id, user_id, order_id, type, direction, amount_cents, currency, metadata)
       values
       ($1, $2, $3, 'payment_capture', 'neutral', $4, $5, $6),
       ($7, $8, $3, 'escrow_hold', 'credit', $4, $5, $6)`,
      [
        buyerWalletId,
        order.buyer_id,
        order.id,
        order.amount_cents,
        order.currency,
        { provider: payment.provider, reference: payment.reference },
        sellerWalletId,
        order.seller_id
      ]
    );
    await recordPaymentCaptureLedger({
      client,
      orderId: order.id,
      sellerId: order.seller_id,
      amountCents: Number(order.amount_cents),
      currency: order.currency,
      provider: payment.provider,
      reference: payment.reference
    });

    const isInstant = product.delivery_type === "instant" && product.delivery_template;
    const updated = await client.query(
      `update orders
       set status = $5,
           fee_cents = $2,
           payment_provider = $3,
           payment_reference = $4,
           delivery_note = case when $6::text is not null then $6 else delivery_note end,
           delivered_at = case when $6::text is not null then now() else delivered_at end,
           auto_release_at = case when $6::text is not null then now() + make_interval(hours => $7::int) else auto_release_at end,
           paid_at = now(),
           updated_at = now()
       where id = $1
       returning *`,
      [
        order.id,
        feeCents,
        payment.provider,
        payment.reference,
        isInstant ? "delivered" : "paid",
        isInstant ? product.delivery_template : null,
        env.AUTO_RELEASE_HOURS
      ]
    );

    await cacheDel(
      `user:${order.buyer_id}:wallet`,
      `user:${order.seller_id}:wallet`
    );
    await cacheDelPattern(`order:${order.id}:*`);
    await cacheDelPattern(`orders:${order.buyer_id}:*`);
    await cacheDelPattern(`orders:${order.seller_id}:*`);
    return updated.rows[0];
  });
}

export async function releaseEscrow(orderId: string, adminId?: string) {
  return inSerializableTx(async (client) => {
    const orderResult = await client.query<OrderRow>(`select * from orders where id = $1 for update`, [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw notFound("Order not found");
    if (!["delivered", "disputed"].includes(order.status)) {
      throw badRequest("Only delivered or disputed orders can be released");
    }

    const sellerWalletId = await ensureWallet(client, order.seller_id, order.currency);
    const sellerWallet = await client.query<{ escrow_cents: number }>(
      `select escrow_cents from wallets where id = $1 for update`,
      [sellerWalletId]
    );
    if (Number(sellerWallet.rows[0].escrow_cents) < Number(order.amount_cents)) {
      throw badRequest("Escrow balance is insufficient");
    }

    const feeCents = order.fee_cents || feeFor(order.amount_cents);
    const netCents = Number(order.amount_cents) - Number(feeCents);

    await client.query(
      `update wallets
       set escrow_cents = escrow_cents - $2,
           available_cents = available_cents + $3,
           updated_at = now()
       where id = $1`,
      [sellerWalletId, order.amount_cents, netCents]
    );
    await client.query(
      `update platform_wallets
       set revenue_cents = revenue_cents + $1, updated_at = now()
       where currency = $2`,
      [feeCents, order.currency]
    );

    await client.query(
      `insert into transactions(wallet_id, user_id, order_id, type, direction, amount_cents, currency, metadata)
       values
       ($1, $2, $3, 'escrow_release', 'credit', $4, $6, $7),
       ($1, $2, $3, 'platform_fee', 'debit', $5, $6, $7)`,
      [
        sellerWalletId,
        order.seller_id,
        order.id,
        netCents,
        feeCents,
        order.currency,
        { adminId: adminId ?? null }
      ]
    );
    await recordEscrowReleaseLedger({
      client,
      orderId: order.id,
      sellerId: order.seller_id,
      amountCents: Number(order.amount_cents),
      feeCents: Number(feeCents),
      currency: order.currency,
      adminId: adminId ?? null
    });

    const updated = await client.query(
      `update orders
       set status = 'completed', completed_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [order.id]
    );

    await client.query(
      `update products
       set sales_count = sales_count + $2, updated_at = now()
       where id = $1`,
      [order.product_id, order.quantity]
    );

    await cacheDel(`user:${order.seller_id}:wallet`);
    await cacheDelPattern(`order:${order.id}:*`);
    await cacheDelPattern(`orders:${order.buyer_id}:*`);
    await cacheDelPattern(`orders:${order.seller_id}:*`);
    return updated.rows[0];
  });
}

export async function refundEscrow(orderId: string, adminId?: string) {
  return inSerializableTx(async (client) => {
    const orderResult = await client.query<OrderRow>(`select * from orders where id = $1 for update`, [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw notFound("Order not found");
    if (!["paid", "in_progress", "delivered", "disputed"].includes(order.status)) {
      throw badRequest("Only escrowed orders can be refunded");
    }

    const sellerWalletId = await ensureWallet(client, order.seller_id, order.currency);
    const buyerWalletId = await ensureWallet(client, order.buyer_id, order.currency);
    const sellerWallet = await client.query<{ escrow_cents: number }>(
      `select escrow_cents from wallets where id = $1 for update`,
      [sellerWalletId]
    );
    if (Number(sellerWallet.rows[0].escrow_cents) < Number(order.amount_cents)) {
      throw badRequest("Escrow balance is insufficient");
    }

    await client.query(
      `update wallets
       set escrow_cents = escrow_cents - $2, updated_at = now()
       where id = $1`,
      [sellerWalletId, order.amount_cents]
    );
    await client.query(
      `update wallets
       set available_cents = available_cents + $2, updated_at = now()
       where id = $1`,
      [buyerWalletId, order.amount_cents]
    );

    await client.query(
      `insert into transactions(wallet_id, user_id, order_id, type, direction, amount_cents, currency, metadata)
       values
       ($1, $2, $3, 'refund', 'debit', $4, $5, $6),
       ($7, $8, $3, 'refund', 'credit', $4, $5, $6)`,
      [
        sellerWalletId,
        order.seller_id,
        order.id,
        order.amount_cents,
        order.currency,
        { adminId: adminId ?? null },
        buyerWalletId,
        order.buyer_id
      ]
    );
    await recordRefundLedger({
      client,
      orderId: order.id,
      sellerId: order.seller_id,
      buyerId: order.buyer_id,
      amountCents: Number(order.amount_cents),
      currency: order.currency,
      adminId: adminId ?? null
    });

    const updated = await client.query(
      `update orders
       set status = 'refunded', completed_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [order.id]
    );

    await cacheDel(
      `user:${order.buyer_id}:wallet`,
      `user:${order.seller_id}:wallet`
    );
    await cacheDelPattern(`order:${order.id}:*`);
    await cacheDelPattern(`orders:${order.buyer_id}:*`);
    await cacheDelPattern(`orders:${order.seller_id}:*`);
    return updated.rows[0];
  });
}
