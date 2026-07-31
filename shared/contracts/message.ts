import type { IsoDateString } from "./common.js";
import type { MessageKind, Role } from "./enums.js";

export type MessageDto = {
  id: string;
  conversationId: string;
  clientMessageId: string | null;
  senderId: string | null;
  senderDisplayName: string;
  kind: MessageKind;
  systemType: string | null;
  body: string;
  attachmentUrl: string | null;
  createdAt: IsoDateString;
  hidden: boolean;
  metadata: Record<string, unknown> | null;
};

export type DisputeMessageDto = {
  id: string;
  disputeId: string;
  authorId: string;
  authorDisplayName: string;
  authorRole: Role;
  body: string;
  attachmentUrl: string | null;
  createdAt: IsoDateString;
};

export type AdminDisputeMessageDto = DisputeMessageDto & {
  hiddenAt: IsoDateString | null;
  hiddenBy: string | null;
  moderationReason: string | null;
};
