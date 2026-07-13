import { Router } from "express";
import { z } from "zod";
import { inTx, pool } from "../../db/pool.js";
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

    // Order lock + status flip + dispute upsert are one transaction: there is no window
    // where the order says 'disputed' but no dispute row exists, and two concurrent opens
    // (or an open racing a confirm/deliver transition) serialize on the row lock.
    const { row, dispute, repeated } = await inTx(async (client) => {
      const order = await client.query(`select * from orders where id = $1 for update`, [orderId]);
      const orderRow = order.rows[0];
      if (!orderRow) throw notFound("Order not found");
      if (orderRow.buyer_id !== req.user.id && orderRow.seller_id !== req.user.id) throw forbidden();

      // A retry of an already-opened dispute is idempotent, not an error - it refreshes
      // the reason and returns the existing dispute.
      const isRepeat = orderRow.status === "disputed";
      if (!isRepeat && !["paid", "in_progress", "delivered"].includes(orderRow.status)) {
        throw badRequest("Only active escrowed orders can be disputed");
      }

      await client.query(`update orders set status = 'disputed', updated_at = now() where id = $1`, [orderId]);
      const upserted = await client.query(
        `insert into disputes(order_id, opened_by, reason)
         values ($1, $2, $3)
         on conflict (order_id) do update set reason = excluded.reason, updated_at = now()
         returning *`,
        [orderId, req.user.id, input.reason]
      );
      return { row: orderRow, dispute: upserted.rows[0], repeated: isRepeat };
    });

    if (repeated) return res.status(200).json({ dispute });

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
    res.status(201).json({ dispute });
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

    // Resolution state machine (open -> resolving -> resolved). The escrow operation is
    // the existing financial service and manages its own transaction, so it cannot join a
    // dispute UPDATE transaction - instead the dispute is atomically CLAIMED first:
    //  - two admins can never both pass the claim, so refund/release runs at most once;
    //  - if the escrow op throws, the claim reverts to 'open' and the resolve is retryable;
    //  - if the process dies after the escrow op but before the final update, the dispute
    //    stays 'resolving' with the order already terminal - a retry with the same
    //    decision finishes the bookkeeping WITHOUT running the escrow op again.
    const claim = await pool.query(
      `update disputes set status = 'resolving', admin_id = $2, updated_at = now()
       where id = $1 and status = 'open'
       returning *`,
      [id, req.user.id]
    );
    let row = claim.rows[0];
    let escrowAlreadyApplied = false;

    if (!row) {
      const existing = await pool.query(
        `select d.*, o.status as order_status
         from disputes d join orders o on o.id = d.order_id
         where d.id = $1`,
        [id]
      );
      const current = existing.rows[0];
      if (!current) throw notFound("Dispute not found");
      const terminalForDecision = input.decision === "refund" ? "refunded" : "completed";
      if (current.status === "resolving" && current.order_status === terminalForDecision) {
        row = current;
        escrowAlreadyApplied = true;
      } else if (current.status === "resolving") {
        throw badRequest("Dispute resolution is already in progress");
      } else {
        throw badRequest("Dispute already resolved");
      }
    }

    const orderParties = await pool.query(`select buyer_id, seller_id, status from orders where id = $1`, [row.order_id]);
    row = { ...row, ...orderParties.rows[0] };

    let order;
    if (!escrowAlreadyApplied) {
      try {
        order =
          input.decision === "refund"
            ? await refundEscrow(row.order_id, req.user.id)
            : await releaseEscrow(row.order_id, req.user.id);
      } catch (escrowError) {
        // Money did not move - release the claim so the resolution can be retried.
        await pool.query(`update disputes set status = 'open', updated_at = now() where id = $1 and status = 'resolving'`, [id]);
        throw escrowError;
      }
    }

    const updated = await pool.query(
      `update disputes
       set status = 'resolved',
           resolution = $2,
           admin_id = $3,
           admin_note = $4,
           resolved_at = now(),
           updated_at = now()
       where id = $1 and status = 'resolving'
       returning *`,
      [id, input.decision, req.user.id, input.adminNote]
    );
    if (!updated.rows[0]) throw badRequest("Dispute already resolved");

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
