import type { AuthUser } from "../../common/types.js";
import {
  attachStorageObject,
  buildMediaUrl
} from "../storage/storage.service.js";
import { badRequest, forbidden, notFound } from "../../common/errors.js";
import { inTx, pool, type DbClient } from "../../db/pool.js";

type DisputeAccessRow = {
  id: string;
  orderId: string;
  openedBy: string;
  reason: string;
  status: string;
  resolution: string | null;
  resolutionDecision: string | null;
  resolutionOperationId: string | null;
  resolutionAttempts: number;
  lastResolutionError: string | null;
  adminNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  buyerId: string;
  sellerId: string;
};

function isAdmin(user: AuthUser) {
  return user.role === "admin";
}

async function getDisputeAccess(
  client: DbClient,
  disputeId: string,
  user: AuthUser,
  forUpdate = false
) {
  const result = await client.query<DisputeAccessRow>(
    `select d.id,
            d.order_id as "orderId",
            d.opened_by as "openedBy",
            d.reason,
            d.status,
            d.resolution,
            d.resolution_decision as "resolutionDecision",
            d.resolution_operation_id as "resolutionOperationId",
            d.resolution_attempts as "resolutionAttempts",
            d.last_resolution_error as "lastResolutionError",
            d.admin_note as "adminNote",
            d.created_at as "createdAt",
            d.resolved_at as "resolvedAt",
            o.buyer_id as "buyerId",
            o.seller_id as "sellerId"
     from disputes d
     join orders o on o.id = d.order_id
     where d.id = $1
     ${forUpdate ? "for update of d" : ""}`,
    [disputeId]
  );
  const dispute = result.rows[0];
  if (!dispute) throw notFound("Dispute not found");
  if (!isAdmin(user) && dispute.buyerId !== user.id && dispute.sellerId !== user.id) {
    throw forbidden();
  }
  return dispute;
}

async function getDisputeAccessByOrder(orderId: string, user: AuthUser) {
  const result = await pool.query<{ id: string }>(
    `select d.id
     from disputes d
     join orders o on o.id = d.order_id
     where d.order_id = $1
       and ($2::boolean or o.buyer_id = $3 or o.seller_id = $3)`,
    [orderId, isAdmin(user), user.id]
  );
  const disputeId = result.rows[0]?.id;
  if (!disputeId) throw notFound("Dispute not found");
  return getDisputeAccess(pool, disputeId, user);
}

async function selectMessage(messageId: string) {
  const result = await pool.query(
    `select dm.id,
            dm.dispute_id as "disputeId",
            dm.author_id as "authorId",
            u.display_name as "authorDisplayName",
            u.role as "authorRole",
            dm.body,
            dm.attachment_url as "attachmentUrl",
            dm.hidden_at as "hiddenAt",
            dm.hidden_by as "hiddenBy",
            dm.moderation_reason as "moderationReason",
            dm.created_at as "createdAt"
     from dispute_messages dm
     join users u on u.id = dm.author_id
     where dm.id = $1`,
    [messageId]
  );
  return result.rows[0] ?? null;
}

export async function listDisputeMessages(disputeId: string, user: AuthUser) {
  await getDisputeAccess(pool, disputeId, user);
  const result = await pool.query(
    `select dm.id,
            dm.dispute_id as "disputeId",
            dm.author_id as "authorId",
            u.display_name as "authorDisplayName",
            u.role as "authorRole",
            dm.body,
            dm.attachment_url as "attachmentUrl",
            dm.hidden_at as "hiddenAt",
            dm.hidden_by as "hiddenBy",
            dm.moderation_reason as "moderationReason",
            dm.created_at as "createdAt"
     from dispute_messages dm
     join users u on u.id = dm.author_id
     where dm.dispute_id = $1
       and ($2::boolean or dm.hidden_at is null)
     order by dm.created_at, dm.id`,
    [disputeId, isAdmin(user)]
  );
  return result.rows;
}

export async function getOrderDispute(orderId: string, user: AuthUser) {
  const dispute = await getDisputeAccessByOrder(orderId, user);
  const messages = await listDisputeMessages(dispute.id, user);
  if (isAdmin(user)) return { dispute, messages };
  const {
    resolutionOperationId: _resolutionOperationId,
    lastResolutionError: _lastResolutionError,
    resolutionAttempts: _resolutionAttempts,
    ...participantDispute
  } = dispute;
  return { dispute: participantDispute, messages };
}

export async function createDisputeMessage(input: {
  disputeId: string;
  user: AuthUser;
  body: string;
  attachmentUploadId?: string;
}) {
  const messageId = await inTx(async (client) => {
    const dispute = await getDisputeAccess(client, input.disputeId, input.user, true);
    if (dispute.status === "resolved") {
      throw badRequest("Resolved disputes do not accept new messages");
    }

    const attachment = input.attachmentUploadId
      ? await attachStorageObject(client, {
          uploadId: input.attachmentUploadId,
          ownerId: input.user.id,
          purpose: "chat_attachment"
        })
      : null;

    const inserted = await client.query<{ id: string }>(
      `insert into dispute_messages(
         dispute_id, author_id, body, attachment_url,
         attachment_storage_object_id
       )
       values ($1, $2, $3, $4, $5)
       returning id`,
      [
        input.disputeId,
        input.user.id,
        input.body.trim(),
        attachment ? buildMediaUrl(attachment.objectKey) : null,
        attachment?.id ?? null
      ]
    );
    return inserted.rows[0].id;
  });

  return selectMessage(messageId);
}

export async function hideDisputeMessage(input: {
  disputeId: string;
  messageId: string;
  admin: AuthUser;
  reason: string;
}) {
  if (!isAdmin(input.admin)) throw forbidden();
  await getDisputeAccess(pool, input.disputeId, input.admin);
  const hidden = await pool.query<{ id: string }>(
    `update dispute_messages
     set hidden_at = now(),
         hidden_by = $3,
         moderation_reason = $4
     where id = $1
       and dispute_id = $2
       and hidden_at is null
     returning id`,
    [input.messageId, input.disputeId, input.admin.id, input.reason.trim()]
  );
  if (!hidden.rows[0]) {
    const existing = await pool.query<{ id: string }>(
      `select id from dispute_messages where id = $1 and dispute_id = $2`,
      [input.messageId, input.disputeId]
    );
    if (!existing.rows[0]) throw notFound("Dispute message not found");
  }
  return selectMessage(input.messageId);
}
