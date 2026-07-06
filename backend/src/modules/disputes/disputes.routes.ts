import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { refundEscrow, releaseEscrow } from "../orders/ledger.service.js";
import { recordOrderEvent } from "../orders/order-events.service.js";
import { notifyOrderEvent } from "../chat/ws.service.js";
import { createNotification, notifyAdmins } from "../notifications/notifications.service.js";
import { getMessages, postOrderSystemMessage } from "../chat/chat.service.js";

const router = Router();

const openSchema = z.object({
  reason: z.string().min(10).max(3000)
});

const resolveSchema = z.object({
  decision: z.enum(["refund", "release"]),
  adminNote: z.string().min(3).max(3000)
});

router.post(
  "/orders/:orderId/dispute",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.orderId);
    const input = openSchema.parse(req.body);
    const order = await pool.query(`select * from orders where id = $1`, [orderId]);
    const row = order.rows[0];
    if (!row) throw notFound("Order not found");
    if (row.buyer_id !== req.user.id && row.seller_id !== req.user.id) throw forbidden();
    if (!["paid", "in_progress", "delivered"].includes(row.status)) {
      throw badRequest("Only active escrowed orders can be disputed");
    }

    await pool.query(`update orders set status = 'disputed', updated_at = now() where id = $1`, [orderId]);
    const dispute = await pool.query(
      `insert into disputes(order_id, opened_by, reason)
       values ($1, $2, $3)
       on conflict (order_id) do update set reason = excluded.reason, updated_at = now()
       returning *`,
      [orderId, req.user.id, input.reason]
    );

    notifyOrderEvent(row.buyer_id, { type: "order_disputed", orderId });
    notifyOrderEvent(row.seller_id, { type: "order_disputed", orderId });
    await Promise.all(
      [row.buyer_id, row.seller_id].map((userId: string) =>
        createNotification({
          userId,
          type: "order_disputed",
          templateKey: "notifications.orderDisputed",
          orderId
        })
      )
    );
    await notifyAdmins({ type: "dispute_new_admin", templateKey: "notifications.disputeNewAdmin", orderId });
    await recordOrderEvent({
      orderId,
      actorId: req.user.id,
      type: "disputed",
      templateKey: "orderEvents.disputed",
      // The dispute reason is user-generated content — stored raw, never translated.
      body: input.reason
    });
    await postOrderSystemMessage(orderId, "dispute_opened", "system.disputeOpened", { reason: input.reason });
    res.status(201).json({ dispute: dispute.rows[0] });
  })
);

router.get(
  "/",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select d.id, d.status, d.reason, d.resolution, d.admin_note as "adminNote",
              d.created_at as "createdAt", d.resolved_at as "resolvedAt",
              o.id as "orderId", o.amount_cents as "amountCents", o.currency, o.status as "orderStatus",
              p.title as "productTitle",
              b.display_name as "buyerDisplayName", s.display_name as "sellerDisplayName"
       from disputes d
       join orders o on o.id = d.order_id
       join products p on p.id = o.product_id
       join users b on b.id = o.buyer_id
       join users s on s.id = o.seller_id
       order by d.created_at desc`
    );
    res.json({ disputes: result.rows });
  })
);

router.get(
  "/:id",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const dispute = await pool.query(
      `select d.*, o.buyer_id, o.seller_id, o.amount_cents, o.currency, o.status as order_status,
              p.title as product_title, c.id as conversation_id
       from disputes d
       join orders o on o.id = d.order_id
       join products p on p.id = o.product_id
       left join conversations c on c.order_id = o.id
       where d.id = $1`,
      [id]
    );
    if (!dispute.rows[0]) throw notFound("Dispute not found");

    // Order chat lives on conversation_id, not the legacy messages.order_id column - a
    // dispute must look the conversation up by order_id first, then read messages by
    // conversation_id, the same way the regular chat endpoints do.
    const messages = dispute.rows[0].conversation_id
      ? await getMessages(dispute.rows[0].conversation_id, { limit: 200, viewerIsAdmin: true })
      : [];

    res.json({ dispute: dispute.rows[0], messages });
  })
);

router.post(
  "/:id/resolve",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = resolveSchema.parse(req.body);
    const dispute = await pool.query(
      `select d.*, o.buyer_id, o.seller_id
       from disputes d
       join orders o on o.id = d.order_id
       where d.id = $1`,
      [id]
    );
    const row = dispute.rows[0];
    if (!row) throw notFound("Dispute not found");
    if (row.status !== "open") throw badRequest("Dispute already resolved");

    const order =
      input.decision === "refund"
        ? await refundEscrow(row.order_id, req.user.id)
        : await releaseEscrow(row.order_id, req.user.id);

    const updated = await pool.query(
      `update disputes
       set status = 'resolved',
           resolution = $2,
           admin_id = $3,
           admin_note = $4,
           resolved_at = now(),
           updated_at = now()
       where id = $1
       returning *`,
      [id, input.decision, req.user.id, input.adminNote]
    );

    notifyOrderEvent(row.buyer_id, { type: "dispute_resolved", orderId: row.order_id, decision: input.decision });
    notifyOrderEvent(row.seller_id, { type: "dispute_resolved", orderId: row.order_id, decision: input.decision });
    await Promise.all(
      [row.buyer_id, row.seller_id].map((userId: string) =>
        createNotification({
          userId,
          type: "dispute_resolved",
          titleKey: "notifications.disputeResolved.title",
          bodyKey: input.decision === "refund" ? "notifications.disputeResolved.bodyRefund" : "notifications.disputeResolved.bodyRelease",
          orderId: row.order_id
        })
      )
    );
    await recordOrderEvent({
      orderId: row.order_id,
      actorId: req.user.id,
      type: "dispute_resolved",
      templateKey: "orderEvents.disputeResolved",
      // The admin note is free text written by the admin — stored raw, never translated.
      body: input.adminNote,
      metadata: { decision: input.decision }
    });
    await postOrderSystemMessage(row.order_id, "dispute_resolved", "system.disputeResolved", { note: input.adminNote }, {
      decision: input.decision
    });
    await postOrderSystemMessage(
      row.order_id,
      input.decision === "refund" ? "refunded" : "escrow_released",
      input.decision === "refund" ? "system.refunded" : "system.fundsReleased"
    );
    res.json({ dispute: updated.rows[0], order });
  })
);

export default router;
