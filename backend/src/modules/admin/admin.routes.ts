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
import { cacheDel, cacheDelPattern } from "../../common/redis.js";
import { lockEscrow } from "../orders/ledger.service.js";
import { announceOrderPaid } from "../payments/payments.routes.js";
import { paymentAttemptsTotal } from "../../common/metrics.js";
import { logger } from "../../common/logger.js";

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
      `select id, email, display_name as "displayName", role, is_banned as "isBanned", created_at as "createdAt"
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
    if (body.isBanned) disconnectUser(id);
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
    const body = z.object({ status: z.enum(["active", "paused", "blocked", "deleted"]) }).parse(req.body);
    const result = await pool.query(
      `update products set status = $2, updated_at = now()
       where id = $1
       returning id, title, status`,
      [id, body.status]
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

export default router;
