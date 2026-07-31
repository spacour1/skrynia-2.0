import type { AuthUser } from "../../common/types.js";
import {
  attachStorageObject,
  buildMediaUrl
} from "../storage/storage.service.js";
import { badRequest, forbidden, notFound } from "../../common/errors.js";
import { inTx, pool, type DbClient } from "../../db/pool.js";
import {
  buildNextCursor,
  keysetWhereClause,
  type DecodedCursor
} from "../../common/pagination.js";
import {
  mapAdminDisputeMessageDto,
  mapDisputeMessageDto,
  type DisputeMessageRow
} from "../chat/message.dto.js";
import {
  mapDisputeAdminDto,
  mapDisputeParticipantDto,
  type DisputeAdminRow
} from "./dispute.dto.js";

type DisputeAccessRow = {
  id: string;
  status: string;
  buyerId: string;
  sellerId: string;
};

function isAdmin(user: AuthUser) {
  return user.role === "admin";
}

function canReviewDisputes(user: AuthUser) {
  return user.role === "admin" || user.role === "moderator";
}

async function getDisputeAccess(
  client: DbClient,
  disputeId: string,
  user: AuthUser,
  forUpdate = false
) {
  const result = await client.query<DisputeAccessRow>(
    `select d.id,
            d.status,
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
  if (
    !canReviewDisputes(user) &&
    dispute.buyerId !== user.id &&
    dispute.sellerId !== user.id
  ) {
    throw forbidden();
  }
  return dispute;
}

async function getDisputeAccessByOrder(orderId: string, user: AuthUser) {
  const result = await pool.query<DisputeAdminRow>(
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
            p.title as "productTitle"
     from disputes d
     join orders o on o.id = d.order_id
     join products p on p.id = o.product_id
     where d.order_id = $1
       and ($2::boolean or o.buyer_id = $3 or o.seller_id = $3)`,
    [orderId, canReviewDisputes(user), user.id]
  );
  const dispute = result.rows[0];
  if (!dispute) throw notFound("Dispute not found");
  return dispute;
}

async function selectMessage(messageId: string) {
  const result = await pool.query<DisputeMessageRow>(
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

function mapMessageForViewer(row: DisputeMessageRow, user: AuthUser) {
  return isAdmin(user)
    ? mapAdminDisputeMessageDto(row)
    : mapDisputeMessageDto(row);
}

export async function listDisputeMessagePage(
  disputeId: string,
  user: AuthUser,
  options: { limit?: number; cursor?: DecodedCursor | null } = {}
) {
  await getDisputeAccess(pool, disputeId, user);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const values: unknown[] = [disputeId, isAdmin(user)];
  const cursorWhere = keysetWhereClause(values, options.cursor ?? null, "dm.created_at", "dm.id");
  values.push(limit);
  const result = await pool.query<DisputeMessageRow>(
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
       ${cursorWhere ? `and ${cursorWhere}` : ""}
     order by dm.created_at desc, dm.id desc
     limit $${values.length}`,
    values
  );
  const nextCursor = buildNextCursor(result.rows, limit);
  return {
    messages: result.rows.reverse().map((row) => mapMessageForViewer(row, user)),
    nextCursor
  };
}

export async function getOrderDispute(orderId: string, user: AuthUser) {
  const dispute = await getDisputeAccessByOrder(orderId, user);
  const messagePage = await listDisputeMessagePage(dispute.id, user);
  return {
    dispute: isAdmin(user)
      ? mapDisputeAdminDto(dispute)
      : mapDisputeParticipantDto(dispute),
    messages: messagePage.messages,
    messageNextCursor: messagePage.nextCursor
  };
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

  const message = await selectMessage(messageId);
  if (!message) throw notFound("Dispute message not found");
  return mapMessageForViewer(message, input.user);
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
  const message = await selectMessage(input.messageId);
  if (!message) throw notFound("Dispute message not found");
  return mapAdminDisputeMessageDto(message);
}
