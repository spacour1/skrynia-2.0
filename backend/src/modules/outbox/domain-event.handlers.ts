import { z } from "zod";
import {
  cacheDelPatternStrict,
  cacheDelStrict
} from "../../common/redis.js";
import { pool } from "../../db/pool.js";
import { publishSessionSecurityEvent } from "../auth/session-events.service.js";
import { revokeAllUserSessions } from "../auth/session.service.js";
import {
  broadcastConversation,
  notifyOrderEvent
} from "../chat/ws.service.js";
import { SYSTEM_SENDER_DISPLAY_NAME } from "../chat/system-messages.service.js";
import {
  invalidateProductCacheBatch,
  invalidateProductCaches,
  loadSellerProductCacheContexts,
  type ProductCacheContext
} from "../marketplace/marketplace-cache.service.js";
import {
  createNotification,
  type NotificationInput
} from "../notifications/notifications.service.js";
import type { DomainOutboxEvent } from "./outbox.service.js";

const baseOrderPayload = z.object({
  orderId: z.string().uuid(),
  buyerId: z.string().uuid(),
  sellerId: z.string().uuid(),
  productId: z.string().uuid()
});

const orderCreatedPayload = baseOrderPayload.extend({
  conversationId: z.string().uuid(),
  systemMessageIds: z.array(z.string().uuid()).default([])
});

const orderTransitionPayload = baseOrderPayload.extend({
  systemMessageIds: z.array(z.string().uuid()).default([])
});

const orderCompletedPayload = orderTransitionPayload.extend({
  source: z.enum(["buyer_confirmed", "auto", "dispute", "service"])
});

const reviewCreatedPayload = z.object({
  reviewId: z.string().uuid(),
  orderId: z.string().uuid(),
  sellerId: z.string().uuid(),
  rating: z.number().int().min(1).max(5)
});

const disputeOpenedPayload = baseOrderPayload.extend({
  disputeId: z.string().uuid(),
  systemMessageIds: z.array(z.string().uuid()).default([])
});

const disputeResolvedPayload = z.object({
  disputeId: z.string().uuid(),
  orderId: z.string().uuid(),
  buyerId: z.string().uuid(),
  sellerId: z.string().uuid(),
  decision: z.enum(["refund", "release"]),
  systemMessageIds: z.array(z.string().uuid()).default([])
});

const messageCreatedPayload = z.object({
  messageId: z.string().uuid()
});

const productBlockedPayload = z.object({
  productId: z.string().uuid(),
  sellerId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  gameId: z.string().uuid().nullable(),
  sectionId: z.string().uuid().nullable()
});

const userModerationPayload = z.object({
  userId: z.string().uuid()
});

const userWarnedPayload = userModerationPayload.extend({
  reason: z.string()
});

const userMutedPayload = userModerationPayload.extend({
  reason: z.string().nullable(),
  mutedUntil: z.string().datetime()
});

function notificationEventKey(
  event: DomainOutboxEvent,
  recipientId: string,
  type: string
) {
  return `${event.eventKey}:notification:${recipientId}:${type}`;
}

async function createOutboxNotification(
  event: DomainOutboxEvent,
  input: NotificationInput
) {
  return createNotification(input, {
    eventKey: notificationEventKey(event, input.userId, input.type),
    requireDeliveryQueue: true
  });
}

async function createAdminNotifications(
  event: DomainOutboxEvent,
  input: Omit<NotificationInput, "userId">,
  roles: Array<"admin" | "moderator"> = ["admin"]
) {
  const recipients = await pool.query<{ id: string }>(
    `select id from users where role = any($1::text[])`,
    [roles]
  );
  await Promise.all(
    recipients.rows.map((recipient) =>
      createOutboxNotification(event, { ...input, userId: recipient.id })
    )
  );
}

async function invalidateOrderCaches(input: {
  orderId: string;
  buyerId: string;
  sellerId: string;
  wallet?: boolean;
}) {
  if (input.wallet) {
    await cacheDelStrict(
      `user:${input.buyerId}:wallet`,
      `user:${input.sellerId}:wallet`
    );
  }
  await Promise.all([
    cacheDelPatternStrict(`order:${input.orderId}:*`),
    cacheDelPatternStrict(`orders:${input.buyerId}:*`),
    cacheDelPatternStrict(`orders:${input.sellerId}:*`)
  ]);
}

async function loadMessage(messageId: string) {
  const result = await pool.query(
    `select m.id, m.conversation_id as "conversationId", m.sender_id as "senderId",
            coalesce(u.display_name, $2) as "senderDisplayName",
            m.body, m.attachment_url as "attachmentUrl", m.created_at as "createdAt",
            m.kind, m.system_type as "systemType", m.metadata,
            c.buyer_id as "buyerId", c.seller_id as "sellerId",
            c.product_id as "productId", c.order_id as "orderId",
            p.title as "productTitle"
     from messages m
     join conversations c on c.id = m.conversation_id
     left join users u on u.id = m.sender_id
     left join products p on p.id = c.product_id
     where m.id = $1`,
    [messageId, SYSTEM_SENDER_DISPLAY_NAME]
  );
  return result.rows[0] ?? null;
}

async function broadcastStoredMessages(messageIds: string[]) {
  for (const messageId of messageIds) {
    const message = await loadMessage(messageId);
    if (message) {
      broadcastConversation(message.conversationId, { type: "message", message });
    }
  }
}

async function handleOrderCreated(event: DomainOutboxEvent) {
  const payload = orderCreatedPayload.parse(event.payload);
  await createOutboxNotification(event, {
    userId: payload.sellerId,
    type: "order_created",
    templateKey: "notifications.orderCreated",
    conversationId: payload.conversationId,
    orderId: payload.orderId,
    productId: payload.productId
  });
  await invalidateOrderCaches(payload);
  await broadcastStoredMessages(payload.systemMessageIds);
}

async function handleOrderStarted(event: DomainOutboxEvent) {
  const payload = orderTransitionPayload.parse(event.payload);
  await createOutboxNotification(event, {
    userId: payload.buyerId,
    type: "order_started",
    templateKey: "notifications.orderStarted",
    orderId: payload.orderId,
    productId: payload.productId
  });
  await invalidateOrderCaches(payload);
  notifyOrderEvent(payload.buyerId, {
    type: "order_started",
    orderId: payload.orderId
  });
  await broadcastStoredMessages(payload.systemMessageIds);
}

async function handleOrderDelivered(event: DomainOutboxEvent) {
  const payload = orderTransitionPayload.parse(event.payload);
  await createOutboxNotification(event, {
    userId: payload.buyerId,
    type: "order_delivered",
    templateKey: "notifications.orderDelivered",
    orderId: payload.orderId,
    productId: payload.productId
  });
  await invalidateOrderCaches(payload);
  notifyOrderEvent(payload.buyerId, {
    type: "order_delivered",
    orderId: payload.orderId
  });
  await broadcastStoredMessages(payload.systemMessageIds);
}

async function handleOrderCompleted(event: DomainOutboxEvent) {
  const payload = orderCompletedPayload.parse(event.payload);

  if (payload.source === "auto") {
    await Promise.all(
      [payload.buyerId, payload.sellerId].map((userId) =>
        createOutboxNotification(event, {
          userId,
          type: "order_auto_released",
          templateKey: "notifications.orderAutoReleased",
          orderId: payload.orderId
        })
      )
    );
    notifyOrderEvent(payload.buyerId, {
      type: "order_auto_completed",
      orderId: payload.orderId
    });
    notifyOrderEvent(payload.sellerId, {
      type: "order_auto_completed",
      orderId: payload.orderId
    });
  } else if (payload.source !== "dispute") {
    await createOutboxNotification(event, {
      userId: payload.sellerId,
      type: "order_completed",
      templateKey: "notifications.orderCompleted",
      orderId: payload.orderId
    });
    notifyOrderEvent(payload.sellerId, {
      type: "order_completed",
      orderId: payload.orderId
    });
  }

  await invalidateOrderCaches({ ...payload, wallet: true });
  const product = await pool.query<ProductCacheContext>(
    `select id as "productId", seller_id as "sellerId", category_id as "categoryId",
            game_id as "gameId", section_id as "sectionId"
     from products where id = $1`,
    [payload.productId]
  );
  if (product.rows[0]) {
    await invalidateProductCaches(product.rows[0], { strict: true });
  }
  await broadcastStoredMessages(payload.systemMessageIds);
}

async function handleReviewCreated(event: DomainOutboxEvent) {
  const payload = reviewCreatedPayload.parse(event.payload);
  await createOutboxNotification(event, {
    userId: payload.sellerId,
    type: "review_created",
    templateKey: "notifications.reviewCreated",
    params: { rating: payload.rating },
    orderId: payload.orderId
  });
}

async function handleDisputeOpened(event: DomainOutboxEvent) {
  const payload = disputeOpenedPayload.parse(event.payload);
  await Promise.all(
    [payload.buyerId, payload.sellerId].map((userId) =>
      createOutboxNotification(event, {
        userId,
        type: "order_disputed",
        templateKey: "notifications.orderDisputed",
        orderId: payload.orderId
      })
    )
  );
  await createAdminNotifications(event, {
    type: "dispute_new_admin",
    templateKey: "notifications.disputeNewAdmin",
    orderId: payload.orderId
  });
  await invalidateOrderCaches(payload);
  notifyOrderEvent(payload.buyerId, {
    type: "order_disputed",
    orderId: payload.orderId
  });
  notifyOrderEvent(payload.sellerId, {
    type: "order_disputed",
    orderId: payload.orderId
  });
  await broadcastStoredMessages(payload.systemMessageIds);
}

async function handleDisputeResolved(event: DomainOutboxEvent) {
  const payload = disputeResolvedPayload.parse(event.payload);
  await Promise.all(
    [payload.buyerId, payload.sellerId].map((userId) =>
      createOutboxNotification(event, {
        userId,
        type: "dispute_resolved",
        titleKey: "notifications.disputeResolved.title",
        bodyKey:
          payload.decision === "refund"
            ? "notifications.disputeResolved.bodyRefund"
            : "notifications.disputeResolved.bodyRelease",
        orderId: payload.orderId
      })
    )
  );
  await invalidateOrderCaches({ ...payload, wallet: true });
  notifyOrderEvent(payload.buyerId, {
    type: "dispute_resolved",
    orderId: payload.orderId,
    decision: payload.decision
  });
  notifyOrderEvent(payload.sellerId, {
    type: "dispute_resolved",
    orderId: payload.orderId,
    decision: payload.decision
  });
  await broadcastStoredMessages(payload.systemMessageIds);
}

async function handleMessageCreated(event: DomainOutboxEvent) {
  const payload = messageCreatedPayload.parse(event.payload);
  const message = await loadMessage(payload.messageId);
  if (!message || !message.senderId) return;

  const recipientId =
    message.buyerId === message.senderId ? message.sellerId : message.buyerId;
  const contextType = message.orderId
    ? "order"
    : message.productId
      ? "product"
      : "direct";
  const templateKey =
    contextType === "order"
      ? "notifications.newMessageOrder"
      : contextType === "product"
        ? "notifications.newMessageProduct"
        : "notifications.newMessageDirect";

  await createOutboxNotification(event, {
    userId: recipientId,
    type: "message",
    templateKey,
    params: {
      sender: message.senderDisplayName,
      preview: String(message.body).slice(0, 120),
      productTitle: message.productTitle ?? "",
      orderId: message.orderId ? String(message.orderId).slice(0, 8) : ""
    },
    conversationId: message.conversationId,
    productId: message.productId ?? undefined,
    orderId: message.orderId ?? undefined
  });
  broadcastConversation(message.conversationId, { type: "message", message });
}

async function handleProductBlocked(event: DomainOutboxEvent) {
  const payload = productBlockedPayload.parse(event.payload);
  await invalidateProductCaches(payload, { strict: true });
}

async function handleUserBanned(event: DomainOutboxEvent) {
  const payload = userModerationPayload.parse(event.payload);
  await revokeAllUserSessions(payload.userId, { strict: true });
  publishSessionSecurityEvent({ type: "user.banned", userId: payload.userId });
  const products = await loadSellerProductCacheContexts(payload.userId);
  await invalidateProductCacheBatch(
    products,
    { sellerIds: [payload.userId] },
    { strict: true }
  );
}

async function handleUserWarned(event: DomainOutboxEvent) {
  const payload = userWarnedPayload.parse(event.payload);
  await createOutboxNotification(event, {
    userId: payload.userId,
    type: "account_warned",
    titleKey: "notifications.accountWarned.title",
    body: payload.reason
  });
}

async function handleUserMuted(event: DomainOutboxEvent) {
  const payload = userMutedPayload.parse(event.payload);
  await createOutboxNotification(event, {
    userId: payload.userId,
    type: "account_muted",
    titleKey: "notifications.accountMuted.title",
    ...(payload.reason
      ? { body: payload.reason }
      : {
          bodyKey: "notifications.accountMuted.body",
          params: {
            until:
              new Date(payload.mutedUntil)
                .toISOString()
                .slice(0, 16)
                .replace("T", " ") + " UTC"
          }
        })
  });
}

export async function handleDomainEvent(event: DomainOutboxEvent): Promise<void> {
  switch (event.eventType) {
    case "order.created":
      return handleOrderCreated(event);
    case "order.started":
      return handleOrderStarted(event);
    case "order.delivered":
      return handleOrderDelivered(event);
    case "order.completed":
      return handleOrderCompleted(event);
    case "review.created":
      return handleReviewCreated(event);
    case "dispute.opened":
      return handleDisputeOpened(event);
    case "dispute.resolved":
      return handleDisputeResolved(event);
    case "message.created":
      return handleMessageCreated(event);
    case "product.blocked":
      return handleProductBlocked(event);
    case "user.banned":
      return handleUserBanned(event);
    case "user.warned":
      return handleUserWarned(event);
    case "user.muted":
      return handleUserMuted(event);
    default: {
      const exhaustive: never = event.eventType;
      throw new Error(`Unsupported domain event: ${exhaustive}`);
    }
  }
}
