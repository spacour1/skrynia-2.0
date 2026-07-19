import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { enqueueJob, getJobQueue } from "../jobs/queue.js";
import { lockEscrow } from "../orders/ledger.service.js";
import { announceOrderPaid } from "../payments/payments.routes.js";
import { paymentAttemptsTotal } from "../../common/metrics.js";
import { logger } from "../../common/logger.js";
import {
  invalidateProductCaches,
  loadProductCacheContext,
  type ProductCacheContext
} from "../marketplace/marketplace-cache.service.js";

const router = Router();
const adminOnly = requireRole("admin");

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
    const context = await loadProductCacheContext(result.rows[0].productId);
    if (context) await invalidateProductCaches(context);
    res.json({ ok: true });
  })
);

router.get(
  "/audit",
  adminOnly,
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
  adminOnly,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const queue = getJobQueue();
    if (!queue) return res.json({ enabled: false, counts: {} });
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
    res.json({ enabled: true, counts });
  })
);

router.post(
  "/jobs/:name",
  adminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const name = z
      .enum(["escrow_release", "payout", "dispute_timer", "notification_delivery", "email_notification", "reconciliation_daily"])
      .parse(req.params.name);
    const job = await enqueueJob(name, z.record(z.string(), z.unknown()).default({}).parse(req.body));
    res.status(201).json({ jobId: job?.id ?? null });
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
    const result = await pool.query<
      ProductCacheContext & {
        id: string;
        title: string;
        status: string;
        isHot: boolean;
        isRecommended: boolean;
      }
    >(
      `update products
       set status = coalesce($2, status),
           is_hot = coalesce($3, is_hot),
           is_recommended = coalesce($4, is_recommended),
           updated_at = now()
       where id = $1
       returning id, id as "productId", seller_id as "sellerId", category_id as "categoryId",
                 game_id as "gameId", section_id as "sectionId",
                 title, status, is_hot as "isHot", is_recommended as "isRecommended"`,
      [id, body.status ?? null, body.isHot ?? null, body.isRecommended ?? null]
    );
    const listing = result.rows[0];
    if (!listing) throw notFound("Listing not found");
    await invalidateProductCaches(listing);
    const {
      productId: _productId,
      sellerId: _sellerId,
      categoryId: _categoryId,
      gameId: _gameId,
      sectionId: _sectionId,
      ...publicListing
    } = listing;
    res.json({ listing: publicListing });
  })
);

router.get(
  "/orders/pending",
  adminOnly,
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
  adminOnly,
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
