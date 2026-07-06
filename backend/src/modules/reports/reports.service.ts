import { badRequest, notFound } from "../../common/errors.js";
import { pool } from "../../db/pool.js";
import { assertConversationAccess } from "../chat/chat.service.js";
import { notifyAdmins } from "../notifications/notifications.service.js";

export type ModerationActionType =
  | "hide_message"
  | "restore_message"
  | "warn_user"
  | "mute_user"
  | "unmute_user"
  | "close_report"
  | "reject_report"
  | "lock_conversation"
  | "unlock_conversation";

export const USER_REPORT_REASONS = [
  "fraud",
  "abuse",
  "spam",
  "fake_lot",
  "payment_issue",
  "off_platform_deal",
  "illegal_content",
  "other"
] as const;

export const MESSAGE_REPORT_REASONS = [
  "insult",
  "spam",
  "scam",
  "off_platform_deal",
  "personal_data",
  "prohibited_content",
  "other"
] as const;

const HIGH_PRIORITY_MESSAGE_REASONS = new Set(["scam", "off_platform_deal", "personal_data", "prohibited_content"]);

export async function recordModerationAction(input: {
  moderatorId: string;
  actionType: ModerationActionType;
  targetUserId?: string;
  targetMessageId?: string;
  targetConversationId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `insert into moderation_actions(moderator_id, target_user_id, target_message_id, target_conversation_id, action_type, reason, metadata)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.moderatorId,
      input.targetUserId ?? null,
      input.targetMessageId ?? null,
      input.targetConversationId ?? null,
      input.actionType,
      input.reason ?? null,
      input.metadata ?? {}
    ]
  );
}

export async function createUserReport(
  reporterId: string,
  input: { reportedUserId: string; reason: (typeof USER_REPORT_REASONS)[number]; description?: string }
) {
  if (input.reportedUserId === reporterId) throw badRequest("You cannot report yourself");
  const target = await pool.query(`select id from users where id = $1`, [input.reportedUserId]);
  if (!target.rows[0]) throw notFound("User not found");

  const result = await pool.query(
    `insert into user_reports(reporter_id, reported_user_id, reason, description)
     values ($1, $2, $3, $4)
     returning id, reporter_id as "reporterId", reported_user_id as "reportedUserId", reason, description,
               status, priority, created_at as "createdAt"`,
    [reporterId, input.reportedUserId, input.reason, input.description ?? null]
  );
  const report = result.rows[0];
  await notifyAdmins(
    { type: "report_submitted", templateKey: "notifications.reportSubmitted", params: { reason: input.reason } },
    ["admin", "moderator"]
  );
  return report;
}

export async function createMessageReport(
  reporterId: string,
  reporterRole: string,
  input: { messageId: string; reason: (typeof MESSAGE_REPORT_REASONS)[number]; description?: string }
) {
  const message = await pool.query(
    `select id, conversation_id as "conversationId", sender_id as "senderId" from messages where id = $1`,
    [input.messageId]
  );
  const row = message.rows[0];
  if (!row) throw notFound("Message not found");
  if (row.senderId === reporterId) throw badRequest("You cannot report your own message");
  await assertConversationAccess(row.conversationId, reporterId, reporterRole);

  const priority = HIGH_PRIORITY_MESSAGE_REASONS.has(input.reason) ? "high" : "normal";
  const result = await pool.query(
    `insert into message_reports(reporter_id, message_id, conversation_id, reported_user_id, reason, description, priority)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, reporter_id as "reporterId", message_id as "messageId", conversation_id as "conversationId",
               reported_user_id as "reportedUserId", reason, description, status, priority, created_at as "createdAt"`,
    [reporterId, row.id, row.conversationId, row.senderId, input.reason, input.description ?? null, priority]
  );
  const report = result.rows[0];
  await notifyAdmins(
    { type: "report_submitted", templateKey: "notifications.reportSubmitted", params: { reason: input.reason } },
    ["admin", "moderator"]
  );
  return report;
}
