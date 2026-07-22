import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/errors.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { completePayout, rejectPayout } from "../users/wallet.service.js";
import { pool } from "../../db/pool.js";
import { buildNextCursor, keysetWhereClause, parseCursorPage } from "../../common/pagination.js";

const router = Router();
const adminOnly = requireRole("admin");

router.get(
  "/payouts",
  adminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const status = z.enum(["pending", "processing", "paid", "rejected"]).optional().parse(req.query.status);
    const { limit, cursor } = parseCursorPage(req.query, { defaultLimit: 100 });
    const values: unknown[] = [status ?? null];
    const cursorWhere = keysetWhereClause(values, cursor, "p.created_at", "p.id");
    values.push(limit);
    const result = await pool.query(
      `select p.id, p.user_id as "userId", u.display_name as "userDisplayName", u.email as "userEmail",
              p.amount_cents as "amountCents", p.currency, p.provider, p.destination, p.status,
              p.reference, p.admin_note as "adminNote", p.created_at as "createdAt", p.processed_at as "processedAt"
       from payouts p
       join users u on u.id = p.user_id
       where ($1::text is null or p.status = $1)
         ${cursorWhere ? `and ${cursorWhere}` : ""}
       order by p.created_at desc, p.id desc
       limit $${values.length}`,
      values
    );
    res.json({ payouts: result.rows, nextCursor: buildNextCursor(result.rows, limit) });
  })
);

/**
 * Admin has already wired the bank transfer themselves using the destination on file;
 * this just records the bank's own reference and marks the payout settled.
 */
router.post(
  "/payouts/:id/complete",
  adminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const payoutId = z.string().uuid().parse(req.params.id);
    const { reference } = z.object({ reference: z.string().trim().min(1).max(200) }).parse(req.body);
    const payout = await completePayout(payoutId, req.user.id, reference);
    res.json({ payout });
  })
);

router.post(
  "/payouts/:id/reject",
  adminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const payoutId = z.string().uuid().parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).parse(req.body);
    const payout = await rejectPayout(payoutId, req.user.id, reason);
    res.json({ payout });
  })
);

export default router;
