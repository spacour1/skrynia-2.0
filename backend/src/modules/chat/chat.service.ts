import { randomUUID } from "node:crypto";
import { ApiError, badRequest, forbidden, notFound } from "../../common/errors.js";
import type { DbClient } from "../../db/pool.js";
import { inTx, pool } from "../../db/pool.js";
import type { TranslateParams } from "../../i18n/t.js";
import { broadcastConversation, isUserOnline } from "./ws.service.js";
import { enqueueDomainEvent } from "../outbox/outbox.service.js";
import {
  attachStorageObject,
  buildMediaUrl
} from "../storage/storage.service.js";
import {
  createSystemMessage,
  getConversationIdForOrder,
  SYSTEM_SENDER_DISPLAY_NAME
} from "./system-messages.service.js";
import { bigintToMoneyCents, type MoneyCents } from "../../domain/money.js";
import {
  buildNextCursor,
  keysetWhereClause,
  type DecodedCursor
} from "../../common/pagination.js";

export { createSystemMessage, getConversationIdForOrder };

export type ConversationParties = { buyerId: string; sellerId: string };

export type Message = {
  id: string;
  conversationId: string;
  senderId: string | null;
  clientMessageId?: string | null;
  senderDisplayName: string;
  body: string;
  attachmentUrl: string | null;
  attachmentUploadId?: string | null;
  createdAt: string;
  hidden?: boolean;
  kind?: "user" | "system";
  systemType?: string | null;
  metadata?: Record<string, unknown>;
};

export type ConversationContextType = "direct" | "product" | "order";

export type GroupedConversationContext = {
  conversationId: string;
  type: ConversationContextType;
  label: string;
  productId: string | null;
  productTitle: string | null;
  orderId: string | null;
  orderStatus: string | null;
  amountCents: MoneyCents | null;
  currency: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  blocked: boolean;
  canSendMessage: boolean;
  createdAt: string;
};

export type GroupedConversation = {
  peerUserId: string;
  peerDisplayName: string;
  peerAvatarUrl: string | null;
  isOnline: boolean | null;
  totalUnreadCount: number;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  contexts: GroupedConversationContext[];
};

const MIN_MESSAGE_LENGTH = 1;
const MAX_MESSAGE_LENGTH = 3000;
const HIDDEN_BODY_PLACEHOLDER = "[сообщение скрыто модератором]";

function messagingBlocked() {
  return new ApiError(403, "You cannot message this user", "messaging_blocked");
}

function userMuted() {
  return new ApiError(403, "Вы временно не можете отправлять сообщения — модератор ограничил доступ", "user_muted");
}

async function isMuted(userId: string): Promise<boolean> {
  const result = await pool.query(`select 1 from users where id = $1 and muted_until > now()`, [userId]);
  return Boolean(result.rows[0]);
}

async function getConversationParties(conversationId: string): Promise<ConversationParties> {
  const result = await pool.query(`select buyer_id as "buyerId", seller_id as "sellerId" from conversations where id = $1`, [
    conversationId
  ]);
  const row = result.rows[0];
  if (!row) throw notFound("Conversation not found");
  return row as ConversationParties;
}

async function isBlockedPair(userA: string, userB: string): Promise<boolean> {
  const result = await pool.query(
    `select 1 from user_blocks
     where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)
     limit 1`,
    [userA, userB]
  );
  return Boolean(result.rows[0]);
}

/**
 * Both REST and the WebSocket handler funnel through this module so access control,
 * message validation, and blocking rules only need to be implemented once.
 */
export async function assertConversationAccess(
  conversationId: string,
  userId: string,
  role: string
): Promise<ConversationParties> {
  const parties = await getConversationParties(conversationId);
  if (role !== "admin" && parties.buyerId !== userId && parties.sellerId !== userId) {
    throw forbidden();
  }
  return parties;
}

export async function assertCanSendMessage(conversationId: string, userId: string): Promise<ConversationParties> {
  const parties = await assertConversationAccess(conversationId, userId, "user");
  if (await isMuted(userId)) throw userMuted();
  const otherId = parties.buyerId === userId ? parties.sellerId : parties.buyerId;
  if (await isBlockedPair(userId, otherId)) throw messagingBlocked();
  return parties;
}

async function findConversation(input: { buyerId: string; sellerId: string; productId: string | null }) {
  const lookupSql = input.productId
    ? `select id from conversations where buyer_id = $1 and seller_id = $2 and product_id = $3 and order_id is null`
    : `select id from conversations
       where product_id is null and order_id is null
         and ((buyer_id = $1 and seller_id = $2) or (buyer_id = $2 and seller_id = $1))`;
  const lookupValues = input.productId ? [input.buyerId, input.sellerId, input.productId] : [input.buyerId, input.sellerId];
  return { lookupSql, lookupValues };
}

async function getOrCreateConversation(
  input: { buyerId: string; sellerId: string; productId: string | null },
  client: DbClient = pool
) {
  if (input.buyerId === input.sellerId) throw badRequest("You cannot message yourself");
  if (await isBlockedPair(input.buyerId, input.sellerId)) throw messagingBlocked();

  const { lookupSql, lookupValues } = await findConversation(input);
  const existing = await client.query(lookupSql, lookupValues);
  if (existing.rows[0]) return { id: existing.rows[0].id as string, existing: true };

  const created = await client.query(
    `insert into conversations(buyer_id, seller_id, product_id)
     values ($1, $2, $3)
     on conflict do nothing
     returning id`,
    [input.buyerId, input.sellerId, input.productId]
  );
  if (created.rows[0]) return { id: created.rows[0].id as string, existing: false };

  const reread = await client.query(lookupSql, lookupValues);
  return { id: reread.rows[0].id as string, existing: true };
}

export function getOrCreateProductConversation(
  input: { buyerId: string; sellerId: string; productId: string },
  client: DbClient = pool
) {
  return getOrCreateConversation({ buyerId: input.buyerId, sellerId: input.sellerId, productId: input.productId }, client);
}

export async function getExistingProductConversation(input: { buyerId: string; sellerId: string; productId: string }) {
  const result = await pool.query<{ id: string }>(
    `select id
     from conversations
     where buyer_id = $1
       and seller_id = $2
       and product_id = $3
       and order_id is null`,
    [input.buyerId, input.sellerId, input.productId]
  );
  return result.rows[0]?.id ?? null;
}

export function getOrCreateDirectConversation(input: { buyerId: string; sellerId: string }, client: DbClient = pool) {
  return getOrCreateConversation({ buyerId: input.buyerId, sellerId: input.sellerId, productId: null }, client);
}

export async function getOrCreateOrderConversation(
  input: { buyerId: string; sellerId: string; productId: string; orderId: string },
  client: DbClient = pool
) {
  if (input.buyerId === input.sellerId) throw badRequest("You cannot message yourself");

  const existing = await client.query(`select id from conversations where order_id = $1`, [input.orderId]);
  if (existing.rows[0]) return { id: existing.rows[0].id as string, existing: true };

  const created = await client.query(
    `insert into conversations(buyer_id, seller_id, product_id, order_id)
     values ($1, $2, $3, $4)
     on conflict do nothing
     returning id`,
    [input.buyerId, input.sellerId, input.productId, input.orderId]
  );
  if (created.rows[0]) return { id: created.rows[0].id as string, existing: false };

  const reread = await client.query(`select id from conversations where order_id = $1`, [input.orderId]);
  return { id: reread.rows[0].id as string, existing: true };
}

type IdempotentSendMessageInput = {
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  body: string;
  attachmentUploadId?: string;
};

export type SendMessageResult = {
  message: Message;
  created: boolean;
};

async function findMessageByClientId(
  client: DbClient,
  senderId: string,
  clientMessageId: string
): Promise<Message | null> {
  const result = await client.query(
    `select m.id, m.conversation_id as "conversationId",
            m.sender_id as "senderId",
            m.client_message_id as "clientMessageId",
            u.display_name as "senderDisplayName",
            m.body, m.attachment_url as "attachmentUrl",
            m.attachment_storage_object_id as "attachmentUploadId",
            m.created_at as "createdAt"
     from messages m
     join users u on u.id = m.sender_id
     where m.sender_id = $1 and m.client_message_id = $2`,
    [senderId, clientMessageId]
  );
  return (result.rows[0] as Message | undefined) ?? null;
}

function verifyMessageReplay(
  existing: Message,
  input: IdempotentSendMessageInput,
  body: string
) {
  if (
    existing.conversationId !== input.conversationId ||
    existing.body !== body ||
    (existing.attachmentUploadId ?? null) !==
      (input.attachmentUploadId ?? null)
  ) {
    throw new ApiError(
      409,
      "This client message ID was already used with different content",
      "client_message_id_reused"
    );
  }
  return { message: existing, created: false } satisfies SendMessageResult;
}

export async function sendMessageIdempotently(
  input: IdempotentSendMessageInput
): Promise<SendMessageResult> {
  const body = input.body.trim();
  if (body.length < MIN_MESSAGE_LENGTH || body.length > MAX_MESSAGE_LENGTH) throw badRequest("Invalid message");

  const replay = await findMessageByClientId(
    pool,
    input.senderId,
    input.clientMessageId
  );
  if (replay) return verifyMessageReplay(replay, input, body);

  await assertCanSendMessage(input.conversationId, input.senderId);

  return inTx(async (client) => {
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`message:${input.senderId}:${input.clientMessageId}`]
    );
    const lockedReplay = await findMessageByClientId(
      client,
      input.senderId,
      input.clientMessageId
    );
    if (lockedReplay) return verifyMessageReplay(lockedReplay, input, body);

    const attachment = input.attachmentUploadId
      ? await attachStorageObject(client, {
          uploadId: input.attachmentUploadId,
          ownerId: input.senderId,
          purpose: "chat_attachment"
        })
      : null;

    const result = await client.query(
      `insert into messages(
         conversation_id, sender_id, client_message_id, body, attachment_url,
         attachment_storage_object_id
       )
       values ($1, $2, $3, $4, $5, $6)
       on conflict (sender_id, client_message_id)
         where client_message_id is not null
       do nothing
       returning id, conversation_id as "conversationId", sender_id as "senderId",
                 client_message_id as "clientMessageId",
                 (select display_name from users where id = $2) as "senderDisplayName",
                 body, attachment_url as "attachmentUrl",
                 attachment_storage_object_id as "attachmentUploadId",
                 created_at as "createdAt"`,
      [
        input.conversationId,
        input.senderId,
        input.clientMessageId,
        body,
        attachment ? buildMediaUrl(attachment.objectKey) : null,
        attachment?.id ?? null
      ]
    );
    const message = result.rows[0] as Message | undefined;
    if (!message) {
      const concurrentReplay = await findMessageByClientId(
        client,
        input.senderId,
        input.clientMessageId
      );
      if (!concurrentReplay) {
        throw new Error("Message client ID conflicted but could not be read");
      }
      return verifyMessageReplay(concurrentReplay, input, body);
    }

    await enqueueDomainEvent(client, {
      eventKey: `message.created:${message.id}`,
      eventType: "message.created",
      aggregateType: "message",
      aggregateId: message.id,
      payload: { messageId: message.id }
    });
    return { message, created: true };
  });
}

export async function sendMessage(
  input: Omit<IdempotentSendMessageInput, "clientMessageId"> & {
    clientMessageId?: string;
  }
): Promise<Message> {
  const result = await sendMessageIdempotently({
    ...input,
    clientMessageId: input.clientMessageId ?? randomUUID()
  });
  return result.message;
}

export async function getMessagePage(
  conversationId: string,
  opts: { limit?: number; cursor?: DecodedCursor | null; before?: string; viewerIsAdmin?: boolean } = {}
): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const params: unknown[] = [conversationId];
  let beforeClause = "";
  if (opts.cursor) {
    const cursorWhere = keysetWhereClause(params, opts.cursor, "m.created_at", "m.id");
    beforeClause = `and ${cursorWhere}`;
  } else if (opts.before) {
    // Legacy timestamp-only paging remains accepted. New clients round-trip the
    // response cursor, which also contains the id tiebreaker.
    params.push(opts.before);
    beforeClause = `and m.created_at < $${params.length}`;
  }
  params.push(limit);
  const limitParamIndex = params.length;
  params.push(Boolean(opts.viewerIsAdmin));
  const adminParamIndex = params.length;

  const result = await pool.query(
    `select m.id, m.conversation_id as "conversationId", m.sender_id as "senderId",
            m.client_message_id as "clientMessageId",
            coalesce(u.display_name, '${SYSTEM_SENDER_DISPLAY_NAME}') as "senderDisplayName",
            case when m.hidden_at is not null and not $${adminParamIndex} then '${HIDDEN_BODY_PLACEHOLDER}' else m.body end as body,
            m.attachment_url as "attachmentUrl", m.created_at as "createdAt",
            (m.hidden_at is not null) as hidden,
            m.kind, m.system_type as "systemType", m.metadata
     from messages m
     left join users u on u.id = m.sender_id
     where m.conversation_id = $1 ${beforeClause}
     order by m.created_at desc, m.id desc
     limit $${limitParamIndex}`,
    params
  );
  const nextCursor = buildNextCursor(result.rows, limit);
  return { messages: result.rows.reverse(), nextCursor };
}

export async function getMessages(
  conversationId: string,
  opts: { limit?: number; cursor?: DecodedCursor | null; before?: string; viewerIsAdmin?: boolean } = {}
): Promise<Message[]> {
  return (await getMessagePage(conversationId, opts)).messages;
}

export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  await pool.query(
    `update conversations
     set buyer_last_read_at = case when buyer_id = $2 then now() else buyer_last_read_at end,
         seller_last_read_at = case when seller_id = $2 then now() else seller_last_read_at end
     where id = $1`,
    [conversationId, userId]
  );
}

/**
 * Convenience wrapper for order lifecycle routes, which only ever have an orderId on hand:
 * looks up the order's conversation, posts the system message, and broadcasts it over the
 * conversation's websocket room so an open chat updates live. A no-op for orders that predate
 * the order-chat feature and so have no conversation row.
 */
export async function postOrderSystemMessage(
  orderId: string,
  type: string,
  bodyKey: string,
  params?: TranslateParams,
  metadata?: Record<string, unknown>
): Promise<Message | null> {
  const conversationId = await getConversationIdForOrder(orderId);
  if (!conversationId) return null;
  const message = await createSystemMessage({ conversationId, type, bodyKey, params, metadata });
  broadcastConversation(conversationId, { type: "message", message });
  return message;
}

export async function getUserConversationPage(
  userId: string,
  role: string,
  options: { limit?: number; cursor?: DecodedCursor | null } = {}
) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
  const values: unknown[] = [role, userId];
  const cursorWhere = keysetWhereClause(
    values,
    options.cursor ?? null,
    `coalesce(lm."lastMessageAt", c.created_at)`,
    "c.id"
  );
  values.push(limit);
  const result = await pool.query(
    `select c.id, c.product_id as "productId", c.order_id as "orderId", c.created_at as "createdAt",
            p.title as "productTitle",
            b.id as "buyerId", b.display_name as "buyerDisplayName", b.avatar_url as "buyerAvatarUrl",
            s.id as "sellerId", s.display_name as "sellerDisplayName", s.avatar_url as "sellerAvatarUrl",
            o.status as "orderStatus", o.amount_cents as "amountCents", o.currency,
            lm."lastMessageBody", lm."lastMessageAt",
            coalesce(lm."lastMessageAt", c.created_at) as "activityAt",
            coalesce(unread.count, 0)::int as "unreadCount",
            exists(
              select 1 from user_blocks ub
              where (ub.blocker_id = $2 and ub.blocked_id = case when c.buyer_id = $2 then c.seller_id else c.buyer_id end)
                 or (ub.blocked_id = $2 and ub.blocker_id = case when c.buyer_id = $2 then c.seller_id else c.buyer_id end)
            ) as "blocked"
     from conversations c
     left join products p on p.id = c.product_id
     join users b on b.id = c.buyer_id
     join users s on s.id = c.seller_id
     left join orders o on o.id = c.order_id
     left join lateral (
       select
         case when m.hidden_at is not null then '${HIDDEN_BODY_PLACEHOLDER}' else m.body end as "lastMessageBody",
         m.created_at as "lastMessageAt"
       from messages m
       where m.conversation_id = c.id
       order by m.created_at desc, m.id desc
       limit 1
     ) lm on true
     left join lateral (
       select count(*) as count
       from messages m2
       where m2.conversation_id = c.id
         and m2.sender_id != $2
         and m2.created_at > coalesce(case when c.buyer_id = $2 then c.buyer_last_read_at else c.seller_last_read_at end, 'epoch')
     ) unread on true
     where ($1 = 'admin' or c.buyer_id = $2 or c.seller_id = $2)
       ${cursorWhere ? `and ${cursorWhere}` : ""}
     order by coalesce(lm."lastMessageAt", c.created_at) desc, c.id desc
     limit $${values.length}`,
    values
  );
  const nextCursor = buildNextCursor(
    result.rows.map((row) => ({ id: row.id, createdAt: row.activityAt })),
    limit
  );
  const conversations = result.rows.map(({ activityAt: _activityAt, ...row }) => ({
    ...row,
    canSendMessage: !row.blocked
  }));
  return { conversations, nextCursor };
}

export async function getUserConversations(userId: string, role: string) {
  return (await getUserConversationPage(userId, role)).conversations;
}

function rowContextType(row: { orderId?: string | null; productId?: string | null }): ConversationContextType {
  if (row.orderId) return "order";
  if (row.productId) return "product";
  return "direct";
}

function rowContextLabel(type: ConversationContextType, row: { productTitle?: string | null; orderId?: string | null }) {
  if (type === "direct") return "Direct chat";
  if (type === "order") return `Order #${row.orderId?.slice(0, 8) ?? ""}`;
  return row.productTitle ?? "Product chat";
}

function newestTimestamp(left?: string | null, right?: string | null) {
  if (!left) return right ?? null;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

async function groupUserConversations(rows: Awaited<ReturnType<typeof getUserConversations>>, userId: string) {
  const groups = new Map<string, GroupedConversation>();

  for (const row of rows) {
    const isBuyer = row.buyerId === userId;
    const peerUserId = isBuyer ? row.sellerId : row.buyerId;
    const peerDisplayName = isBuyer ? row.sellerDisplayName : row.buyerDisplayName;
    const peerAvatarUrl = isBuyer ? row.sellerAvatarUrl : row.buyerAvatarUrl;
    if (!peerUserId) continue;

    const type = rowContextType(row);
    const lastMessageAt = (row.lastMessageAt ?? row.createdAt ?? null) as string | null;
    let group = groups.get(peerUserId);
    if (!group) {
      group = {
        peerUserId,
        peerDisplayName: peerDisplayName ?? "Participant",
        peerAvatarUrl: peerAvatarUrl ?? null,
        isOnline: await isUserOnline(peerUserId),
        totalUnreadCount: 0,
        lastMessageAt: null,
        lastMessageBody: null,
        contexts: []
      };
    }

    group.totalUnreadCount += Number(row.unreadCount ?? 0);
    const nextLastMessageAt = newestTimestamp(group.lastMessageAt, lastMessageAt);
    if (nextLastMessageAt !== group.lastMessageAt) {
      group.lastMessageAt = nextLastMessageAt;
      group.lastMessageBody = row.lastMessageBody ?? null;
    }

    group.contexts.push({
      conversationId: row.id,
      type,
      label: rowContextLabel(type, row),
      productId: row.productId ?? null,
      productTitle: row.productTitle ?? null,
      orderId: row.orderId ?? null,
      orderStatus: row.orderStatus ?? null,
      amountCents:
        row.amountCents === null || row.amountCents === undefined
          ? null
          : bigintToMoneyCents(row.amountCents),
      currency: row.currency ?? null,
      unreadCount: Number(row.unreadCount ?? 0),
      lastMessageAt,
      lastMessageBody: row.lastMessageBody ?? null,
      blocked: Boolean(row.blocked),
      canSendMessage: Boolean(row.canSendMessage),
      createdAt: row.createdAt
    });

    groups.set(peerUserId, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      contexts: group.contexts.sort(
        (a, b) =>
          new Date(b.lastMessageAt ?? b.createdAt).getTime() - new Date(a.lastMessageAt ?? a.createdAt).getTime()
      )
    }))
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? b.contexts[0]?.createdAt ?? 0).getTime() -
        new Date(a.lastMessageAt ?? a.contexts[0]?.createdAt ?? 0).getTime()
    );
}

export async function getGroupedUserConversationPage(
  userId: string,
  role: string,
  options: { limit?: number; cursor?: DecodedCursor | null } = {}
) {
  const page = await getUserConversationPage(userId, role, options);
  return {
    groups: await groupUserConversations(page.conversations, userId),
    nextCursor: page.nextCursor
  };
}

export async function getGroupedUserConversations(userId: string, role: string): Promise<GroupedConversation[]> {
  return (await getGroupedUserConversationPage(userId, role)).groups;
}
