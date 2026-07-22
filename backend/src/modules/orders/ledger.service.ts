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
import {
  invalidateProductCaches,
  type ProductCacheContext
} from "../marketplace/marketplace-cache.service.js";
import { enqueueDomainEvent } from "../outbox/outbox.service.js";
import {
  addMoneyCents,
  bigintToMoneyCents,
  MoneyRangeError,
  parseMoneyCents,
  platformFeeCents,
  subtractMoneyCents,
  type MoneyCents
} from "../../domain/money.js";
import type { OrderStatus } from "../../domain/enums.js";
import { canTransitionOrder } from "./order-transitions.js";
import { recordOrderEvent } from "./order-events.service.js";
import { createOrderSystemMessage } from "../chat/system-messages.service.js";

type OrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  quantity: number;
  amount_cents: MoneyCents;
  fee_cents: MoneyCents;
  currency: string;
  status: string;
};

type ProductEscrowRow = ProductCacheContext & {
  stock: number;
  status: string;
  delivery_type: string;
  delivery_template: string | null;
};

export type ReleaseEscrowOptions = {
  adminId?: string;
  source?: "buyer_confirmed" | "auto" | "dispute" | "service";
  actorId?: string;
  afterUpdate?: (
    client: DbClient,
    order: OrderRow
  ) => Promise<{ systemMessageIds?: string[] } | void>;
};

export type LockEscrowOptions = {
  /** Defaults to the buyer; manual admin confirmation supplies the reviewing admin. */
  actorId?: string;
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

function feeFor(amountCents: MoneyCents) {
  return platformFeeCents(amountCents, env.PLATFORM_FEE_BPS);
}

function checkedBalanceAddition(
  currentCents: MoneyCents,
  addedCents: MoneyCents,
  balanceName: string
) {
  try {
    return addMoneyCents(currentCents, addedCents);
  } catch (error) {
    if (error instanceof MoneyRangeError) {
      throw badRequest(`${balanceName} exceeds the supported money range`);
    }
    throw error;
  }
}

function checkedBalanceSubtraction(
  currentCents: MoneyCents,
  subtractedCents: MoneyCents,
  insufficientMessage: string
) {
  if (parseMoneyCents(currentCents) < parseMoneyCents(subtractedCents)) {
    throw badRequest(insufficientMessage);
  }
  try {
    return subtractMoneyCents(currentCents, subtractedCents);
  } catch (error) {
    if (error instanceof MoneyRangeError) {
      throw badRequest("Balance exceeds the supported money range");
    }
    throw error;
  }
}

export async function lockEscrow(
  orderId: string,
  buyerId: string,
  providerName: PaymentProviderName,
  externalReference?: string,
  options: LockEscrowOptions = {}
) {
  // maxAttempts: 1 - this transaction calls provider.capture() (an external payment
  // side effect) while holding the row lock; an automatic retry would repeat that
  // call. The payment provider path keeps its own idempotency key instead.
  const result = await inSerializableTx(async (client) => {
    const orderResult = await client.query<OrderRow>(`select * from orders where id = $1 for update`, [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== buyerId) throw forbidden("Only the buyer can pay this order");
    if (order.status !== "pending") throw badRequest("Only pending orders can be paid");

    const productResult = await client.query<ProductEscrowRow>(
      `select id as "productId", seller_id as "sellerId", category_id as "categoryId",
              game_id as "gameId", section_id as "sectionId",
              stock, status, delivery_type, delivery_template
       from products where id = $1 for update`,
      [order.product_id]
    );
    const product = productResult.rows[0];
    if (!product || product.status !== "active") throw badRequest("Product is no longer available");
    if (Number(product.stock) < Number(order.quantity)) throw badRequest("Not enough stock");

    const sellerWalletId = await ensureWallet(client, order.seller_id, order.currency);
    const buyerWalletId = await ensureWallet(client, order.buyer_id, order.currency);
    const sellerWallet = await client.query<{ escrow_cents: MoneyCents }>(
      `select escrow_cents from wallets where id = $1 for update`,
      [sellerWalletId]
    );
    const amountCents = bigintToMoneyCents(order.amount_cents);
    const nextEscrowCents = checkedBalanceAddition(
      sellerWallet.rows[0].escrow_cents,
      amountCents,
      "Seller escrow balance"
    );
    const feeCents = feeFor(amountCents);

    await client.query(`update products set stock = stock - $2, updated_at = now() where id = $1`, [
      order.product_id,
      order.quantity
    ]);

    // Captured while holding the order's row lock so a retried/concurrent pay
    // request can never reach the provider for an order that is no longer pending.
    const provider = getPaymentProvider(providerName);
    const payment = await provider.capture({
      orderId: order.id,
      amountCents,
      currency: order.currency,
      idempotencyKey: `payment:${order.id}`,
      externalReference
    });

    await client.query(
      `update wallets
       set escrow_cents = $2, updated_at = now()
       where id = $1`,
      [sellerWalletId, nextEscrowCents]
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
        amountCents,
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
      amountCents,
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

    // The paid timeline row, system message and durable delivery intent belong to the
    // same transaction as the money/status mutation. A process crash after COMMIT can
    // now delay delivery, but cannot permanently lose evidence or notifications.
    await recordOrderEvent(
      {
        orderId: order.id,
        actorId: options.actorId ?? order.buyer_id,
        type: "paid",
        templateKey: "orderEvents.paid",
        metadata: { provider: payment.provider }
      },
      client
    );
    const message = await createOrderSystemMessage(
      {
        orderId: order.id,
        type: "payment_received",
        bodyKey: "system.paymentReceived"
      },
      client
    );
    await enqueueDomainEvent(client, {
      eventKey: `order.paid:${order.id}`,
      eventType: "order.paid",
      aggregateType: "order",
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        buyerId: order.buyer_id,
        sellerId: order.seller_id,
        productId: order.product_id,
        systemMessageIds: message ? [message.id] : []
      }
    });

    await cacheDel(
      `user:${order.buyer_id}:wallet`,
      `user:${order.seller_id}:wallet`
    );
    await cacheDelPattern(`order:${order.id}:*`);
    await cacheDelPattern(`orders:${order.buyer_id}:*`);
    await cacheDelPattern(`orders:${order.seller_id}:*`);
    return { order: updated.rows[0], productContext: product as ProductCacheContext };
  }, { maxAttempts: 1 });
  await invalidateProductCaches(result.productContext);
  return result.order;
}

export async function releaseEscrow(
  orderId: string,
  adminIdOrOptions?: string | ReleaseEscrowOptions
) {
  const options: ReleaseEscrowOptions =
    typeof adminIdOrOptions === "string"
      ? { adminId: adminIdOrOptions, source: "dispute" }
      : (adminIdOrOptions ?? {});
  const source = options.source ?? (options.adminId ? "dispute" : "service");

  return inSerializableTx(async (client) => {
    const orderResult = await client.query<OrderRow>(`select * from orders where id = $1 for update`, [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw notFound("Order not found");
    if (!canTransitionOrder(order.status as OrderStatus, "completed")) {
      throw badRequest("Only delivered or disputed orders can be released");
    }

    const sellerWalletId = await ensureWallet(client, order.seller_id, order.currency);
    const sellerWallet = await client.query<{
      escrow_cents: MoneyCents;
      available_cents: MoneyCents;
    }>(
      `select escrow_cents, available_cents from wallets where id = $1 for update`,
      [sellerWalletId]
    );
    const amountCents = bigintToMoneyCents(order.amount_cents);
    const storedFeeCents = bigintToMoneyCents(order.fee_cents);
    if (parseMoneyCents(storedFeeCents) > parseMoneyCents(amountCents)) {
      throw badRequest("Platform fee exceeds the order amount");
    }
    // fee_cents is captured with the payment and is immutable pricing history. Zero is
    // a valid persisted fee (free promotion / zero-BPS configuration), not a sentinel.
    const feeCents = storedFeeCents;
    const netCents = subtractMoneyCents(amountCents, feeCents);
    const nextEscrowCents = checkedBalanceSubtraction(
      sellerWallet.rows[0].escrow_cents,
      amountCents,
      "Escrow balance is insufficient"
    );
    const nextAvailableCents = checkedBalanceAddition(
      sellerWallet.rows[0].available_cents,
      netCents,
      "Seller available balance"
    );

    let nextRevenueCents: MoneyCents | null = null;
    if (parseMoneyCents(feeCents) > 0n) {
      const platformWallet = await client.query<{ revenue_cents: MoneyCents }>(
        `select revenue_cents from platform_wallets where currency = $1 for update`,
        [order.currency]
      );
      if (!platformWallet.rows[0]) throw new Error(`Platform wallet is missing for ${order.currency}`);
      nextRevenueCents = checkedBalanceAddition(
        platformWallet.rows[0].revenue_cents,
        feeCents,
        "Platform revenue balance"
      );
    }

    await client.query(
      `update wallets
       set escrow_cents = $2,
           available_cents = $3,
           updated_at = now()
       where id = $1`,
      [sellerWalletId, nextEscrowCents, nextAvailableCents]
    );
    if (nextRevenueCents !== null) {
      await client.query(
        `update platform_wallets
         set revenue_cents = $1, updated_at = now()
         where currency = $2`,
        [nextRevenueCents, order.currency]
      );
    }

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
        { adminId: options.adminId ?? null }
      ]
    );
    await recordEscrowReleaseLedger({
      client,
      orderId: order.id,
      sellerId: order.seller_id,
      amountCents,
      feeCents,
      currency: order.currency,
      adminId: options.adminId ?? null
    });

    const updated = await client.query(
      `update orders
       set status = 'completed', completed_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [order.id]
    );

    const productResult = await client.query<ProductCacheContext>(
      `update products
       set sales_count = sales_count + $2, updated_at = now()
       where id = $1
       returning id as "productId", seller_id as "sellerId", category_id as "categoryId",
                 game_id as "gameId", section_id as "sectionId"`,
      [order.product_id, order.quantity]
    );

    const transition = await options.afterUpdate?.(
      client,
      updated.rows[0] as OrderRow
    );
    await enqueueDomainEvent(client, {
      eventKey: `order.completed:${order.id}`,
      eventType: "order.completed",
      aggregateType: "order",
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        buyerId: order.buyer_id,
        sellerId: order.seller_id,
        productId: productResult.rows[0].productId,
        source,
        actorId: options.actorId ?? null,
        systemMessageIds: transition?.systemMessageIds ?? []
      }
    });
    return updated.rows[0];
  });
}

export async function refundEscrow(orderId: string, adminId?: string) {
  return inSerializableTx(async (client) => {
    const orderResult = await client.query<OrderRow>(`select * from orders where id = $1 for update`, [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw notFound("Order not found");
    if (!canTransitionOrder(order.status as OrderStatus, "refunded")) {
      throw badRequest("Only escrowed orders can be refunded");
    }

    const sellerWalletId = await ensureWallet(client, order.seller_id, order.currency);
    const buyerWalletId = await ensureWallet(client, order.buyer_id, order.currency);
    const sellerWallet = await client.query<{ escrow_cents: MoneyCents }>(
      `select escrow_cents from wallets where id = $1 for update`,
      [sellerWalletId]
    );
    const buyerWallet = await client.query<{ available_cents: MoneyCents }>(
      `select available_cents from wallets where id = $1 for update`,
      [buyerWalletId]
    );
    const amountCents = bigintToMoneyCents(order.amount_cents);
    const nextEscrowCents = checkedBalanceSubtraction(
      sellerWallet.rows[0].escrow_cents,
      amountCents,
      "Escrow balance is insufficient"
    );
    const nextBuyerAvailableCents = checkedBalanceAddition(
      buyerWallet.rows[0].available_cents,
      amountCents,
      "Buyer available balance"
    );

    await client.query(
      `update wallets
       set escrow_cents = $2, updated_at = now()
       where id = $1`,
      [sellerWalletId, nextEscrowCents]
    );
    await client.query(
      `update wallets
       set available_cents = $2, updated_at = now()
       where id = $1`,
      [buyerWalletId, nextBuyerAvailableCents]
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
        amountCents,
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
      amountCents,
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
