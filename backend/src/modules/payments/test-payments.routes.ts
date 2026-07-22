import { Router } from "express";
import { z } from "zod";
import { asyncHandler, forbidden } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { env } from "../../config/env.js";
import type { AuthedRequest } from "../../common/types.js";
import { simulateTestPaymentFailure, simulateTestPaymentSuccess, simulateTestPaymentWaitAccept } from "./test-payments.service.js";
import { mapOrderRowDto } from "../orders/orders.dto.js";

const router = Router();

/**
 * A buyer's own card/Monobank/wallet test panel — never a real payment. Stays available
 * available automatically only under NODE_ENV=test. Development/staging demos must
 * opt in explicitly with ENABLE_TEST_PAYMENTS so a non-production deployment cannot
 * silently expose a free escrow path.
 */
function assertTestPaymentsEnabled() {
  if (env.NODE_ENV !== "test" && !env.ENABLE_TEST_PAYMENTS) {
    throw forbidden("Test payments are disabled on this server");
  }
}

router.post(
  "/test/orders/:orderId/success",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    assertTestPaymentsEnabled();
    const orderId = z.string().uuid().parse(req.params.orderId);
    const order = await simulateTestPaymentSuccess(orderId, req.user.id);
    res.json({ order: mapOrderRowDto(order) });
  })
);

router.post(
  "/test/orders/:orderId/failure",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    assertTestPaymentsEnabled();
    const orderId = z.string().uuid().parse(req.params.orderId);
    const order = await simulateTestPaymentFailure(orderId, req.user.id);
    res.json({ order: mapOrderRowDto(order) });
  })
);

router.post(
  "/test/orders/:orderId/wait-accept",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    assertTestPaymentsEnabled();
    const orderId = z.string().uuid().parse(req.params.orderId);
    const order = await simulateTestPaymentWaitAccept(orderId, req.user.id);
    res.json({ order: mapOrderRowDto(order), waiting: true });
  })
);

export default router;
