import { Router } from "express";
import { asyncHandler } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireRole } from "../../common/middleware/rbac.js";
import { listCurrencyRates, refreshCurrencyRates } from "./currencies.service.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ baseCurrency: "UAH", rates: await listCurrencyRates() });
  })
);

router.post(
  "/refresh",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    res.json({ baseCurrency: "UAH", rates: await refreshCurrencyRates() });
  })
);

export default router;
