import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import type { AuthedRequest } from "../../common/types.js";
import {
  createMessageReport,
  createUserReport,
  MESSAGE_REPORT_REASONS,
  USER_REPORT_REASONS
} from "./reports.service.js";

const router = Router();

const reportUserSchema = z.object({
  reportedUserId: z.string().uuid(),
  reason: z.enum(USER_REPORT_REASONS),
  description: z.string().max(3000).optional()
});

const reportMessageSchema = z.object({
  messageId: z.string().uuid(),
  reason: z.enum(MESSAGE_REPORT_REASONS),
  description: z.string().max(3000).optional()
});

router.post(
  "/users",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = reportUserSchema.parse(req.body);
    const report = await createUserReport(req.user.id, input);
    res.status(201).json({ report });
  })
);

router.post(
  "/messages",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = reportMessageSchema.parse(req.body);
    const report = await createMessageReport(req.user.id, req.user.role, input);
    res.status(201).json({ report });
  })
);

router.get(
  "/my",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userReports = await pool.query(
      `select id, 'user' as kind, reported_user_id as "reportedUserId", null as "messageId", reason, description,
              status, priority, moderator_note as "moderatorNote", created_at as "createdAt", resolved_at as "resolvedAt"
       from user_reports
       where reporter_id = $1`,
      [req.user.id]
    );
    const messageReports = await pool.query(
      `select id, 'message' as kind, reported_user_id as "reportedUserId", message_id as "messageId", reason, description,
              status, priority, moderator_note as "moderatorNote", created_at as "createdAt", resolved_at as "resolvedAt"
       from message_reports
       where reporter_id = $1`,
      [req.user.id]
    );
    const reports = [...userReports.rows, ...messageReports.rows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.json({ reports });
  })
);

export default router;
