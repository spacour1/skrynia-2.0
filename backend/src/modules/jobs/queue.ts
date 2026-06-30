import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../common/logger.js";
import { jobProcessedTotal } from "../../common/metrics.js";
import { pool } from "../../db/pool.js";
import { releaseEscrow } from "../orders/ledger.service.js";
import { notifyOrderEvent } from "../chat/ws.service.js";
import { createReconciliationSnapshot } from "../admin/reconciliation.service.js";
import { createNotification } from "../notifications/notifications.service.js";
import { getNotificationPreferences } from "../notifications/preferences.service.js";
import { getTelegramChatId } from "../users/telegram-link.service.js";
import { sendEmail, renderBrandedEmail } from "../../common/mailer.js";
import { sendTelegramMessage } from "../../common/telegram-bot.js";

export type MarketplaceJobName = "escrow_release" | "payout" | "dispute_timer" | "email_notification" | "reconciliation_daily";

export type MarketplaceJobPayload = {
  orderId?: string;
  userId?: string;
  disputeId?: string;
  email?: string;
  subject?: string;
  body?: string;
};

let connection: ConnectionOptions | null = null;
let queue: Queue<MarketplaceJobPayload, unknown, string> | null = null;
let worker: Worker<MarketplaceJobPayload, unknown, string> | null = null;

function getConnection() {
  if (!env.REDIS_URL) return null;
  if (!connection) {
    const url = new URL(env.REDIS_URL);
    connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: Number(url.pathname.replace("/", "") || 0),
      maxRetriesPerRequest: null
    };
  }
  return connection;
}

export function getJobQueue() {
  const redis = getConnection();
  if (!redis) return null;
  if (!queue) {
    queue = new Queue<MarketplaceJobPayload, unknown, string>("marketplace", {
      connection: redis
    });
  }
  return queue;
}

export async function enqueueJob(name: MarketplaceJobName, data: MarketplaceJobPayload, options: JobsOptions = {}) {
  const jobs = getJobQueue();
  if (!jobs) {
    logger.warn({ name, data }, "job_queue_unavailable");
    return null;
  }
  return jobs.add(name, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
    ...options
  });
}

export async function scheduleRecurringJobs() {
  await enqueueJob("escrow_release", {}, { jobId: "escrow-release-sweep", repeat: { every: 60_000 } });
  await enqueueJob("dispute_timer", {}, { jobId: "dispute-timer-sweep", repeat: { every: 5 * 60_000 } });
  await enqueueJob("reconciliation_daily", {}, { jobId: "reconciliation-daily", repeat: { pattern: "0 3 * * *" } });
}

async function processEscrowRelease(orderId?: string) {
  const due = orderId
    ? await pool.query<{ id: string; buyer_id: string; seller_id: string }>(
        `select id, buyer_id, seller_id from orders where id = $1 and status = 'delivered'`,
        [orderId]
      )
    : await pool.query<{ id: string; buyer_id: string; seller_id: string }>(
        `select id, buyer_id, seller_id
         from orders
         where status = 'delivered'
           and auto_release_at is not null
           and auto_release_at <= now()
         order by auto_release_at asc
         limit 25`
      );

  for (const order of due.rows) {
    await releaseEscrow(order.id);
    notifyOrderEvent(order.buyer_id, { type: "order_auto_completed", orderId: order.id });
    notifyOrderEvent(order.seller_id, { type: "order_auto_completed", orderId: order.id });
  }
}

async function processDisputeTimers(disputeId?: string) {
  const stale = await pool.query(
    `select d.id, d.order_id as "orderId", o.buyer_id as "buyerId", o.seller_id as "sellerId"
     from disputes d
     join orders o on o.id = d.order_id
     where d.status = 'open'
       and ($1::uuid is null or d.id = $1)
       and d.created_at <= now() - interval '72 hours'
     order by d.created_at asc
     limit 50`,
    [disputeId ?? null]
  );
  for (const row of stale.rows) {
    notifyOrderEvent(row.buyerId, { type: "dispute_timer_due", orderId: row.orderId });
    notifyOrderEvent(row.sellerId, { type: "dispute_timer_due", orderId: row.orderId });
    logger.warn({ disputeId: row.id, orderId: row.orderId }, "dispute_timer_due");
  }
}

async function processPayout(userId?: string) {
  logger.info({ userId }, "payout_job_placeholder");
}

/**
 * Delivers a notification over every channel the user has enabled. Named "email" for
 * historical reasons (createNotification has always enqueued it as "email_notification"),
 * but it now also handles Telegram - splitting it into two job types would only mean two
 * lookups of the same user/preferences for no real benefit.
 */
async function processEmail(data: MarketplaceJobPayload) {
  if (!data.userId) {
    logger.warn({ data }, "notification_job_missing_user_id");
    return;
  }
  const userResult = await pool.query<{ email: string; displayName: string }>(
    `select email, display_name as "displayName" from users where id = $1`,
    [data.userId]
  );
  const user = userResult.rows[0];
  if (!user) return;

  const preferences = await getNotificationPreferences(data.userId);
  const subject = data.subject ?? "Уведомление SKRYNIA";
  const body = data.body ?? "";
  // subject/body often embed user-generated content (e.g. a chat message preview), so they
  // must be escaped before going into either HTML email or Telegram's HTML parse_mode.
  const safeSubject = escapeHtml(subject);
  const safeBody = escapeHtml(body);

  if (preferences.emailEnabled) {
    const sent = await sendEmail({
      to: user.email,
      subject,
      text: body,
      html: renderBrandedEmail({
        title: safeSubject,
        bodyHtml: `<p>${safeBody}</p>`,
        ctaText: "Открыть SKRYNIA",
        ctaUrl: env.FRONTEND_URL,
        footerNote: "Вы получили это письмо, потому что включены уведомления на email в настройках аккаунта."
      })
    });
    if (!sent) logger.info({ userId: data.userId, subject }, "email_notification_not_sent");
  }

  if (preferences.telegramEnabled) {
    const chatId = await getTelegramChatId(data.userId);
    if (chatId) await sendTelegramMessage(chatId, `<b>${safeSubject}</b>\n${safeBody}`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** Runs the reconciliation snapshot and pages every admin if any currency comes out mismatched. */
async function processReconciliationDaily() {
  const snapshots = await createReconciliationSnapshot();
  const mismatches = snapshots.filter((snapshot) => snapshot.status === "mismatch");
  if (!mismatches.length) return;

  logger.error({ mismatches }, "reconciliation_mismatch_detected");
  const admins = await pool.query<{ id: string }>(`select id from users where role = 'admin'`);
  const summary = mismatches.map((m) => `${m.currency}: ${m.differenceCents}`).join(", ");
  await Promise.all(
    admins.rows.map((admin) =>
      createNotification({
        userId: admin.id,
        type: "reconciliation_mismatch",
        title: "Расхождение в сверке баланса",
        body: `Обнаружено расхождение в ledger/wallet: ${summary}. Проверьте /admin/finance.`
      })
    )
  );
}

export function startJobWorker() {
  if (!env.JOB_WORKER_ENABLED || worker) return;
  const redis = getConnection();
  if (!redis) return;

  worker = new Worker<MarketplaceJobPayload, unknown, string>(
    "marketplace",
    async (job) => {
      if (job.name === "escrow_release") await processEscrowRelease(job.data.orderId);
      if (job.name === "dispute_timer") await processDisputeTimers(job.data.disputeId);
      if (job.name === "payout") await processPayout(job.data.userId);
      if (job.name === "email_notification") await processEmail(job.data);
      if (job.name === "reconciliation_daily") await processReconciliationDaily();
    },
    { connection: redis, concurrency: 5 }
  );

  worker.on("completed", (job) => {
    jobProcessedTotal.labels("marketplace", job.name, "completed").inc();
  });
  worker.on("failed", (job, error) => {
    jobProcessedTotal.labels("marketplace", job?.name ?? "unknown", "failed").inc();
    logger.error({ jobId: job?.id, name: job?.name, error }, "job_failed");
  });

  scheduleRecurringJobs().catch((error) => logger.error({ error }, "job_schedule_failed"));
}
