import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/errors.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { listPayouts, completePayout, rejectPayout } from "../users/wallet.service.js";

const router = Router();
const adminOnly = requireRole("admin");

router.get(
  "/payouts",
  adminOnly,
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
