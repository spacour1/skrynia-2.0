import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, notFound } from "../../common/errors.js";
import type { AuthedRequest } from "../../common/types.js";
import { recordModerationAction } from "../reports/reports.service.js";

const router = Router();

router.get(
  "/reports",
  asyncHandler(async (req: AuthedRequest, res) => {
    const status = z.enum(["pending", "in_review", "resolved", "rejected"]).optional().parse(req.query.status);
    const userReports = await pool.query(
      `select ur.id, 'user' as kind, ur.reason, ur.description, ur.status, ur.priority,
              ur.moderator_note as "moderatorNote", ur.created_at as "createdAt", ur.resolved_at as "resolvedAt",
              ur.reporter_id as "reporterId", reporter.display_name as "reporterDisplayName",
              ur.reported_user_id as "reportedUserId", reported.display_name as "reportedDisplayName",
              null::uuid as "messageId"
       from user_reports ur
       join users reporter on reporter.id = ur.reporter_id
       join users reported on reported.id = ur.reported_user_id
       where coalesce($1, ur.status) = ur.status
       union all
       select mr.id, 'message' as kind, mr.reason, mr.description, mr.status, mr.priority,
              mr.moderator_note as "moderatorNote", mr.created_at as "createdAt", mr.resolved_at as "resolvedAt",
              mr.reporter_id as "reporterId", reporter.display_name as "reporterDisplayName",
              mr.reported_user_id as "reportedUserId", reported.display_name as "reportedDisplayName",
              mr.message_id as "messageId"
       from message_reports mr
       join users reporter on reporter.id = mr.reporter_id
       join users reported on reported.id = mr.reported_user_id
       where coalesce($1, mr.status) = mr.status
       order by priority desc, "createdAt" desc
       limit 300`,
      [status ?? null]
    );
    res.json({ reports: userReports.rows });
  })
);

router.post(
  "/messages/:id/hide",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await pool.query(
      `update messages set hidden_at = now(), hidden_by = $2 where id = $1
       returning id, conversation_id as "conversationId"`,
      [id, req.user.id]
    );
    if (!result.rows[0]) throw notFound("Message not found");
    await recordModerationAction({
      moderatorId: req.user.id,
      actionType: "hide_message",
      targetMessageId: id,
      targetConversationId: result.rows[0].conversationId
    });
    res.json({ ok: true });
  })
);

router.post(
  "/messages/:id/restore",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await pool.query(
      `update messages set hidden_at = null, hidden_by = null where id = $1
       returning id, conversation_id as "conversationId"`,
      [id]
    );
    if (!result.rows[0]) throw notFound("Message not found");
    await recordModerationAction({
      moderatorId: req.user.id,
      actionType: "restore_message",
      targetMessageId: id,
      targetConversationId: result.rows[0].conversationId
    });
    res.json({ ok: true });
  })
);

const resolveReportSchema = z.object({
  status: z.enum(["in_review", "resolved", "rejected"]),
  moderatorNote: z.string().max(3000).optional()
});

router.patch(
  "/reports/users/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = resolveReportSchema.parse(req.body);
    const isTerminal = input.status === "resolved" || input.status === "rejected";
    const result = await pool.query(
      `update user_reports
       set status = $2, moderator_id = $3, moderator_note = coalesce($4, moderator_note),
           resolved_at = case when $5 then now() else resolved_at end, updated_at = now()
       where id = $1
       returning id, reported_user_id as "reportedUserId"`,
      [id, input.status, req.user.id, input.moderatorNote ?? null, isTerminal]
    );
    if (!result.rows[0]) throw notFound("Report not found");
    if (isTerminal) {
      await recordModerationAction({
        moderatorId: req.user.id,
        actionType: input.status === "resolved" ? "close_report" : "reject_report",
        targetUserId: result.rows[0].reportedUserId,
        reason: input.moderatorNote
      });
    }
    res.json({ ok: true });
  })
);

router.patch(
  "/reports/messages/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = resolveReportSchema.parse(req.body);
    const isTerminal = input.status === "resolved" || input.status === "rejected";
    const result = await pool.query(
      `update message_reports
       set status = $2, moderator_id = $3, moderator_note = coalesce($4, moderator_note),
           resolved_at = case when $5 then now() else resolved_at end, updated_at = now()
       where id = $1
       returning id, message_id as "messageId", conversation_id as "conversationId", reported_user_id as "reportedUserId"`,
      [id, input.status, req.user.id, input.moderatorNote ?? null, isTerminal]
    );
    if (!result.rows[0]) throw notFound("Report not found");
    if (isTerminal) {
      await recordModerationAction({
        moderatorId: req.user.id,
        actionType: input.status === "resolved" ? "close_report" : "reject_report",
        targetUserId: result.rows[0].reportedUserId,
        targetMessageId: result.rows[0].messageId,
        targetConversationId: result.rows[0].conversationId,
        reason: input.moderatorNote
      });
    }
    res.json({ ok: true });
  })
);

export default router;
