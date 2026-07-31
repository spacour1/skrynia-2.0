import { env } from "../../config/env.js";
import type { DbClient } from "../../db/pool.js";
import { inSerializableTx } from "../../db/pool.js";
import { badRequest, forbidden } from "../../common/errors.js";
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
import {
  addMoneyCents,
  bigintToMoneyCents,
  MoneyRangeError,
  parseMoneyCents,
  platformFeeCents,
  subtractMoneyCents,
  type MoneyCents
} from "../../domain/money.js";
import { canTransitionOrder } from "./order-transitions.js";
import { createOrderSystemMessage } from "../chat/system-messages.service.js";
import {
  selectOrderForUpdate,
  transitionOrder,
  type OrderRow,
  type OrderTransitionActor
} from "./order-transition.service.js";

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
};

export type LockEscrowOptions = {
  /** Defaults to the initiating buyer (or the mock-test buyer for provider=mock). */
  actor?: OrderTransitionActor;
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
    const order = await selectOrderForUpdate(client, orderId);
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
    await client.query(
      `update orders
       set fee_cents = $2,
           payment_provider = $3,
           payment_reference = $4,
           delivery_note = case when $5::text is not null then $5 else delivery_note end
       where id = $1`,
      [
        order.id,
        feeCents,
        payment.provider,
        payment.reference,
        isInstant ? product.delivery_template : null
      ]
    );

    // The paid timeline row, system message and durable delivery intent belong to the
    // same transaction as the money/status mutation. A process crash after COMMIT can
    // now delay delivery, but cannot permanently lose evidence or notifications.
    const message = await createOrderSystemMessage(
      {
        orderId: order.id,
        type: "payment_received",
        bodyKey: "system.paymentReceived"
      },
      client
    );
    const actor =
      options.actor ??
      (providerName === "mock"
        ? ({ kind: "service", id: order.buyer_id, role: "test_payment" } as const)
        : ({ kind: "user", id: order.buyer_id, role: "buyer" } as const));
    const updated = await transitionOrder(client, {
      orderId: order.id,
      to: isInstant ? "delivered" : "paid",
      actor,
      reason: "payment_captured",
      expectedFrom: ["pending"],
      metadata: {
        provider: payment.provider,
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
    return { order: updated, productContext: product as ProductCacheContext };
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

  const updated = await inSerializableTx(async (client) => {
    const order = await selectOrderForUpdate(client, orderId);
    if (!canTransitionOrder(order.status, "completed")) {
      throw badRequest("Only delivered or disputed orders can be released");
    }

    const message =
      source === "buyer_confirmed" || source === "auto"
        ? await createOrderSystemMessage(
            {
              orderId,
              type: "escrow_released",
              bodyKey:
                source === "buyer_confirmed"
                  ? "system.escrowReleased"
                  : "system.fundsReleased"
            },
            client
          )
        : null;
    const transition =
      source === "buyer_confirmed"
        ? {
            actor: {
              kind: "user",
              id: options.actorId ?? order.buyer_id,
              role: "buyer"
            } as const,
            reason: "buyer_confirmed" as const,
            expectedFrom: ["delivered"] as const
          }
        : source === "auto"
          ? {
              actor: {
                kind: "service",
                id: "auto-release-worker",
                role: "auto_release"
              } as const,
              reason: "auto_released" as const,
              expectedFrom: ["delivered"] as const
            }
          : source === "dispute"
            ? {
                actor: {
                  kind: "user",
                  id: options.adminId ?? "",
                  role: "admin"
                } as const,
                reason: "dispute_released" as const,
                expectedFrom: ["disputed"] as const
              }
            : {
                actor: {
                  kind: "service",
                  id: "escrow-service",
                  role: "system"
                } as const,
                reason: "service_released" as const,
                expectedFrom: ["delivered", "disputed"] as const
              };
    const updated = await transitionOrder(client, {
      orderId,
      to: "completed",
      actor: transition.actor,
      reason: transition.reason,
      expectedFrom: transition.expectedFrom,
      metadata: { systemMessageIds: message ? [message.id] : [] }
    });

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

    await client.query<ProductCacheContext>(
      `update products
       set sales_count = sales_count + $2, updated_at = now()
       where id = $1
       returning id as "productId", seller_id as "sellerId", category_id as "categoryId",
                 game_id as "gameId", section_id as "sectionId"`,
      [order.product_id, order.quantity]
    );

    return updated;
  });

  // inSerializableTx has committed before it resolves. Evict every participant-facing
  // order and wallet view now so an immediate refetch cannot observe pre-release state.
  await Promise.all([
    cacheDel(
      `user:${updated.buyer_id}:wallet`,
      `user:${updated.seller_id}:wallet`
    ),
    cacheDelPattern(`order:${updated.id}:*`),
    cacheDelPattern(`orders:${updated.buyer_id}:*`),
    cacheDelPattern(`orders:${updated.seller_id}:*`)
  ]);

  return updated;
}

export async function refundEscrow(orderId: string, adminId?: string) {
  return inSerializableTx(async (client) => {
    const order = await selectOrderForUpdate(client, orderId);
    if (!canTransitionOrder(order.status, "refunded")) {
      throw badRequest("Only escrowed orders can be refunded");
    }
    const updated = await transitionOrder(client, {
      orderId,
      to: "refunded",
      actor: adminId
        ? { kind: "user", id: adminId, role: "admin" }
        : { kind: "service", id: "escrow-service", role: "system" },
      reason: adminId ? "dispute_refunded" : "service_refunded",
      expectedFrom: adminId
        ? ["disputed"]
        : ["paid", "in_progress", "delivered", "disputed"]
    });

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

    await cacheDel(
      `user:${order.buyer_id}:wallet`,
      `user:${order.seller_id}:wallet`
    );
    await cacheDelPattern(`order:${order.id}:*`);
    await cacheDelPattern(`orders:${order.buyer_id}:*`);
    await cacheDelPattern(`orders:${order.seller_id}:*`);
    return updated;
  });
}
