import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { inTx, pool } from "../../db/pool.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { cacheDel, cacheDelPattern, cacheGet, cacheSet } from "../../common/redis.js";
import type { AuthedRequest } from "../../common/types.js";
import { releaseEscrow } from "./ledger.service.js";
import { recordOrderEvent } from "./order-events.service.js";
import { notifyOrderEvent, broadcastConversation } from "../chat/ws.service.js";
import { createNotification } from "../notifications/notifications.service.js";
import { createSystemMessage, postOrderSystemMessage } from "../chat/chat.service.js";

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

function canSeeOrder(order: { buyer_id: string; seller_id: string }, user: AuthedRequest["user"]) {
  return user.role === "admin" || order.buyer_id === user.id || order.seller_id === user.id;
}

router.post(
  "/",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = createOrderSchema.parse(req.body);

    const { order, conversationId, systemMessage } = await inTx(async (client) => {
      const productResult = await client.query(
        `select p.id, p.seller_id, p.price_cents, p.currency, p.stock, p.status, u.is_banned
         from products p
         join users u on u.id = p.seller_id
         where p.id = $1
         for update of p`,
        [input.productId]
      );
      const product = productResult.rows[0];
      if (!product || product.status !== "active" || product.is_banned) throw notFound("Product is unavailable");
      if (product.seller_id === req.user.id) throw badRequest("You cannot buy your own listing");
      if (product.stock < input.quantity) throw badRequest("Not enough stock");

      const amountCents = Number(product.price_cents) * input.quantity;
      const orderResult = await client.query(
        `insert into orders(buyer_id, seller_id, product_id, quantity, amount_cents, currency)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [req.user.id, product.seller_id, product.id, input.quantity, amountCents, product.currency]
      );
      const createdOrder = orderResult.rows[0];

      // Every order gets its own chat: reuse the buyer/seller/product conversation if one
      // already exists (e.g. they chatted about the listing first, or bought it before),
      // and attach this order to it if it isn't already tied to an earlier one.
      const conversationResult = await client.query(
        `insert into conversations(buyer_id, seller_id, product_id, order_id)
         values ($1, $2, $3, $4)
         on conflict (buyer_id, seller_id, product_id) where product_id is not null
         do update set order_id = coalesce(conversations.order_id, excluded.order_id)
         returning id`,
        [req.user.id, product.seller_id, product.id, createdOrder.id]
      );
      const newConversationId = conversationResult.rows[0].id as string;

      const message = await createSystemMessage(
        {
          conversationId: newConversationId,
          type: "order_created",
          bodyKey: "system.orderCreated"
        },
        client
      );

      return { order: createdOrder, conversationId: newConversationId, systemMessage: message };
    });

    broadcastConversation(conversationId, { type: "message", message: systemMessage });
    await createNotification({
      userId: order.seller_id,
      type: "order_created",
      templateKey: "notifications.orderCreated",
      orderId: order.id,
      productId: order.product_id
    });
    await recordOrderEvent({
      orderId: order.id,
      actorId: req.user.id,
      type: "created",
      templateKey: "orderEvents.created"
    });
    await cacheDelPattern(`orders:${req.user.id}:*`);
    await cacheDelPattern(`orders:${order.seller_id}:*`);

    res.status(201).json({ order, conversationId });
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
      `select o.*, p.title as product_title, p.description as product_description,
              b.display_name as buyer_display_name, s.display_name as seller_display_name
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
    const result = await pool.query(
      `update orders
       set status = 'in_progress', updated_at = now()
       where id = $1 and seller_id = $2 and status = 'paid'
       returning *`,
      [id, req.user.id]
    );
    if (!result.rows[0]) throw badRequest("Only the seller can start a paid order");
    await cacheDelPattern(`order:${id}:*`);
    await cacheDelPattern(`orders:${result.rows[0].buyer_id}:*`);
    await cacheDelPattern(`orders:${req.user.id}:*`);
    notifyOrderEvent(result.rows[0].buyer_id, { type: "order_started", orderId: id });
    await createNotification({
      userId: result.rows[0].buyer_id,
      type: "order_started",
      templateKey: "notifications.orderStarted",
      orderId: id,
      productId: result.rows[0].product_id
    });
    await recordOrderEvent({
      orderId: id,
      actorId: req.user.id,
      type: "started",
      templateKey: "orderEvents.started"
    });
    await postOrderSystemMessage(id, "seller_started", "system.sellerStarted");
    res.json({ order: result.rows[0] });
  })
);

router.post(
  "/:id/deliver",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = deliverSchema.parse(req.body);
    const result = await pool.query(
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
    if (!result.rows[0]) throw badRequest("Only the seller can deliver an active escrowed order");
    await cacheDelPattern(`order:${id}:*`);
    await cacheDelPattern(`orders:${result.rows[0].buyer_id}:*`);
    await cacheDelPattern(`orders:${req.user.id}:*`);
    notifyOrderEvent(result.rows[0].buyer_id, { type: "order_delivered", orderId: id });
    await createNotification({
      userId: result.rows[0].buyer_id,
      type: "order_delivered",
      templateKey: "notifications.orderDelivered",
      orderId: id,
      productId: result.rows[0].product_id
    });
    await recordOrderEvent({
      orderId: id,
      actorId: req.user.id,
      type: "delivered",
      templateKey: "orderEvents.delivered"
    });
    await postOrderSystemMessage(id, "delivery_sent", "system.deliverySent");
    res.json({ order: result.rows[0] });
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

    const updated = await releaseEscrow(id);
    notifyOrderEvent(order.seller_id, { type: "order_completed", orderId: id });
    await createNotification({
      userId: order.seller_id,
      type: "order_completed",
      templateKey: "notifications.orderCompleted",
      orderId: id
    });
    await recordOrderEvent({
      orderId: id,
      actorId: req.user.id,
      type: "completed",
      templateKey: "orderEvents.completed"
    });
    await postOrderSystemMessage(id, "escrow_released", "system.escrowReleased");
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
    const orderResult = await pool.query(`select * from orders where id = $1`, [id]);
    const order = orderResult.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== req.user.id) throw forbidden("Only the buyer can review this order");
    if (order.status !== "completed") throw badRequest("Reviews are allowed only after completed orders");

    const result = await pool.query(
      `insert into reviews(order_id, seller_id, buyer_id, rating, comment)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [id, order.seller_id, order.buyer_id, input.rating, input.comment ?? null]
    );
    await createNotification({
      userId: order.seller_id,
      type: "review_created",
      templateKey: "notifications.reviewCreated",
      params: { rating: input.rating },
      orderId: id
    });
    await recordOrderEvent({
      orderId: id,
      actorId: req.user.id,
      type: "review_created",
      templateKey: "orderEvents.reviewCreated",
      params: { rating: input.rating }
    });
    res.status(201).json({ review: result.rows[0] });
  })
);

export default router;
