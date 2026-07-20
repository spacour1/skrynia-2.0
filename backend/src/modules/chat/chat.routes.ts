import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import type { AuthedRequest } from "../../common/types.js";
import {
  assertConversationAccess,
  getExistingProductConversation,
  getGroupedUserConversations,
  getMessages,
  getOrCreateDirectConversation,
  getOrCreateProductConversation,
  getUserConversations,
  markConversationRead,
  sendMessageIdempotently
} from "./chat.service.js";

const router = Router();

const sendMessageSchema = z.object({
  clientMessageId: z.string().uuid(),
  body: z.string().min(1).max(3000),
  attachmentUrl: z.string().url().optional()
});

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().datetime().optional()
});

async function getActiveProduct(productId: string) {
  const product = await pool.query(
    `select p.id, p.seller_id, p.status, u.is_banned
     from products p
     join users u on u.id = p.seller_id
     where p.id = $1`,
    [productId]
  );
  const row = product.rows[0];
  if (!row || row.status !== "active" || row.is_banned) throw notFound("Product is unavailable");
  return row as { id: string; seller_id: string; status: string; is_banned: boolean };
}

router.get(
  "/conversations",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const conversations = await getUserConversations(req.user.id, req.user.role);
    res.json({ conversations });
  })
);

router.get(
  "/conversations/grouped",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const groups = await getGroupedUserConversations(req.user.id, req.user.role);
    res.json({ groups });
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

async function startDirectConversation(req: AuthedRequest, res: Response, userId: string) {
  if (userId === req.user.id) throw badRequest("You cannot message yourself");

  const user = await pool.query(`select id from users where id = $1 and is_banned = false`, [userId]);
  if (!user.rows[0]) throw notFound("User not found");

  const conversation = await getOrCreateDirectConversation({ buyerId: req.user.id, sellerId: userId });
  res.status(conversation.existing ? 200 : 201).json({ conversationId: conversation.id, existing: conversation.existing });
}

router.post(
  "/users/:userId/start",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    await startDirectConversation(req, res, userId);
  })
);

router.post(
  "/sellers/:sellerId/start",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sellerId = z.string().uuid().parse(req.params.sellerId);
    await startDirectConversation(req, res, sellerId);
  })
);

router.get(
  "/products/:productId/conversation",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    const product = await getActiveProduct(productId);
    if (product.seller_id === req.user.id) return res.json({ conversationId: null });

    const conversationId = await getExistingProductConversation({
      buyerId: req.user.id,
      sellerId: product.seller_id,
      productId: product.id
    });
    res.json({ conversationId });
  })
);

router.post(
  "/products/:productId/start",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    const row = await getActiveProduct(productId);
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
    const result = await sendMessageIdempotently({
      conversationId,
      senderId: req.user.id,
      clientMessageId: input.clientMessageId,
      body: input.body,
      attachmentUrl: input.attachmentUrl
    });
    if (!result.created) res.setHeader("Idempotency-Replayed", "true");
    res.status(result.created ? 201 : 200).json({ message: result.message });
  })
);

export default router;
