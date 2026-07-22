import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
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

        const amountCents = Number(product.price_cents) * input.quantity;
        const orderResult = await client.query(
          `insert into orders(buyer_id, seller_id, product_id, quantity, amount_cents, currency)
           values ($1, $2, $3, $4, $5, $6)
           returning *`,
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
          body: { order: createdOrder, conversationId },
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
    const cacheKey = `orders:${req.user.id}:${role}:${status ?? "any"}`;
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

    const result = await pool.query(
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
       order by o.created_at desc
       limit 100`,
      values
    );
    const payload = { orders: result.rows };
    await cacheSet(cacheKey, payload, 15);
    res.json(payload);
  })
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const cached = await cacheGet(`order:${id}:${req.user.id}`);
    if (cached) return res.json(cached);
    const result = await pool.query(
      `select o.id, o.buyer_id as "buyerId", o.seller_id as "sellerId", o.product_id as "productId",
              o.quantity, o.amount_cents as "amountCents", o.fee_cents as "feeCents", o.currency,
              o.status, o.payment_provider as "paymentProvider", o.payment_reference as "paymentReference",
              o.delivery_note as "deliveryNote", o.auto_release_at as "autoReleaseAt",
              o.paid_at as "paidAt", o.delivered_at as "deliveredAt", o.completed_at as "completedAt",
              o.created_at as "createdAt", o.updated_at as "updatedAt",
              p.title as "productTitle", p.description as "productDescription",
              b.display_name as "buyerDisplayName", s.display_name as "sellerDisplayName"
       from orders o
       join products p on p.id = o.product_id
       join users b on b.id = o.buyer_id
       join users s on s.id = o.seller_id
       where o.id = $1`,
      [id]
    );
    const order = result.rows[0];
    if (!order) throw notFound("Order not found");
    if (!canSeeOrder(order, req.user)) throw forbidden();
    const events = await pool.query(
      `select e.id, e.order_id as "orderId", e.actor_id as "actorId", u.display_name as "actorDisplayName",
              e.type, e.title, e.body, e.metadata, e.created_at as "createdAt"
       from order_events e
       left join users u on u.id = e.actor_id
       where e.order_id = $1
       order by e.created_at asc`,
      [id]
    );
    const payload = { order, events: events.rows };
    await cacheSet(`order:${id}:${req.user.id}`, payload, 15);
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
      const result = await client.query(
        `update orders
         set status = 'in_progress', updated_at = now()
         where id = $1 and seller_id = $2 and status = 'paid'
         returning *`,
        [id, req.user.id]
      );
      const updatedOrder = result.rows[0];
      if (!updatedOrder) {
        throw badRequest("Only the seller can start a paid order");
      }
      await recordOrderEvent(
        {
          orderId: id,
          actorId: req.user.id,
          type: "started",
          templateKey: "orderEvents.started"
        },
        client
      );
      const message = await createOrderSystemMessage(
        {
          orderId: id,
          type: "seller_started",
          bodyKey: "system.sellerStarted"
        },
        client
      );
      await enqueueDomainEvent(client, {
        eventKey: `order.started:${id}`,
        eventType: "order.started",
        aggregateType: "order",
        aggregateId: id,
        payload: {
          orderId: id,
          buyerId: updatedOrder.buyer_id,
          sellerId: updatedOrder.seller_id,
          productId: updatedOrder.product_id,
          systemMessageIds: message ? [message.id] : []
        }
      });
      return updatedOrder;
    });
    res.json({ order });
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
      const result = await client.query(
        `update orders
         set status = 'delivered',
             delivery_note = $3,
             delivered_at = now(),
             auto_release_at = now() + make_interval(hours => $4::int),
             updated_at = now()
         where id = $1 and seller_id = $2 and status in ('paid', 'in_progress')
         returning *`,
        [id, req.user.id, input.deliveryNote, env.AUTO_RELEASE_HOURS]
      );
      const updatedOrder = result.rows[0];
      if (!updatedOrder) {
        throw badRequest("Only the seller can deliver an active escrowed order");
      }
      await recordOrderEvent(
        {
          orderId: id,
          actorId: req.user.id,
          type: "delivered",
          templateKey: "orderEvents.delivered"
        },
        client
      );
      const message = await createOrderSystemMessage(
        {
          orderId: id,
          type: "delivery_sent",
          bodyKey: "system.deliverySent"
        },
        client
      );
      await enqueueDomainEvent(client, {
        eventKey: `order.delivered:${id}`,
        eventType: "order.delivered",
        aggregateType: "order",
        aggregateId: id,
        payload: {
          orderId: id,
          buyerId: updatedOrder.buyer_id,
          sellerId: updatedOrder.seller_id,
          productId: updatedOrder.product_id,
          systemMessageIds: message ? [message.id] : []
        }
      });
      return updatedOrder;
    });
    res.json({ order });
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
      actorId: req.user.id,
      afterUpdate: async (client) => {
        await recordOrderEvent(
          {
            orderId: id,
            actorId: req.user.id,
            type: "completed",
            templateKey: "orderEvents.completed"
          },
          client
        );
        const message = await createOrderSystemMessage(
          {
            orderId: id,
            type: "escrow_released",
            bodyKey: "system.escrowReleased"
          },
          client
        );
        return { systemMessageIds: message ? [message.id] : [] };
      }
    });
    res.json({ order: updated });
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
        `select * from orders where id = $1 for update`,
        [id]
      );
      const order = orderResult.rows[0];
      if (!order) throw notFound("Order not found");
      if (order.buyer_id !== req.user.id) {
        throw forbidden("Only the buyer can review this order");
      }

      const existing = await client.query(
        `select * from reviews where order_id = $1`,
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
         returning *`,
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
