import { Router } from "express";
import { z } from "zod";
import { inTx, pool } from "../../db/pool.js";
import {
  ApiError,
  asyncHandler,
  badRequest,
  forbidden,
  notFound
} from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { cacheGet, cacheSet } from "../../common/redis.js";
import type { AuthedRequest } from "../../common/types.js";
import { releaseEscrow } from "./ledger.service.js";
import { recordOrderEvent } from "./order-events.service.js";
import { canTransitionOrder } from "./order-transitions.js";
import {
  selectOrderForUpdate,
  transitionOrder
} from "./order-transition.service.js";
import { getOrCreateOrderConversation } from "../chat/chat.service.js";
import {
  createOrderSystemMessage,
  createSystemMessage
} from "../chat/system-messages.service.js";
import {
  hashIdempotencyPayload,
  runIdempotentTransaction
} from "../idempotency/idempotency.service.js";
import { enqueueDomainEvent } from "../outbox/outbox.service.js";
import {
  mapAdminOrderDto,
  mapOrderDetailDto,
  mapOrderMutationDto,
  mapOrderSummaryDto,
  type OrderSummaryRow
} from "./orders.dto.js";
import {
  bigintToMoneyCents,
  parseMoneyCents,
  POSTGRES_BIGINT_MAX
} from "../../domain/money.js";
import { buildNextCursor, keysetWhereClause, parseCursorPage } from "../../common/pagination.js";

const router = Router();

const createOrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(100).default(1)
});

const deliverSchema = z.object({
  deliveryNote: z.string().min(5).max(5000)
});

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(2000).optional()
});

function canSeeOrder(order: { buyerId: string; sellerId: string }, user: AuthedRequest["user"]) {
  return user.role === "admin" || order.buyerId === user.id || order.sellerId === user.id;
}

router.post(
  "/",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = createOrderSchema.parse(req.body);
    const parsedKey = z.string().uuid().safeParse(req.get("Idempotency-Key"));
    if (!parsedKey.success) {
      throw new ApiError(
        400,
        "A valid Idempotency-Key UUID header is required",
        "idempotency_key_invalid"
      );
    }

    const result = await runIdempotentTransaction({
      userId: req.user.id,
      scope: "orders.create",
      key: parsedKey.data,
      requestHash: hashIdempotencyPayload(input),
      execute: async (client) => {
        const productResult = await client.query(
          `select p.id, p.seller_id, p.price_cents, p.currency, p.stock, p.status, u.is_banned
           from products p
           join users u on u.id = p.seller_id
           where p.id = $1
           for update of p`,
          [input.productId]
        );
        const product = productResult.rows[0];
        if (!product || product.status !== "active" || product.is_banned) {
          throw notFound("Product is unavailable");
        }
        if (product.seller_id === req.user.id) {
          throw badRequest("You cannot buy your own listing");
        }
        if (product.stock < input.quantity) throw badRequest("Not enough stock");

        const amount =
          parseMoneyCents(bigintToMoneyCents(product.price_cents)) *
          BigInt(input.quantity);
        if (amount > POSTGRES_BIGINT_MAX) {
          throw badRequest("Order amount is too large");
        }
        const amountCents = bigintToMoneyCents(amount);
        const orderResult = await client.query(
          `insert into orders(buyer_id, seller_id, product_id, quantity, amount_cents, currency)
           values ($1, $2, $3, $4, $5, $6)
           returning id, buyer_id, seller_id, product_id, quantity, amount_cents,
                     fee_cents, currency, status, delivery_note,
                     auto_release_at, paid_at, delivered_at, completed_at,
                     created_at, updated_at`,
          [
            req.user.id,
            product.seller_id,
            product.id,
            input.quantity,
            amountCents,
            product.currency
          ]
        );
        const createdOrder = orderResult.rows[0];

        // Every order gets its own chat context. The product chat remains the listing
        // discussion history; order lifecycle/system messages stay in this order chat.
        const conversation = await getOrCreateOrderConversation(
          {
            buyerId: req.user.id,
            sellerId: product.seller_id,
            productId: product.id,
            orderId: createdOrder.id
          },
          client
        );
        const conversationId = conversation.id;

        const message = await createSystemMessage(
          {
            conversationId,
            type: "order_created",
            bodyKey: "system.orderCreated"
          },
          client
        );

        await recordOrderEvent(
          {
            orderId: createdOrder.id,
            actorId: req.user.id,
            type: "created",
            templateKey: "orderEvents.created"
          },
          client
        );
        await enqueueDomainEvent(client, {
          eventKey: `order.created:${createdOrder.id}`,
          eventType: "order.created",
          aggregateType: "order",
          aggregateId: createdOrder.id,
          payload: {
            orderId: createdOrder.id,
            buyerId: createdOrder.buyer_id,
            sellerId: createdOrder.seller_id,
            productId: createdOrder.product_id,
            conversationId,
            systemMessageIds: [message.id]
          }
        });

        return {
          statusCode: 201,
          body: { order: mapOrderMutationDto(createdOrder), conversationId },
          resourceId: createdOrder.id as string
        };
      }
    });

    if (result.replayed) res.setHeader("Idempotency-Replayed", "true");
    res.status(result.statusCode).json(result.body);
  })
);

router.get(
  "/",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const role = z.enum(["buyer", "seller", "all"]).default("all").parse(req.query.role ?? "all");
    const status = z.string().optional().parse(req.query.status);
    const { limit, cursor } = parseCursorPage(req.query, { defaultLimit: 100 });
    const cacheKey = `orders:${req.user.id}:${role}:${status ?? "any"}:${limit}:${req.query.cursor ?? "first"}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const values: unknown[] = [];
    const where: string[] = [];

    if (req.user.role !== "admin" || role !== "all") {
      if (role === "seller") {
        values.push(req.user.id);
        where.push(`o.seller_id = $${values.length}`);
      } else if (role === "buyer") {
        values.push(req.user.id);
        where.push(`o.buyer_id = $${values.length}`);
      } else {
        values.push(req.user.id);
        where.push(`(o.buyer_id = $${values.length} or o.seller_id = $${values.length})`);
      }
    }
    if (status) {
      values.push(status);
      where.push(`o.status = $${values.length}`);
    }
    const cursorWhere = keysetWhereClause(values, cursor, "o.created_at", "o.id");
    if (cursorWhere) where.push(cursorWhere);
    values.push(limit);

    const result = await pool.query<OrderSummaryRow>(
      `select o.id, o.status, o.quantity, o.amount_cents as "amountCents", o.fee_cents as "feeCents",
              o.currency, o.created_at as "createdAt", o.paid_at as "paidAt", o.delivered_at as "deliveredAt",
              o.auto_release_at as "autoReleaseAt",
              p.title as "productTitle", p.id as "productId",
              b.id as "buyerId", b.display_name as "buyerDisplayName", b.avatar_url as "buyerAvatarUrl",
              s.id as "sellerId", s.display_name as "sellerDisplayName", s.avatar_url as "sellerAvatarUrl"
       from orders o
       join products p on p.id = o.product_id
       join users b on b.id = o.buyer_id
       join users s on s.id = o.seller_id
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by o.created_at desc, o.id desc
       limit $${values.length}`,
      values
    );
    const orders = result.rows.map(mapOrderSummaryDto);
    const payload = { orders, nextCursor: buildNextCursor(result.rows, limit) };
    await cacheSet(cacheKey, payload, 15);
    res.json(payload);
  })
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const cacheKey = `order:${id}:${req.user.id}:${req.user.role}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const adminPaymentColumns =
      req.user.role === "admin"
        ? ", o.payment_provider, o.payment_reference"
        : "";
    const result = await pool.query(
      `select o.id, o.buyer_id, o.seller_id, o.product_id,
              o.quantity, o.amount_cents, o.fee_cents, o.currency,
              o.status${adminPaymentColumns},
              o.delivery_note, o.auto_release_at,
              o.paid_at, o.delivered_at, o.completed_at,
              o.created_at, o.updated_at,
              p.title as product_title, p.description as product_description,
              b.display_name as buyer_display_name, b.avatar_url as buyer_avatar_url,
              s.display_name as seller_display_name, s.avatar_url as seller_avatar_url
       from orders o
       join products p on p.id = o.product_id
       join users b on b.id = o.buyer_id
       join users s on s.id = o.seller_id
       where o.id = $1`,
      [id]
    );
    const orderRow = result.rows[0];
    if (!orderRow) throw notFound("Order not found");
    if (
      !canSeeOrder(
        { buyerId: orderRow.buyer_id, sellerId: orderRow.seller_id },
        req.user
      )
    ) {
      throw forbidden();
    }
    const events = await pool.query(
      `select e.id, e.order_id as "orderId", e.actor_id as "actorId", u.display_name as "actorDisplayName",
              e.type, e.title, e.body, e.metadata, e.created_at as "createdAt"
       from order_events e
       left join users u on u.id = e.actor_id
       where e.order_id = $1
       order by e.created_at asc`,
      [id]
    );
    const order =
      req.user.role === "admin"
        ? mapAdminOrderDto(orderRow)
        : mapOrderDetailDto(orderRow);
    const payload = { order, events: events.rows };
    await cacheSet(cacheKey, payload, 15);
    res.json(payload);
  })
);

router.post(
  "/:id/start",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const order = await inTx(async (client) => {
      const existingOrder = await selectOrderForUpdate(client, id);
      if (
        existingOrder.seller_id !== req.user.id ||
        !canTransitionOrder(existingOrder.status, "in_progress")
      ) {
        throw badRequest("Only the seller can start a paid order");
      }
      const message = await createOrderSystemMessage(
        {
          orderId: id,
          type: "seller_started",
          bodyKey: "system.sellerStarted"
        },
        client
      );
      return transitionOrder(client, {
        orderId: id,
        to: "in_progress",
        actor: { kind: "user", id: req.user.id, role: "seller" },
        reason: "seller_started",
        expectedFrom: ["paid"],
        metadata: { systemMessageIds: message ? [message.id] : [] }
      });
    });
    res.json({ order: mapOrderMutationDto(order) });
  })
);

router.post(
  "/:id/deliver",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = deliverSchema.parse(req.body);
    const order = await inTx(async (client) => {
      const existingOrder = await selectOrderForUpdate(client, id);
      if (
        existingOrder.seller_id !== req.user.id ||
        !canTransitionOrder(existingOrder.status, "delivered")
      ) {
        throw badRequest("Only the seller can deliver an active escrowed order");
      }
      await client.query(
        `update orders
         set delivery_note = $2
         where id = $1`,
        [id, input.deliveryNote]
      );
      const message = await createOrderSystemMessage(
        {
          orderId: id,
          type: "delivery_sent",
          bodyKey: "system.deliverySent"
        },
        client
      );
      return transitionOrder(client, {
        orderId: id,
        to: "delivered",
        actor: { kind: "user", id: req.user.id, role: "seller" },
        reason: "seller_delivered",
        expectedFrom: ["paid", "in_progress"],
        metadata: { systemMessageIds: message ? [message.id] : [] }
      });
    });
    res.json({ order: mapOrderMutationDto(order) });
  })
);

router.post(
  "/:id/confirm",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const orderResult = await pool.query(`select buyer_id, seller_id, status from orders where id = $1`, [id]);
    const order = orderResult.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== req.user.id) throw forbidden("Only the buyer can confirm delivery");
    if (order.status !== "delivered") throw badRequest("Only delivered orders can be confirmed");

    const updated = await releaseEscrow(id, {
      source: "buyer_confirmed",
      actorId: req.user.id
    });
    res.json({ order: mapOrderMutationDto(updated) });
  })
);

router.post(
  "/:id/review",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = reviewSchema.parse(req.body);
    const result = await inTx(async (client) => {
      const orderResult = await client.query(
        `select buyer_id, seller_id, status
         from orders
         where id = $1
         for update`,
        [id]
      );
      const order = orderResult.rows[0];
      if (!order) throw notFound("Order not found");
      if (order.buyer_id !== req.user.id) {
        throw forbidden("Only the buyer can review this order");
      }

      const existing = await client.query(
        `select id, order_id as "orderId", seller_id as "sellerId",
                buyer_id as "buyerId", rating, comment, created_at as "createdAt"
         from reviews
         where order_id = $1`,
        [id]
      );
      if (existing.rows[0]) {
        const review = existing.rows[0];
        const sameRequest =
          Number(review.rating) === input.rating &&
          (review.comment ?? null) === (input.comment ?? null);
        if (!sameRequest) {
          throw new ApiError(
            409,
            "This order already has a different review",
            "review_already_exists"
          );
        }
        return { review, created: false };
      }

      if (order.status !== "completed") {
        throw badRequest("Reviews are allowed only after completed orders");
      }

      const result = await client.query(
        `insert into reviews(order_id, seller_id, buyer_id, rating, comment)
         values ($1, $2, $3, $4, $5)
         returning id, order_id as "orderId", seller_id as "sellerId",
                   buyer_id as "buyerId", rating, comment, created_at as "createdAt"`,
        [id, order.seller_id, order.buyer_id, input.rating, input.comment ?? null]
      );
      const createdReview = result.rows[0];
      await recordOrderEvent(
        {
          orderId: id,
          actorId: req.user.id,
          type: "review_created",
          templateKey: "orderEvents.reviewCreated",
          params: { rating: input.rating }
        },
        client
      );
      await enqueueDomainEvent(client, {
        eventKey: `review.created:${createdReview.id}`,
        eventType: "review.created",
        aggregateType: "review",
        aggregateId: createdReview.id,
        payload: {
          reviewId: createdReview.id,
          orderId: id,
          sellerId: order.seller_id,
          rating: input.rating
        }
      });
      return { review: createdReview, created: true };
    });
    if (!result.created) res.setHeader("Idempotency-Replayed", "true");
    res.status(result.created ? 201 : 200).json({ review: result.review });
  })
);

export default router;
