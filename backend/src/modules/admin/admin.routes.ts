import { Router } from "express";
import { authenticate } from "../../common/middleware/auth.js";
import { requireRole } from "../../common/middleware/rbac.js";
import usersRoutes from "./admin-users.routes.js";
import financeRoutes from "./admin-finance.routes.js";
import payoutsRoutes from "./admin-payouts.routes.js";
import reportsRoutes from "./admin-reports.routes.js";
import opsRoutes from "./admin-ops.routes.js";

const router = Router();

// Moderators get the trust & safety tools (warnings, mutes, reports, message/listing
// moderation). Anything touching money, payouts, ledger internals, role/ban changes, or
// background jobs is additionally gated with requireRole("admin") in each sub-router.
router.use(authenticate, requireRole("admin", "moderator"));

router.use(usersRoutes);
router.use(financeRoutes);
router.use(payoutsRoutes);
router.use(reportsRoutes);
router.use(opsRoutes);

export default router;
