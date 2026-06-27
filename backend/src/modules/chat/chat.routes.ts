import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import type { AuthedRequest } from "../../common/types.js";
import { broadcastConversation } from "./ws.service.js";
import { createNotification } from "../notifications/notifications.service.js";

const router = Router();

const sendMessageSchema = z.object({
  body: z.string().min(1).max(3000),
  attachmentUrl: z.string().url().optional()
});

async function assertConversationAccess(conversationId: string, req: AuthedRequest) {
  const result = await pool.query(`select buyer_id, seller_id from conversations where id = $1`, [conversationId]);
  const row = result.rows[0];
  if (!row) throw notFound("Conversation not found");
  if (req.user.role !== "admin" && row.buyer_id !== req.user.id && row.seller_id !== req.user.id) {
    throw forbidden();
  }
  return row as { buyer_id: string; seller_id: string };
}

/**
 * Chat is a separate entity from orders: starting a conversation must never create an
 * order. find-or-create relies on the partial unique indexes on conversations
 * (buyer_id, seller_id, product_id) so concurrent clicks never produce duplicate threads.
 */
async function findOrCreateConversation(input: { buyerId: string; sellerId: string; productId: string | null }) {
  const lookupSql = input.productId
    ? `select id from conversations where buyer_id = $1 and seller_id = $2 and product_id = $3`
    : `select id from conversations where buyer_id = $1 and seller_id = $2 and product_id is null`;
  const lookupValues = input.productId ? [input.buyerId, input.sellerId, input.productId] : [input.buyerId, input.sellerId];

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

router.get(
  "/conversations",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select c.id, c.product_id as "productId", c.order_id as "orderId", c.created_at as "createdAt",
              p.title as "productTitle",
              b.id as "buyerId", b.display_name as "buyerDisplayName", b.avatar_url as "buyerAvatarUrl",
              s.id as "sellerId", s.display_name as "sellerDisplayName", s.avatar_url as "sellerAvatarUrl",
              o.status as "orderStatus", o.amount_cents as "amountCents", o.currency,
              max(m.created_at) as "lastMessageAt"
       from conversations c
       left join products p on p.id = c.product_id
       join users b on b.id = c.buyer_id
       join users s on s.id = c.seller_id
       left join orders o on o.id = c.order_id
       left join messages m on m.conversation_id = c.id
       where $1 = 'admin' or c.buyer_id = $2 or c.seller_id = $2
       group by c.id, p.id, b.id, s.id, o.id
       order by coalesce(max(m.created_at), c.created_at) desc
       limit 100`,
      [req.user.role, req.user.id]
    );
    res.json({ conversations: result.rows });
  })
);

router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const conversationId = z.string().uuid().parse(req.params.conversationId);
    await assertConversationAccess(conversationId, req);
    const result = await pool.query(
      `select m.id, m.conversation_id as "conversationId", m.sender_id as "senderId",
              u.display_name as "senderDisplayName",
              m.body, m.attachment_url as "attachmentUrl", m.created_at as "createdAt"
       from messages m
       join users u on u.id = m.sender_id
       where m.conversation_id = $1
       order by m.created_at asc`,
      [conversationId]
    );
    res.json({ messages: result.rows });
  })
);

router.post(
  "/sellers/:sellerId/start",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sellerId = z.string().uuid().parse(req.params.sellerId);
    if (sellerId === req.user.id) throw badRequest("You cannot message yourself");

    const seller = await pool.query(`select id from users where id = $1 and is_banned = false`, [sellerId]);
    if (!seller.rows[0]) throw notFound("Seller not found");

    const conversation = await findOrCreateConversation({ buyerId: req.user.id, sellerId, productId: null });
    res.status(conversation.existing ? 200 : 201).json({ conversationId: conversation.id, existing: conversation.existing });
  })
);

router.post(
  "/products/:productId/start",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    const product = await pool.query(
      `select p.id, p.seller_id, p.status, u.is_banned
       from products p
       join users u on u.id = p.seller_id
       where p.id = $1`,
      [productId]
    );
    const row = product.rows[0];
    if (!row || row.status !== "active" || row.is_banned) throw notFound("Product is unavailable");
    if (row.seller_id === req.user.id) throw badRequest("You cannot message yourself on your own listing");

    const conversation = await findOrCreateConversation({
      buyerId: req.user.id,
      sellerId: row.seller_id,
      productId: row.id
    });
    res.status(conversation.existing ? 200 : 201).json({ conversationId: conversation.id, existing: conversation.existing });
  })
);

router.post(
  "/conversations/:conversationId/messages",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const conversationId = z.string().uuid().parse(req.params.conversationId);
    const input = sendMessageSchema.parse(req.body);
    const conversation = await assertConversationAccess(conversationId, req);
    const result = await pool.query(
      `insert into messages(conversation_id, sender_id, body, attachment_url)
       values ($1, $2, $3, $4)
       returning id, conversation_id as "conversationId", sender_id as "senderId",
                 (select display_name from users where id = $2) as "senderDisplayName",
                 body, attachment_url as "attachmentUrl", created_at as "createdAt"`,
      [conversationId, req.user.id, input.body, input.attachmentUrl ?? null]
    );
    broadcastConversation(conversationId, { type: "message", message: result.rows[0] });
    const recipientId = conversation.buyer_id === req.user.id ? conversation.seller_id : conversation.buyer_id;
    await createNotification({
      userId: recipientId,
      type: "message",
      title: "Новое сообщение",
      body: `${req.user.displayName}: ${input.body.slice(0, 120)}`,
      conversationId
    });
    res.status(201).json({ message: result.rows[0] });
  })
);

export default router;
