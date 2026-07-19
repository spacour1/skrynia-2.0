import { Router } from "express";
import { z } from "zod";
import { inTx, pool } from "../../db/pool.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { recordOrderEvent } from "../orders/order-events.service.js";
import { getMessages } from "../chat/chat.service.js";
import { createOrderSystemMessage } from "../chat/system-messages.service.js";
import { enqueueDomainEvent } from "../outbox/outbox.service.js";
import {
  createDisputeMessage,
  getOrderDispute,
  hideDisputeMessage,
  listDisputeMessages
} from "./dispute-messages.service.js";
import { resolveDisputeResolution } from "./dispute-resolution.service.js";

const router = Router();

const openSchema = z.object({
  reason: z.string().min(10).max(3000)
});

const resolveSchema = z.object({
  decision: z.enum(["refund", "release"]),
  adminNote: z.string().min(3).max(3000)
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachmentUrl: z.string().url().max(2048).optional().nullable()
});

const hideMessageSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

function participantDisputeDto(dispute: Record<string, unknown>) {
  return {
    id: dispute.id,
    order_id: dispute.order_id,
    opened_by: dispute.opened_by,
    reason: dispute.reason,
    status: dispute.status,
    resolution: dispute.resolution,
    created_at: dispute.created_at,
    resolved_at: dispute.resolved_at
  };
}

router.get(
  "/orders/:orderId/dispute",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.orderId);
    const result = await getOrderDispute(orderId, req.user);
    res.json(result);
  })
);

router.post(
  "/orders/:orderId/dispute",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.orderId);
    const input = openSchema.parse(req.body);

    // Order lock, status flip, and dispute creation/check are one transaction. There is no
    // window where the order says 'disputed' but no dispute row exists, and two concurrent
    // opens (or an open racing a confirm/deliver transition) serialize on the row lock.
    const { dispute, repeated, messageSuggested } = await inTx(async (client) => {
      const order = await client.query(`select * from orders where id = $1 for update`, [orderId]);
      const orderRow = order.rows[0];
      if (!orderRow) throw notFound("Order not found");
      if (orderRow.buyer_id !== req.user.id && orderRow.seller_id !== req.user.id) throw forbidden();

      const isRepeat = orderRow.status === "disputed";
      if (!isRepeat && !["paid", "in_progress", "delivered"].includes(orderRow.status)) {
        throw badRequest("Only active escrowed orders can be disputed");
      }

      if (isRepeat) {
        const existing = await client.query(
          `select * from disputes where order_id = $1 for update`,
          [orderId]
        );
        const existingDispute = existing.rows[0];
        if (!existingDispute) throw badRequest("Dispute state is inconsistent");
        return {
          dispute: existingDispute,
          repeated: true,
          messageSuggested:
            existingDispute.opened_by !== req.user.id ||
            existingDispute.reason !== input.reason
        };
      }

      await client.query(`update orders set status = 'disputed', updated_at = now() where id = $1`, [orderId]);
      const inserted = await client.query(
        `insert into disputes(order_id, opened_by, reason)
         values ($1, $2, $3)
         returning *`,
        [orderId, req.user.id, input.reason]
      );
      const createdDispute = inserted.rows[0];
      await recordOrderEvent(
        {
          orderId,
          actorId: req.user.id,
          type: "disputed",
          templateKey: "orderEvents.disputed",
          // The dispute reason is user-generated content - stored raw, never translated.
          body: input.reason
        },
        client
      );
      const message = await createOrderSystemMessage(
        {
          orderId,
          type: "dispute_opened",
          bodyKey: "system.disputeOpened",
          params: { reason: input.reason }
        },
        client
      );
      await enqueueDomainEvent(client, {
        eventKey: `dispute.opened:${createdDispute.id}`,
        eventType: "dispute.opened",
        aggregateType: "dispute",
        aggregateId: createdDispute.id,
        payload: {
          disputeId: createdDispute.id,
          orderId,
          buyerId: orderRow.buyer_id,
          sellerId: orderRow.seller_id,
          productId: orderRow.product_id,
          systemMessageIds: message ? [message.id] : []
        }
      });
      return {
        dispute: createdDispute,
        repeated: false,
        messageSuggested: false
      };
    });

    if (repeated) {
      return res.status(200).json({
        dispute: participantDisputeDto(dispute),
        repeated: true,
        messageSuggested
      });
    }

    res.status(201).json({ dispute: participantDisputeDto(dispute) });
  })
);

router.get(
  "/:id/messages",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const messages = await listDisputeMessages(id, req.user);
    res.json({ messages });
  })
);

router.post(
  "/:id/messages",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = messageSchema.parse(req.body);
    const message = await createDisputeMessage({
      disputeId: id,
      user: req.user,
      body: input.body,
      attachmentUrl: input.attachmentUrl
    });
    res.status(201).json({ message });
  })
);

router.post(
  "/:id/messages/:messageId/hide",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const messageId = z.string().uuid().parse(req.params.messageId);
    const input = hideMessageSchema.parse(req.body);
    const message = await hideDisputeMessage({
      disputeId: id,
      messageId,
      admin: req.user,
      reason: input.reason
    });
    res.json({ message });
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
    const disputeMessages = await listDisputeMessages(id, req.user);

    res.json({ dispute: dispute.rows[0], messages, disputeMessages });
  })
);

router.post(
  "/:id/resolve",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = resolveSchema.parse(req.body);

    // The service persists a stable decision/operation before touching escrow and can
    // reconcile that operation after a crash without accepting a replacement decision.
    const result = await resolveDisputeResolution({
      disputeId: id,
      decision: input.decision,
      adminId: req.user.id,
      adminNote: input.adminNote
    });
    const row = result.dispute;

    res.json({
      dispute: row,
      order: result.order,
      operationId: result.operationId,
      idempotent: !result.newlyResolved
    });
  })
);

export default router;
