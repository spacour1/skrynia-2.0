import { pool } from "../../db/pool.js";
import { notifyOrderEvent } from "../chat/ws.service.js";
import { enqueueJob } from "../jobs/queue.js";

export type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  body?: string;
  orderId?: string;
  productId?: string;
  conversationId?: string;
};

export async function createNotification(input: NotificationInput) {
  const result = await pool.query(
    `insert into notifications(user_id, type, title, body, order_id, product_id, conversation_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, user_id as "userId", type, title, body, order_id as "orderId",
               product_id as "productId", conversation_id as "conversationId",
               read_at as "readAt", created_at as "createdAt"`,
    [
      input.userId,
      input.type,
      input.title,
      input.body ?? null,
      input.orderId ?? null,
      input.productId ?? null,
      input.conversationId ?? null
    ]
  );
  notifyOrderEvent(input.userId, { type: "notification", notification: result.rows[0] });
  await enqueueJob("email_notification", {
    userId: input.userId,
    subject: input.title,
    body: input.body
  });
  return result.rows[0];
}
