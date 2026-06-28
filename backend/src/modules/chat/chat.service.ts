import { ApiError, badRequest, forbidden, notFound } from "../../common/errors.js";
import { pool } from "../../db/pool.js";
import { createNotification } from "../notifications/notifications.service.js";

export type ConversationParties = { buyerId: string; sellerId: string };

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  senderDisplayName: string;
  body: string;
  attachmentUrl: string | null;
  createdAt: string;
  hidden?: boolean;
};

const MIN_MESSAGE_LENGTH = 1;
const MAX_MESSAGE_LENGTH = 3000;
const HIDDEN_BODY_PLACEHOLDER = "[сообщение скрыто модератором]";

function messagingBlocked() {
  return new ApiError(403, "You cannot message this user", "messaging_blocked");
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
  const otherId = parties.buyerId === userId ? parties.sellerId : parties.buyerId;
  if (await isBlockedPair(userId, otherId)) throw messagingBlocked();
  return parties;
}

async function findConversation(input: { buyerId: string; sellerId: string; productId: string | null }) {
  const lookupSql = input.productId
    ? `select id from conversations where buyer_id = $1 and seller_id = $2 and product_id = $3`
    : `select id from conversations where buyer_id = $1 and seller_id = $2 and product_id is null`;
  const lookupValues = input.productId ? [input.buyerId, input.sellerId, input.productId] : [input.buyerId, input.sellerId];
  return { lookupSql, lookupValues };
}

async function getOrCreateConversation(input: { buyerId: string; sellerId: string; productId: string | null }) {
  if (input.buyerId === input.sellerId) throw badRequest("You cannot message yourself");
  if (await isBlockedPair(input.buyerId, input.sellerId)) throw messagingBlocked();

  const { lookupSql, lookupValues } = await findConversation(input);
  const existing = await pool.query(lookupSql, lookupValues);
  if (existing.rows[0]) return { id: existing.rows[0].id as string, existing: true };

  const created = await pool.query(
    `insert into conversations(buyer_id, seller_id, product_id)
     values ($1, $2, $3)
     on conflict do nothing
     returning id`,
    [input.buyerId, input.sellerId, input.productId]
  );
  if (created.rows[0]) return { id: created.rows[0].id as string, existing: false };

  const reread = await pool.query(lookupSql, lookupValues);
  return { id: reread.rows[0].id as string, existing: true };
}

export function getOrCreateProductConversation(input: { buyerId: string; sellerId: string; productId: string }) {
  return getOrCreateConversation({ buyerId: input.buyerId, sellerId: input.sellerId, productId: input.productId });
}

export function getOrCreateDirectConversation(input: { buyerId: string; sellerId: string }) {
  return getOrCreateConversation({ buyerId: input.buyerId, sellerId: input.sellerId, productId: null });
}

export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  body: string;
  attachmentUrl?: string;
}): Promise<Message> {
  const body = input.body.trim();
  if (body.length < MIN_MESSAGE_LENGTH || body.length > MAX_MESSAGE_LENGTH) throw badRequest("Invalid message");

  const parties = await assertCanSendMessage(input.conversationId, input.senderId);

  const result = await pool.query(
    `insert into messages(conversation_id, sender_id, body, attachment_url)
     values ($1, $2, $3, $4)
     returning id, conversation_id as "conversationId", sender_id as "senderId",
               (select display_name from users where id = $2) as "senderDisplayName",
               body, attachment_url as "attachmentUrl", created_at as "createdAt"`,
    [input.conversationId, input.senderId, body, input.attachmentUrl ?? null]
  );
  const message = result.rows[0] as Message;

  const recipientId = parties.buyerId === input.senderId ? parties.sellerId : parties.buyerId;
  await createNotification({
    userId: recipientId,
    type: "message",
    title: "Новое сообщение",
    body: `${message.senderDisplayName}: ${body.slice(0, 120)}`,
    conversationId: input.conversationId
  });

  return message;
}

export async function getMessages(
  conversationId: string,
  opts: { limit?: number; before?: string; viewerIsAdmin?: boolean } = {}
): Promise<Message[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const params: unknown[] = [conversationId];
  let beforeClause = "";
  if (opts.before) {
    params.push(opts.before);
    beforeClause = `and m.created_at < $${params.length}`;
  }
  params.push(limit);
  const limitParamIndex = params.length;
  params.push(Boolean(opts.viewerIsAdmin));
  const adminParamIndex = params.length;

  const result = await pool.query(
    `select m.id, m.conversation_id as "conversationId", m.sender_id as "senderId",
            u.display_name as "senderDisplayName",
            case when m.hidden_at is not null and not $${adminParamIndex} then '${HIDDEN_BODY_PLACEHOLDER}' else m.body end as body,
            m.attachment_url as "attachmentUrl", m.created_at as "createdAt",
            (m.hidden_at is not null) as hidden
     from messages m
     join users u on u.id = m.sender_id
     where m.conversation_id = $1 ${beforeClause}
     order by m.created_at desc
     limit $${limitParamIndex}`,
    params
  );
  return result.rows.reverse();
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

export async function getUserConversations(userId: string, role: string) {
  const result = await pool.query(
    `select c.id, c.product_id as "productId", c.order_id as "orderId", c.created_at as "createdAt",
            p.title as "productTitle",
            b.id as "buyerId", b.display_name as "buyerDisplayName", b.avatar_url as "buyerAvatarUrl",
            s.id as "sellerId", s.display_name as "sellerDisplayName", s.avatar_url as "sellerAvatarUrl",
            o.status as "orderStatus", o.amount_cents as "amountCents", o.currency,
            lm."lastMessageBody", lm."lastMessageAt",
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
       order by m.created_at desc
       limit 1
     ) lm on true
     left join lateral (
       select count(*) as count
       from messages m2
       where m2.conversation_id = c.id
         and m2.sender_id != $2
         and m2.created_at > coalesce(case when c.buyer_id = $2 then c.buyer_last_read_at else c.seller_last_read_at end, 'epoch')
     ) unread on true
     where $1 = 'admin' or c.buyer_id = $2 or c.seller_id = $2
     order by coalesce(lm."lastMessageAt", c.created_at) desc
     limit 100`,
    [role, userId]
  );
  return result.rows.map((row) => ({ ...row, canSendMessage: !row.blocked }));
}
