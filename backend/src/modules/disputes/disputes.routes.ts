import { Router } from "express";
import { z } from "zod";
import { inTx, pool } from "../../db/pool.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { buildNextCursor, keysetWhereClause, parseCursorPage } from "../../common/pagination.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { DISPUTE_DECISIONS } from "../../domain/enums.js";
import { canTransitionOrder } from "../orders/order-transitions.js";
import {
  selectOrderForUpdate,
  transitionOrder
} from "../orders/order-transition.service.js";
import { getMessagePage } from "../chat/chat.service.js";
import { createOrderSystemMessage } from "../chat/system-messages.service.js";
import {
  createDisputeMessage,
  getOrderDispute,
  hideDisputeMessage,
  listDisputeMessagePage
} from "./dispute-messages.service.js";
import { resolveDisputeResolution } from "./dispute-resolution.service.js";
import {
  mapDisputeAdminDto,
  mapDisputeAdminSummaryDto,
  mapDisputeModeratorDto,
  mapDisputeModeratorSummaryDto,
  mapDisputeParticipantDto,
  type DisputeAdminRow,
  type DisputeParticipantRow,
  type DisputeStaffSummaryRow
} from "./dispute.dto.js";
import { mapAdminOrderMutationDto } from "../orders/orders.dto.js";
import { cacheDelPattern } from "../../common/redis.js";

const router = Router();

const openSchema = z.object({
  reason: z.string().min(10).max(3000)
});

const resolveSchema = z.object({
  decision: z.enum(DISPUTE_DECISIONS),
  adminNote: z.string().min(3).max(3000)
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachmentUploadId: z.string().uuid().optional(),
  attachmentUrl: z.undefined().optional()
});

const hideMessageSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

type DisputeDetailRow = DisputeAdminRow & {
  conversationId: string | null;
};

async function selectDisputeDetail(disputeId: string) {
  const result = await pool.query<DisputeDetailRow>(
    `select d.id,
            d.order_id as "orderId",
            d.opened_by as "openedBy",
            d.reason,
            d.status,
            d.resolution,
            d.resolution_decision as "resolutionDecision",
            d.resolution_operation_id as "resolutionOperationId",
            d.resolving_started_at as "resolvingStartedAt",
            d.resolution_attempts as "resolutionAttempts",
            d.last_resolution_error as "lastResolutionError",
            d.admin_id as "adminId",
            d.admin_note as "adminNote",
            d.created_at as "createdAt",
            d.resolved_at as "resolvedAt",
            o.buyer_id as "buyerId",
            o.seller_id as "sellerId",
            o.amount_cents as "amountCents",
            o.currency,
            o.status as "orderStatus",
            p.title as "productTitle",
            c.id as "conversationId"
     from disputes d
     join orders o on o.id = d.order_id
     join products p on p.id = o.product_id
     left join conversations c on c.order_id = o.id
     where d.id = $1`,
    [disputeId]
  );
  const dispute = result.rows[0];
  if (!dispute) throw notFound("Dispute not found");
  return dispute;
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
    const { dispute, repeated, messageSuggested, buyerId, sellerId } = await inTx(async (client) => {
      const orderRow = await selectOrderForUpdate(client, orderId);
      if (orderRow.buyer_id !== req.user.id && orderRow.seller_id !== req.user.id) throw forbidden();

      const isRepeat = orderRow.status === "disputed";
      if (!isRepeat && !canTransitionOrder(orderRow.status, "disputed")) {
        throw badRequest("Only active escrowed orders can be disputed");
      }

      if (isRepeat) {
        const existing = await client.query<DisputeParticipantRow>(
          `select id,
                  order_id as "orderId",
                  opened_by as "openedBy",
                  reason,
                  status,
                  resolution,
                  resolution_decision as "resolutionDecision",
                  created_at as "createdAt",
                  resolved_at as "resolvedAt"
           from disputes
           where order_id = $1
           for update`,
          [orderId]
        );
        const existingDispute = existing.rows[0];
        if (!existingDispute) throw badRequest("Dispute state is inconsistent");
        return {
          dispute: existingDispute,
          repeated: true,
          messageSuggested:
            existingDispute.openedBy !== req.user.id ||
            existingDispute.reason !== input.reason,
          buyerId: orderRow.buyer_id as string,
          sellerId: orderRow.seller_id as string
        };
      }

      const inserted = await client.query<DisputeParticipantRow>(
        `insert into disputes(order_id, opened_by, reason)
         values ($1, $2, $3)
         returning id,
                   order_id as "orderId",
                   opened_by as "openedBy",
                   reason,
                   status,
                   resolution,
                   resolution_decision as "resolutionDecision",
                   created_at as "createdAt",
                   resolved_at as "resolvedAt"`,
        [orderId, req.user.id, input.reason]
      );
      const createdDispute = inserted.rows[0];
      const message = await createOrderSystemMessage(
        {
          orderId,
          type: "dispute_opened",
          bodyKey: "system.disputeOpened",
          params: { reason: input.reason }
        },
        client
      );
      await transitionOrder(client, {
        orderId,
        to: "disputed",
        actor: { kind: "user", id: req.user.id, role: "participant" },
        reason: "dispute_opened",
        expectedFrom: ["paid", "in_progress", "delivered"],
        metadata: {
          disputeId: createdDispute.id,
          // The dispute reason is user-generated content - stored raw, never translated.
          disputeReason: input.reason,
          systemMessageIds: message ? [message.id] : []
        }
      });
      return {
        dispute: createdDispute,
        repeated: false,
        messageSuggested: false,
        buyerId: orderRow.buyer_id as string,
        sellerId: orderRow.seller_id as string
      };
    });

    if (repeated) {
      return res.status(200).json({
        dispute: mapDisputeParticipantDto(dispute),
        repeated: true,
        messageSuggested
      });
    }

    // The order detail includes both status and its event timeline. Opening a dispute
    // changes both inside the transaction above, so every participant/admin detail and
    // list variant must miss its previous 15-second cache immediately.
    await Promise.all([
      cacheDelPattern(`order:${orderId}:*`),
      cacheDelPattern(`orders:${buyerId}:*`),
      cacheDelPattern(`orders:${sellerId}:*`)
    ]);

    res.status(201).json({ dispute: mapDisputeParticipantDto(dispute) });
  })
);

router.get(
  "/:id/messages",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { limit, cursor } = parseCursorPage(req.query, { defaultLimit: 50 });
    const page = await listDisputeMessagePage(id, req.user, { limit, cursor });
    res.json(page);
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
      attachmentUploadId: input.attachmentUploadId
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
  requireRole("admin", "moderator"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { limit, cursor } = parseCursorPage(req.query);
    const values: unknown[] = [];
    const where = keysetWhereClause(values, cursor, "d.created_at", "d.id");
    values.push(limit);

    const result = await pool.query<DisputeStaffSummaryRow>(
      `select d.id,
              d.order_id as "orderId",
              d.opened_by as "openedBy",
              d.reason,
              d.status,
              d.resolution,
              d.resolution_decision as "resolutionDecision",
              d.resolution_operation_id as "resolutionOperationId",
              d.resolving_started_at as "resolvingStartedAt",
              d.resolution_attempts as "resolutionAttempts",
              d.last_resolution_error as "lastResolutionError",
              d.admin_id as "adminId",
              d.admin_note as "adminNote",
              d.created_at as "createdAt",
              d.resolved_at as "resolvedAt",
              o.buyer_id as "buyerId",
              o.seller_id as "sellerId",
              o.amount_cents as "amountCents",
              o.currency,
              o.status as "orderStatus",
              p.title as "productTitle",
              b.display_name as "buyerDisplayName",
              s.display_name as "sellerDisplayName"
       from disputes d
       join orders o on o.id = d.order_id
       join products p on p.id = o.product_id
       join users b on b.id = o.buyer_id
       join users s on s.id = o.seller_id
       ${where ? `where ${where}` : ""}
       order by d.created_at desc, d.id desc
       limit $${values.length}`,
      values
    );
    const disputes = result.rows.map((dispute) =>
      req.user.role === "admin"
        ? mapDisputeAdminSummaryDto(dispute)
        : mapDisputeModeratorSummaryDto(dispute)
    );
    res.json({ disputes, nextCursor: buildNextCursor(result.rows, limit) });
  })
);

router.get(
  "/:id",
  authenticate,
  requireRole("admin", "moderator"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const dispute = await selectDisputeDetail(id);

    // Order chat lives on conversation_id, not the legacy messages.order_id column - a
    // dispute must look the conversation up by order_id first, then read messages by
    // conversation_id, the same way the regular chat endpoints do.
    const messagePage = dispute.conversationId
      ? await getMessagePage(dispute.conversationId, {
          limit: 100,
          viewerIsAdmin: req.user.role === "admin"
        })
      : { messages: [], nextCursor: null };
    const disputeMessagePage = await listDisputeMessagePage(id, req.user, { limit: 100 });
    const staffDispute = req.user.role === "admin"
      ? mapDisputeAdminDto(dispute)
      : mapDisputeModeratorDto(dispute);

    res.json({
      dispute: staffDispute,
      messages: messagePage.messages,
      messageNextCursor: messagePage.nextCursor,
      disputeMessages: disputeMessagePage.messages,
      disputeMessageNextCursor: disputeMessagePage.nextCursor
    });
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
    const dispute = await selectDisputeDetail(id);
    res.json({
      dispute: mapDisputeAdminDto(dispute),
      order: result.order ? mapAdminOrderMutationDto(result.order) : null,
      operationId: result.operationId,
      idempotent: !result.newlyResolved
    });
  })
);

export default router;
