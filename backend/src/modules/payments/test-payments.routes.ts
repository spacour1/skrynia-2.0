import { Router } from "express";
import { z } from "zod";
import { asyncHandler, forbidden } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { env } from "../../config/env.js";
import type { AuthedRequest } from "../../common/types.js";
import { simulateTestPaymentFailure, simulateTestPaymentSuccess, simulateTestPaymentWaitAccept } from "./test-payments.service.js";
import { mapOrderMutationDto } from "../orders/orders.dto.js";
import { testPaymentsEnabled } from "./test-payments.gate.js";

const router = Router();

/**
 * A buyer's own card/Monobank/wallet test panel — never a real payment. Both guards
 * are required: the process must be an explicit test environment and the feature flag
 * must be enabled. A production or staging process can therefore never expose a free
 * escrow path merely because one boolean was misconfigured.
 */
function assertTestPaymentsEnabled() {
  if (!testPaymentsEnabled(env)) {
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
    res.json({ order: mapOrderMutationDto(order) });
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
    res.json({ order: mapOrderMutationDto(order) });
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
    res.json({ order: mapOrderMutationDto(order), waiting: true });
  })
);

export default router;
