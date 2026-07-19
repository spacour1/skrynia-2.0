import { createHash } from "node:crypto";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { logger } from "../../common/logger.js";
import { defaultLocale } from "../../i18n/config.js";
import { t, type TranslateParams } from "../../i18n/t.js";
import { notifyOrderEvent } from "../chat/ws.service.js";
import { enqueueJob } from "../jobs/queue.js";

export type NotificationInput = {
  userId: string;
  type: string;
  /**
   * Key-based template (preferred): "notifications.orderCreated" resolves
   * "<key>.title" / "<key>.body" in the recipient's language at read time.
   * params are interpolated into both title and body ({name} placeholders).
   */
  templateKey?: string;
  params?: TranslateParams;
  /** Explicit key overrides for templates whose body varies (e.g. dispute outcome). */
  titleKey?: string;
  bodyKey?: string;
  /** Legacy plain-text fallback — only for callers that cannot use keys. */
  title?: string;
  body?: string;
  orderId?: string;
  productId?: string;
  conversationId?: string;
  /**
   * Sends the email leg to this address instead of the account's current email — needed
   * for alerts like "your email was changed", which must reach the address being replaced,
   * not the new one the recipient lookup would otherwise resolve to.
   */
  emailOverride?: string;
  /**
   * Skips the Telegram leg even if the recipient has it enabled — for events (e.g. "Telegram
   * connected") that already got an immediate, interactive reply on that exact channel, so a
   * queued copy would just be a duplicate message.
   */
  skipTelegram?: boolean;
};

type NotificationOptions = {
  eventKey?: string;
  requireDeliveryQueue?: boolean;
};

function deliveryJobId(eventKey: string) {
  return `notification-${createHash("sha256").update(eventKey).digest("hex")}`;
}

async function withDeliveryTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Notification delivery queue timed out")),
          env.OUTBOX_DELIVERY_TIMEOUT_MS
        );
        timeout.unref();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function createNotification(
  input: NotificationInput,
  options: NotificationOptions = {}
) {
  const titleKey = input.titleKey ?? (input.templateKey ? `${input.templateKey}.title` : null);
  const bodyKey = input.bodyKey ?? (input.templateKey ? `${input.templateKey}.body` : null);
  const params = input.params ?? {};

  // Store a rendered default-locale fallback alongside the keys, so legacy consumers
  // and DB tooling still see readable text; the API localizes key-based rows on read.
  const fallbackTitle = input.title ?? (titleKey ? t(defaultLocale, titleKey, params) : "");
  const fallbackBody = input.body ?? (bodyKey ? t(defaultLocale, bodyKey, params) : null);

  const result = await pool.query(
    `insert into notifications(
       user_id, type, title, body, title_key, body_key, params,
       order_id, product_id, conversation_id, event_key
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (event_key) where event_key is not null do nothing
     returning id, user_id as "userId", type, title, body,
               title_key as "titleKey", body_key as "bodyKey", params,
               order_id as "orderId", product_id as "productId", conversation_id as "conversationId",
               event_key as "eventKey", read_at as "readAt", created_at as "createdAt"`,
    [
      input.userId,
      input.type,
      fallbackTitle,
      fallbackBody,
      titleKey,
      bodyKey,
      JSON.stringify(params),
      input.orderId ?? null,
      input.productId ?? null,
      input.conversationId ?? null,
      options.eventKey ?? null
    ]
  );
  const created = Boolean(result.rows[0]);
  let notification = result.rows[0];
  if (!notification && options.eventKey) {
    const existing = await pool.query(
      `select id, user_id as "userId", type, title, body,
              title_key as "titleKey", body_key as "bodyKey", params,
              order_id as "orderId", product_id as "productId", conversation_id as "conversationId",
              event_key as "eventKey", read_at as "readAt", created_at as "createdAt"
       from notifications
       where event_key = $1`,
      [options.eventKey]
    );
    notification = existing.rows[0];
  }
  if (!notification) throw new Error("Notification could not be created or reloaded");

  if (created) {
    notifyOrderEvent(input.userId, { type: "notification", notification });
  }
  // Email/Telegram delivery renders the keys in the recipient's preferred_locale
  // inside the job worker (the recipient may use a different language than the actor).
  const enqueueDelivery = () =>
    withDeliveryTimeout(
      enqueueJob(
        "notification_delivery",
        {
          userId: input.userId,
          subject: fallbackTitle,
          body: fallbackBody ?? undefined,
          titleKey: titleKey ?? undefined,
          bodyKey: bodyKey ?? undefined,
          params,
          notificationType: input.type,
          orderId: input.orderId,
          conversationId: input.conversationId,
          email: input.emailOverride,
          skipTelegram: input.skipTelegram
        },
        options.eventKey ? { jobId: deliveryJobId(options.eventKey) } : {}
      )
    );

  if (options.requireDeliveryQueue) {
    const job = await enqueueDelivery();
    if (!job) throw new Error("Notification delivery queue is unavailable");
  } else {
    void enqueueDelivery()
      .then((job) => {
        if (!job) {
          logger.warn(
            { notificationId: notification.id, type: input.type },
            "notification_delivery_not_enqueued"
          );
        }
      })
      .catch((error) => {
        logger.error(
          { error, notificationId: notification.id, type: input.type },
          "notification_delivery_enqueue_failed"
        );
      });
  }
  return notification;
}

/** Fans a notification out to every admin (or moderator, if included in `roles`). */
export async function notifyAdmins(
  input: Omit<NotificationInput, "userId">,
  roles: Array<"admin" | "moderator"> = ["admin"]
) {
  const admins = await pool.query<{ id: string }>(`select id from users where role = any($1::text[])`, [roles]);
  await Promise.all(admins.rows.map((admin) => createNotification({ ...input, userId: admin.id })));
}
