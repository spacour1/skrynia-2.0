import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import type { AuthedRequest } from "../../common/types.js";
import {
  buildLookaheadNextCursor,
  keysetWhereClause,
  parseCursorPage
} from "../../common/pagination.js";
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
    const { limit, cursor } = parseCursorPage(req.query);
    const values: unknown[] = [req.user.id];
    const cursorWhere = keysetWhereClause(values, cursor, "created_at", "id");
    values.push(limit + 1);
    const result = await pool.query(
      `select id, kind, reported_user_id as "reportedUserId", message_id as "messageId",
              reason, description, status, priority, moderator_note as "moderatorNote",
              created_at as "createdAt", created_at::text as "cursorCreatedAt",
              resolved_at as "resolvedAt"
       from (
         select id, 'user'::text as kind, reported_user_id, null::uuid as message_id,
                reason, description, status, priority, moderator_note, created_at, resolved_at
         from user_reports
         where reporter_id = $1
         union all
         select id, 'message'::text as kind, reported_user_id, message_id,
                reason, description, status, priority, moderator_note, created_at, resolved_at
         from message_reports
         where reporter_id = $1
       ) own_reports
       ${cursorWhere ? `where ${cursorWhere}` : ""}
       order by created_at desc, id desc
       limit $${values.length}`,
      values
    );
    const nextCursor = buildLookaheadNextCursor(
      result.rows.map((row) => ({ id: row.id, createdAt: row.cursorCreatedAt })),
      limit
    );
    const reports = result.rows
      .slice(0, limit)
      .map(({ cursorCreatedAt: _cursor, ...row }) => row);
    res.json({ reports, nextCursor });
  })
);

export default router;
