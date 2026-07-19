import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, notFound } from "../../common/errors.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { revokeAllUserSessions } from "../auth/session.service.js";
import { publishSessionSecurityEvent } from "../auth/session-events.service.js";
import { recordModerationAction } from "../reports/reports.service.js";
import { createNotification } from "../notifications/notifications.service.js";
import {
  invalidateProductCacheBatch,
  loadSellerProductCacheContexts
} from "../marketplace/marketplace-cache.service.js";

const router = Router();
const adminOnly = requireRole("admin");

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
  adminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        role: z.enum(["user", "moderator", "admin"]).optional(),
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
      publishSessionSecurityEvent({ type: "user.banned", userId: id });
    }
    if (body.isBanned || body.role !== undefined) {
      // Ban and privilege changes invalidate every existing token immediately. The local
      // event closes this process's sockets; Stage 11 distributes it across replicas.
      await revokeAllUserSessions(id);
    }
    if (body.isBanned !== undefined) {
      // Fetch every affected product dimension in one query, then invalidate all detail
      // keys in batches and sweep shared namespaces once for the entire seller.
      const contexts = await loadSellerProductCacheContexts(id);
      await invalidateProductCacheBatch(contexts, { sellerIds: [id] });
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
      titleKey: "notifications.accountWarned.title",
      // The reason is written by the moderator — kept as-is, only the title is localized.
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
      titleKey: "notifications.accountMuted.title",
      ...(input.reason
        ? { body: input.reason }
        : {
            bodyKey: "notifications.accountMuted.body",
            params: { until: new Date(result.rows[0].mutedUntil).toISOString().slice(0, 16).replace("T", " ") + " UTC" }
          })
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

export default router;
