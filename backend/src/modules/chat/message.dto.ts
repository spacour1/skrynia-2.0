import type { MessageKind, Role } from "../../domain/enums.js";
import { toIsoDate, toNullableIsoDate, type DbDate } from "../../common/dto.js";

const storageObjectIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function buildOwnedPrivateMediaUrl(
  storageObjectId: string | null | undefined
): string | null {
  if (!storageObjectId || !storageObjectIdPattern.test(storageObjectId)) return null;
  return `/api/storage/private/${storageObjectId}`;
}

export type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string | null;
  clientMessageId?: string | null;
  senderDisplayName: string;
  body: string;
  attachmentUrl?: string | null;
  attachmentStorageObjectId?: string | null;
  createdAt: DbDate;
  hidden?: boolean;
  kind?: MessageKind;
  systemType?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type DisputeMessageRow = {
  id: string;
  disputeId: string;
  authorId: string;
  authorDisplayName: string;
  authorRole: Role;
  body: string;
  attachmentUrl?: string | null;
  attachmentStorageObjectId?: string | null;
  hiddenAt?: DbDate | null;
  hiddenBy?: string | null;
  moderationReason?: string | null;
  createdAt: DbDate;
};

function mapSystemMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!metadata) return null;
  const result: Record<string, unknown> = {};
  if (typeof metadata.bodyKey === "string") {
    result.bodyKey = metadata.bodyKey;
  }
  if (
    metadata.params &&
    typeof metadata.params === "object" &&
    !Array.isArray(metadata.params)
  ) {
    result.params = { ...(metadata.params as Record<string, unknown>) };
  }
  return Object.keys(result).length ? result : null;
}

export function mapMessageDto(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    clientMessageId: row.clientMessageId ?? null,
    senderDisplayName: row.senderDisplayName,
    body: row.body,
    // Private media is addressable only through an owned storage row. Historical
    // free-form URLs without that binding fail closed instead of bypassing auth.
    attachmentUrl: buildOwnedPrivateMediaUrl(row.attachmentStorageObjectId),
    createdAt: toIsoDate(row.createdAt),
    hidden: row.hidden ?? false,
    kind: row.kind ?? "user",
    systemType: row.systemType ?? null,
    metadata: mapSystemMetadata(row.metadata)
  };
}

function mapDisputeMessageBase(row: DisputeMessageRow) {
  return {
    id: row.id,
    disputeId: row.disputeId,
    authorId: row.authorId,
    authorDisplayName: row.authorDisplayName,
    authorRole: row.authorRole,
    body: row.body,
    attachmentUrl: buildOwnedPrivateMediaUrl(row.attachmentStorageObjectId),
    createdAt: toIsoDate(row.createdAt)
  };
}

export function mapDisputeMessageDto(row: DisputeMessageRow) {
  return mapDisputeMessageBase(row);
}

export function mapAdminDisputeMessageDto(row: DisputeMessageRow) {
  return {
    ...mapDisputeMessageBase(row),
    hiddenAt: toNullableIsoDate(row.hiddenAt),
    hiddenBy: row.hiddenBy ?? null,
    moderationReason: row.moderationReason ?? null
  };
}
