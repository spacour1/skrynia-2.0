import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { createReconciliationSnapshot } from "./reconciliation.service.js";
import { enqueueJob, getJobQueue } from "../jobs/queue.js";
import { disconnectUser } from "../chat/ws.service.js";
import { revokeAllUserSessions } from "../auth/session.service.js";
import { cacheDel, cacheDelPattern } from "../../common/redis.js";
import { lockEscrow } from "../orders/ledger.service.js";
import { announceOrderPaid } from "../payments/payments.routes.js";
import { paymentAttemptsTotal } from "../../common/metrics.js";
import { logger } from "../../common/logger.js";
import { listPayouts, completePayout, rejectPayout } from "../users/wallet.service.js";
import { recordModerationAction } from "../reports/reports.service.js";
import { createNotification } from "../notifications/notifications.service.js";

const router = Router();

router.use(authenticate, requireRole("admin"));

router.get(
  "/overview",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const [users, products, orders, disputes, revenue] = await Promise.all([
      pool.query(`select count(*)::int as count from users`),
      pool.query(`select count(*)::int as count from products where status != 'deleted'`),
      pool.query(`select status, count(*)::int as count from orders group by status`),
      pool.query(`select count(*)::int as count from disputes where status = 'open'`),
      pool.query(`select currency, revenue_cents as "revenueCents" from platform_wallets`)
    ]);
    res.json({
      users: users.rows[0].count,
      products: products.rows[0].count,
      ordersByStatus: orders.rows,
      openDisputes: disputes.rows[0].count,
      revenue: revenue.rows
    });
  })
);

router.get(
  "/users",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select id, email, display_name as "displayName", role, is_banned as "isBanned",
              muted_until as "mutedUntil", created_at as "createdAt"
       from users
       order by created_at desc
       limit 200`
    );
    res.json({ users: result.rows });
  })
);

router.patch(
  "/users/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        role: z.enum(["user", "admin"]).optional(),
        isBanned: z.boolean().optional()
      })
      .parse(req.body);
    const result = await pool.query(
      `update users
       set role = coalesce($2, role),
           is_banned = coalesce($3, is_banned),
           updated_at = now()
       where id = $1
       returning id, email, display_name as "displayName", role, is_banned as "isBanned"`,
      [id, body.role, body.isBanned]
    );
    if (!result.rows[0]) throw notFound("User not found");
    if (body.isBanned) {
      // Belt-and-suspenders: revoke the Redis-tracked sessions/refresh tokens immediately
      // (rather than waiting for the next authenticate() call to notice is_banned) and close
      // any live websocket connections regardless of which session token they used.
      await revokeAllUserSessions(id);
      disconnectUser(id);
    }
    res.json({ user: result.rows[0] });
  })
);

const warnUserSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

router.post(
  "/users/:id/warn",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = warnUserSchema.parse(req.body);
    const target = await pool.query(`select id from users where id = $1`, [id]);
    if (!target.rows[0]) throw notFound("User not found");

    await recordModerationAction({ moderatorId: req.user.id, actionType: "warn_user", targetUserId: id, reason: input.reason });
    await createNotification({
      userId: id,
      type: "account_warned",
      title: "Предупреждение от модератора",
      body: input.reason
    });
    res.json({ ok: true });
  })
);

const muteUserSchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30),
  reason: z.string().trim().min(3).max(1000).optional()
});

router.post(
  "/users/:id/mute",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = muteUserSchema.parse(req.body);
    const result = await pool.query(
      `update users set muted_until = now() + ($2 || ' hours')::interval, updated_at = now()
       where id = $1
       returning id, muted_until as "mutedUntil"`,
      [id, input.hours]
    );
    if (!result.rows[0]) throw notFound("User not found");

    await recordModerationAction({ moderatorId: req.user.id, actionType: "mute_user", targetUserId: id, reason: input.reason });
    await createNotification({
      userId: id,
      type: "account_muted",
      title: "Временное ограничение на сообщения",
      body: input.reason ?? `Вы не можете отправлять сообщения до ${new Date(result.rows[0].mutedUntil).toLocaleString("ru-RU")}.`
    });
    res.json({ user: result.rows[0] });
  })
);

router.post(
  "/users/:id/unmute",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await pool.query(
      `update users set muted_until = null, updated_at = now() where id = $1 returning id, muted_until as "mutedUntil"`,
      [id]
    );
    if (!result.rows[0]) throw notFound("User not found");

    await recordModerationAction({ moderatorId: req.user.id, actionType: "unmute_user", targetUserId: id });
    res.json({ user: result.rows[0] });
  })
);

router.get(
  "/media",
  asyncHandler(async (req: AuthedRequest, res) => {
    const status = z.enum(["pending", "approved", "rejected"]).optional().parse(req.query.status);
    const result = await pool.query(
      `select pm.id, pm.url, pm.type, pm.sort_order as "sortOrder", pm.status, pm.created_at as "createdAt",
              p.id as "productId", p.title as "productTitle",
              u.id as "sellerId", u.display_name as "sellerDisplayName"
       from product_media pm
       join products p on p.id = pm.product_id
       join users u on u.id = p.seller_id
       where coalesce($1, pm.status) = pm.status
       order by pm.created_at desc
       limit 200`,
      [status ?? null]
    );
    res.json({ media: result.rows });
  })
);

router.patch(
  "/media/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { status } = z.object({ status: z.enum(["pending", "approved", "rejected"]) }).parse(req.body);
    const result = await pool.query(
      `update product_media set status = $2 where id = $1 returning product_id as "productId"`,
      [id, status]
    );
    if (!result.rows[0]) throw notFound("Media not found");
    await cacheDel(`marketplace:product:${result.rows[0].productId}`);
    await cacheDelPattern("marketplace:products:*");
    res.json({ ok: true });
  })
);

router.get(
  "/transactions",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select t.id, t.type, t.direction, t.amount_cents as "amountCents", t.currency, t.status,
              t.created_at as "createdAt", t.order_id as "orderId",
              u.email, u.display_name as "displayName"
       from transactions t
       left join users u on u.id = t.user_id
       order by t.created_at desc
       limit 300`
    );
    res.json({ transactions: result.rows });
  })
);

router.get(
  "/audit",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select a.id, a.trace_id as "traceId", a.user_id as "userId",
              u.email, u.display_name as "displayName",
              a.method, a.path, a.endpoint, a.status_code as "statusCode",
              a.ip_address as "ipAddress", a.user_agent as "userAgent",
              a.action, a.request_body as "requestBody", a.metadata,
              a.created_at as "createdAt"
       from audit_logs a
       left join users u on u.id = a.user_id
       order by a.created_at desc
       limit 300`
    );
    res.json({ auditLogs: result.rows });
  })
);

router.get(
  "/jobs",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const queue = getJobQueue();
    if (!queue) return res.json({ enabled: false, counts: {} });
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
    res.json({ enabled: true, counts });
  })
);

router.post(
  "/jobs/:name",
  asyncHandler(async (req: AuthedRequest, res) => {
    const name = z.enum(["escrow_release", "payout", "dispute_timer", "email_notification"]).parse(req.params.name);
    const job = await enqueueJob(name, z.record(z.string(), z.unknown()).default({}).parse(req.body));
    res.status(201).json({ jobId: job?.id ?? null });
  })
);

router.get(
  "/ledger",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select e.id, e.idempotency_key as "idempotencyKey", e.entry_type as "entryType",
              e.order_id as "orderId", e.currency, e.metadata, e.created_at as "createdAt",
              coalesce(
                json_agg(
                  json_build_object(
                    'id', l.id,
                    'accountCode', a.code,
                    'accountName', a.name,
                    'accountType', a.account_type,
                    'userId', a.user_id,
                    'debitCents', l.debit_cents,
                    'creditCents', l.credit_cents
                  )
                  order by l.created_at, l.id
                ) filter (where l.id is not null),
                '[]'::json
              ) as lines
       from ledger_entries e
       left join ledger_lines l on l.entry_id = e.id
       left join ledger_accounts a on a.id = l.account_id
       group by e.id
       order by e.created_at desc
       limit 200`
    );
    res.json({ entries: result.rows });
  })
);

router.post(
  "/reconciliation/run",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const snapshots = await createReconciliationSnapshot();
    res.status(201).json({ snapshots });
  })
);

router.get(
  "/reconciliation",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select id, currency,
              wallet_available_cents as "walletAvailableCents",
              wallet_escrow_cents as "walletEscrowCents",
              ledger_payable_cents as "ledgerPayableCents",
              ledger_escrow_cents as "ledgerEscrowCents",
              platform_revenue_cents as "platformRevenueCents",
              ledger_revenue_cents as "ledgerRevenueCents",
              provider_clearing_cents as "providerClearingCents",
              difference_cents as "differenceCents",
              status, metadata, created_at as "createdAt"
       from reconciliation_snapshots
       order by created_at desc
       limit 100`
    );
    res.json({ snapshots: result.rows });
  })
);

router.get(
  "/listings",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select p.id, p.title, p.status, p.price_cents as "priceCents", p.currency,
              p.created_at as "createdAt", c.name as "categoryName",
              g.name as "gameName", gs.name as "sectionName",
              u.display_name as "sellerDisplayName"
       from products p
       join categories c on c.id = p.category_id
       left join games g on g.id = p.game_id
       left join game_sections gs on gs.id = p.section_id
       join users u on u.id = p.seller_id
       where p.status != 'deleted'
       order by p.created_at desc
       limit 300`
    );
    res.json({ listings: result.rows });
  })
);

router.patch(
  "/listings/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    // isHot/isRecommended are promotional placements, not something a seller should be
    // able to grant themselves — they're only settable here, through the admin panel.
    const body = z
      .object({
        status: z.enum(["active", "paused", "blocked", "deleted"]).optional(),
        isHot: z.boolean().optional(),
        isRecommended: z.boolean().optional()
      })
      .parse(req.body);
    const result = await pool.query(
      `update products
       set status = coalesce($2, status),
           is_hot = coalesce($3, is_hot),
           is_recommended = coalesce($4, is_recommended),
           updated_at = now()
       where id = $1
       returning id, title, status, is_hot as "isHot", is_recommended as "isRecommended"`,
      [id, body.status ?? null, body.isHot ?? null, body.isRecommended ?? null]
    );
    if (!result.rows[0]) throw notFound("Listing not found");
    res.json({ listing: result.rows[0] });
  })
);

router.get(
  "/orders/pending",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select o.id, o.amount_cents as "amountCents", o.currency, o.created_at as "createdAt",
              p.title as "productTitle",
              buyer.id as "buyerId", buyer.display_name as "buyerDisplayName", buyer.email as "buyerEmail",
              seller.display_name as "sellerDisplayName"
       from orders o
       join products p on p.id = o.product_id
       join users buyer on buyer.id = o.buyer_id
       join users seller on seller.id = o.seller_id
       where o.status = 'pending'
       order by o.created_at desc
       limit 200`
    );
    res.json({ orders: result.rows });
  })
);

/**
 * Manual bank-transfer confirmation: there's no webhook for this provider, so an admin
 * reviewing the actual incoming transfer is what stands in for payment verification
 * before escrow is locked.
 */
router.post(
  "/orders/:id/confirm-payment",
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.id);
    const { reference } = z.object({ reference: z.string().trim().max(200).optional() }).parse(req.body);

    const orderRow = await pool.query(`select id, buyer_id from orders where id = $1`, [orderId]);
    const order = orderRow.rows[0];
    if (!order) throw notFound("Order not found");

    let updated;
    try {
      updated = await lockEscrow(orderId, order.buyer_id, "manual", reference);
      paymentAttemptsTotal.labels("manual", "captured").inc();
    } catch (error) {
      paymentAttemptsTotal.labels("manual", "failed").inc();
      logger.warn({ orderId, error }, "manual_payment_confirm_failed");
      throw badRequest("Could not confirm this order's payment");
    }
    await announceOrderPaid(updated, req.user.id);
    res.json({ order: updated });
  })
);

router.get(
  "/payouts",
  asyncHandler(async (req: AuthedRequest, res) => {
    const status = z.enum(["pending", "processing", "paid", "rejected"]).optional().parse(req.query.status);
    const payouts = await listPayouts(status);
    res.json({ payouts });
  })
);

/**
 * Admin has already wired the bank transfer themselves using the destination on file;
 * this just records the bank's own reference and marks the payout settled.
 */
router.post(
  "/payouts/:id/complete",
  asyncHandler(async (req: AuthedRequest, res) => {
    const payoutId = z.string().uuid().parse(req.params.id);
    const { reference } = z.object({ reference: z.string().trim().min(1).max(200) }).parse(req.body);
    const payout = await completePayout(payoutId, req.user.id, reference);
    res.json({ payout });
  })
);

router.post(
  "/payouts/:id/reject",
  asyncHandler(async (req: AuthedRequest, res) => {
    const payoutId = z.string().uuid().parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).parse(req.body);
    const payout = await rejectPayout(payoutId, req.user.id, reason);
    res.json({ payout });
  })
);

router.get(
  "/reports",
  asyncHandler(async (req: AuthedRequest, res) => {
    const status = z.enum(["pending", "in_review", "resolved", "rejected"]).optional().parse(req.query.status);
    const userReports = await pool.query(
      `select ur.id, 'user' as kind, ur.reason, ur.description, ur.status, ur.priority,
              ur.moderator_note as "moderatorNote", ur.created_at as "createdAt", ur.resolved_at as "resolvedAt",
              ur.reporter_id as "reporterId", reporter.display_name as "reporterDisplayName",
              ur.reported_user_id as "reportedUserId", reported.display_name as "reportedDisplayName",
              null::uuid as "messageId"
       from user_reports ur
       join users reporter on reporter.id = ur.reporter_id
       join users reported on reported.id = ur.reported_user_id
       where coalesce($1, ur.status) = ur.status
       union all
       select mr.id, 'message' as kind, mr.reason, mr.description, mr.status, mr.priority,
              mr.moderator_note as "moderatorNote", mr.created_at as "createdAt", mr.resolved_at as "resolvedAt",
              mr.reporter_id as "reporterId", reporter.display_name as "reporterDisplayName",
              mr.reported_user_id as "reportedUserId", reported.display_name as "reportedDisplayName",
              mr.message_id as "messageId"
       from message_reports mr
       join users reporter on reporter.id = mr.reporter_id
       join users reported on reported.id = mr.reported_user_id
       where coalesce($1, mr.status) = mr.status
       order by priority desc, "createdAt" desc
       limit 300`,
      [status ?? null]
    );
    res.json({ reports: userReports.rows });
  })
);

router.post(
  "/messages/:id/hide",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await pool.query(
      `update messages set hidden_at = now(), hidden_by = $2 where id = $1
       returning id, conversation_id as "conversationId"`,
      [id, req.user.id]
    );
    if (!result.rows[0]) throw notFound("Message not found");
    await recordModerationAction({
      moderatorId: req.user.id,
      actionType: "hide_message",
      targetMessageId: id,
      targetConversationId: result.rows[0].conversationId
    });
    res.json({ ok: true });
  })
);

router.post(
  "/messages/:id/restore",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await pool.query(
      `update messages set hidden_at = null, hidden_by = null where id = $1
       returning id, conversation_id as "conversationId"`,
      [id]
    );
    if (!result.rows[0]) throw notFound("Message not found");
    await recordModerationAction({
      moderatorId: req.user.id,
      actionType: "restore_message",
      targetMessageId: id,
      targetConversationId: result.rows[0].conversationId
    });
    res.json({ ok: true });
  })
);

const resolveReportSchema = z.object({
  status: z.enum(["in_review", "resolved", "rejected"]),
  moderatorNote: z.string().max(3000).optional()
});

router.patch(
  "/reports/users/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = resolveReportSchema.parse(req.body);
    const isTerminal = input.status === "resolved" || input.status === "rejected";
    const result = await pool.query(
      `update user_reports
       set status = $2, moderator_id = $3, moderator_note = coalesce($4, moderator_note),
           resolved_at = case when $5 then now() else resolved_at end, updated_at = now()
       where id = $1
       returning id, reported_user_id as "reportedUserId"`,
      [id, input.status, req.user.id, input.moderatorNote ?? null, isTerminal]
    );
    if (!result.rows[0]) throw notFound("Report not found");
    if (isTerminal) {
      await recordModerationAction({
        moderatorId: req.user.id,
        actionType: input.status === "resolved" ? "close_report" : "reject_report",
        targetUserId: result.rows[0].reportedUserId,
        reason: input.moderatorNote
      });
    }
    res.json({ ok: true });
  })
);

router.patch(
  "/reports/messages/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = resolveReportSchema.parse(req.body);
    const isTerminal = input.status === "resolved" || input.status === "rejected";
    const result = await pool.query(
      `update message_reports
       set status = $2, moderator_id = $3, moderator_note = coalesce($4, moderator_note),
           resolved_at = case when $5 then now() else resolved_at end, updated_at = now()
       where id = $1
       returning id, message_id as "messageId", conversation_id as "conversationId", reported_user_id as "reportedUserId"`,
      [id, input.status, req.user.id, input.moderatorNote ?? null, isTerminal]
    );
    if (!result.rows[0]) throw notFound("Report not found");
    if (isTerminal) {
      await recordModerationAction({
        moderatorId: req.user.id,
        actionType: input.status === "resolved" ? "close_report" : "reject_report",
        targetUserId: result.rows[0].reportedUserId,
        targetMessageId: result.rows[0].messageId,
        targetConversationId: result.rows[0].conversationId,
        reason: input.moderatorNote
      });
    }
    res.json({ ok: true });
  })
);

export default router;
