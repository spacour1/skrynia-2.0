import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import type { AuthedRequest } from "../../common/types.js";
import { broadcastConversation } from "./ws.service.js";
import {
  assertConversationAccess,
  getMessages,
  getOrCreateDirectConversation,
  getOrCreateProductConversation,
  getUserConversations,
  markConversationRead,
  sendMessage
} from "./chat.service.js";

const router = Router();

const sendMessageSchema = z.object({
  body: z.string().min(1).max(3000),
  attachmentUrl: z.string().url().optional()
});

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().datetime().optional()
});

router.get(
  "/conversations",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const conversations = await getUserConversations(req.user.id, req.user.role);
    res.json({ conversations });
  })
);

router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const conversationId = z.string().uuid().parse(req.params.conversationId);
    const query = listMessagesQuerySchema.parse(req.query);
    await assertConversationAccess(conversationId, req.user.id, req.user.role);
    const messages = await getMessages(conversationId, {
      limit: query.limit,
      before: query.before,
      viewerIsAdmin: req.user.role === "admin"
    });
    await markConversationRead(conversationId, req.user.id);
    res.json({ messages });
  })
);

router.post(
  "/sellers/:sellerId/start",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sellerId = z.string().uuid().parse(req.params.sellerId);
    if (sellerId === req.user.id) throw badRequest("You cannot message yourself");

    const seller = await pool.query(`select id from users where id = $1 and is_banned = false`, [sellerId]);
    if (!seller.rows[0]) throw notFound("Seller not found");

    const conversation = await getOrCreateDirectConversation({ buyerId: req.user.id, sellerId });
    res.status(conversation.existing ? 200 : 201).json({ conversationId: conversation.id, existing: conversation.existing });
  })
);

router.post(
  "/products/:productId/start",
  authenticate,
  requireEmailVerified,
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

    const conversation = await getOrCreateProductConversation({
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
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const conversationId = z.string().uuid().parse(req.params.conversationId);
    const input = sendMessageSchema.parse(req.body);
    const message = await sendMessage({
      conversationId,
      senderId: req.user.id,
      body: input.body,
      attachmentUrl: input.attachmentUrl
    });
    broadcastConversation(conversationId, { type: "message", message });
    res.status(201).json({ message });
  })
);

export default router;
