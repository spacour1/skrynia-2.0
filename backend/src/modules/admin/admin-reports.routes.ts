import { Router } from "express";
import { z } from "zod";
import { inTx, pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import type { AuthedRequest } from "../../common/types.js";
import { recordModerationAction } from "../reports/reports.service.js";
import { enqueueDomainEvent } from "../outbox/outbox.service.js";
import { broadcastConversation } from "../chat/ws.service.js";

const router = Router();

const reportStatusSchema = z.enum(["pending", "in_review", "resolved", "rejected"]);
const reportCursorSchema = z.object({
  v: z.literal(1),
  status: reportStatusSchema.nullable(),
  priorityRank: z.number().int().min(0).max(1),
  createdAt: z.string().refine(
    (value) => Number.isFinite(Date.parse(value)),
    "Invalid cursor timestamp"
  ),
  kind: z.enum(["user", "message"]),
  id: z.string().uuid()
});

type ReportCursor = z.infer<typeof reportCursorSchema>;

function decodeReportCursor(raw: string): ReportCursor {
  try {
    return reportCursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    );
  } catch {
    throw badRequest("Invalid pagination cursor");
  }
}

function encodeReportCursor(cursor: ReportCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

router.get(
  "/reports",
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = z.object({
      status: reportStatusSchema.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(100),
      cursor: z.string().max(1024).optional(),
      page: z.coerce.number().int().min(1).max(1).optional()
    }).parse(req.query);
    const cursor = input.cursor ? decodeReportCursor(input.cursor) : null;
    if (cursor && cursor.status !== (input.status ?? null)) {
      throw badRequest("Pagination cursor does not match report filters");
    }
    const values: unknown[] = [input.status ?? null];
    let cursorWhere = "";
    if (cursor) {
      values.push(
        cursor.priorityRank,
        cursor.createdAt,
        cursor.kind,
        cursor.id
      );
      cursorWhere = `where (case when priority = 'high' then 1 else 0 end, "createdAt", kind, id)
        < ($2::int, $3::timestamptz, $4::text, $5::uuid)`;
    }
    values.push(input.limit + 1);
    const userReports = await pool.query(
      `select id, kind, reason, description, status, priority,
              "moderatorNote", "createdAt", "resolvedAt", "reporterId", "reporterDisplayName",
              "reportedUserId", "reportedDisplayName", "messageId",
              "createdAt"::text as "cursorCreatedAt",
              case when priority = 'high' then 1 else 0 end as "priorityRank"
       from (
       select ur.id, 'user'::text as kind, ur.reason, ur.description, ur.status, ur.priority,
              ur.moderator_note as "moderatorNote", ur.created_at as "createdAt", ur.resolved_at as "resolvedAt",
              ur.reporter_id as "reporterId", reporter.display_name as "reporterDisplayName",
              ur.reported_user_id as "reportedUserId", reported.display_name as "reportedDisplayName",
              null::uuid as "messageId"
       from user_reports ur
       join users reporter on reporter.id = ur.reporter_id
       join users reported on reported.id = ur.reported_user_id
       where coalesce($1, ur.status) = ur.status
       union all
       select mr.id, 'message'::text as kind, mr.reason, mr.description, mr.status, mr.priority,
              mr.moderator_note as "moderatorNote", mr.created_at as "createdAt", mr.resolved_at as "resolvedAt",
              mr.reporter_id as "reporterId", reporter.display_name as "reporterDisplayName",
              mr.reported_user_id as "reportedUserId", reported.display_name as "reportedDisplayName",
              mr.message_id as "messageId"
       from message_reports mr
       join users reporter on reporter.id = mr.reporter_id
       join users reported on reported.id = mr.reported_user_id
       where coalesce($1, mr.status) = mr.status
       ) reports_base
       ${cursorWhere}
       order by "priorityRank" desc, "createdAt" desc, kind desc, id desc
       limit $${values.length}`,
      values
    );
    const hasMore = userReports.rows.length > input.limit;
    const pageRows = userReports.rows.slice(0, input.limit);
    const reports = pageRows.map(
      ({ cursorCreatedAt: _cursorCreatedAt, priorityRank: _priorityRank, ...row }) => row
    );
    const last = pageRows.at(-1);
    const nextCursor = hasMore && last
      ? encodeReportCursor({
          v: 1,
          status: input.status ?? null,
          priorityRank: Number(last.priorityRank),
          createdAt: last.cursorCreatedAt,
          kind: last.kind,
          id: last.id
        })
      : null;
    res.json({ reports, page: 1, hasMore, nextCursor });
  })
);

router.post(
  "/messages/:id/hide",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const realtime = await inTx(async (client) => {
      const result = await client.query(
        `update messages set hidden_at = now(), hidden_by = $2 where id = $1
         returning id, conversation_id as "conversationId"`,
        [id, req.user.id]
      );
      if (!result.rows[0]) throw notFound("Message not found");
      const action = await recordModerationAction({
        moderatorId: req.user.id,
        actionType: "hide_message",
        targetMessageId: id,
        targetConversationId: result.rows[0].conversationId
      }, client);
      const event = await enqueueDomainEvent(client, {
        eventKey: `message.moderated:${action.id}`,
        eventType: "message.moderated",
        aggregateType: "message",
        aggregateId: id,
        payload: {
          messageId: id,
          conversationId: result.rows[0].conversationId,
          hidden: true
        }
      });
      return {
        eventId: event.id,
        conversationId: result.rows[0].conversationId as string,
        payload: {
          type: "message.moderated" as const,
          messageId: id,
          conversationId: result.rows[0].conversationId as string,
          hidden: true
        }
      };
    });
    await broadcastConversation(
      realtime.conversationId,
      realtime.payload,
      { eventId: realtime.eventId }
    );
    res.json({ ok: true });
  })
);

router.post(
  "/messages/:id/restore",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const realtime = await inTx(async (client) => {
      const result = await client.query(
        `update messages set hidden_at = null, hidden_by = null where id = $1
         returning id, conversation_id as "conversationId"`,
        [id]
      );
      if (!result.rows[0]) throw notFound("Message not found");
      const action = await recordModerationAction({
        moderatorId: req.user.id,
        actionType: "restore_message",
        targetMessageId: id,
        targetConversationId: result.rows[0].conversationId
      }, client);
      const event = await enqueueDomainEvent(client, {
        eventKey: `message.moderated:${action.id}`,
        eventType: "message.moderated",
        aggregateType: "message",
        aggregateId: id,
        payload: {
          messageId: id,
          conversationId: result.rows[0].conversationId,
          hidden: false
        }
      });
      return {
        eventId: event.id,
        conversationId: result.rows[0].conversationId as string,
        payload: {
          type: "message.moderated" as const,
          messageId: id,
          conversationId: result.rows[0].conversationId as string,
          hidden: false
        }
      };
    });
    await broadcastConversation(
      realtime.conversationId,
      realtime.payload,
      { eventId: realtime.eventId }
    );
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
