import type { DbClient } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { defaultLocale } from "../../i18n/config.js";
import { t, type TranslateParams } from "../../i18n/t.js";

export const SYSTEM_SENDER_DISPLAY_NAME = "\u0421\u0438\u0441\u0442\u0435\u043c\u0430";

export type SystemMessage = {
  id: string;
  conversationId: string;
  senderId: null;
  senderDisplayName: string;
  body: string;
  attachmentUrl: null;
  createdAt: string;
  kind: "system";
  systemType: string;
  metadata: Record<string, unknown>;
};

export async function createSystemMessage(
  input: {
    conversationId: string;
    type: string;
    bodyKey: string;
    params?: TranslateParams;
    metadata?: Record<string, unknown>;
  },
  client: DbClient = pool
): Promise<SystemMessage> {
  const body = t(defaultLocale, input.bodyKey, input.params);
  const metadata = {
    ...(input.metadata ?? {}),
    bodyKey: input.bodyKey,
    ...(input.params ? { params: input.params } : {})
  };
  const result = await client.query(
    `insert into messages(conversation_id, sender_id, kind, system_type, body, metadata)
     values ($1, null, 'system', $2, $3, $4)
     returning id, conversation_id as "conversationId", sender_id as "senderId",
               $5::text as "senderDisplayName",
               body, attachment_url as "attachmentUrl", created_at as "createdAt",
               kind, system_type as "systemType", metadata`,
    [
      input.conversationId,
      input.type,
      body,
      JSON.stringify(metadata),
      SYSTEM_SENDER_DISPLAY_NAME
    ]
  );
  return result.rows[0] as SystemMessage;
}

export async function getConversationIdForOrder(
  orderId: string,
  client: DbClient = pool
): Promise<string | null> {
  const result = await client.query(`select id from conversations where order_id = $1`, [orderId]);
  return result.rows[0]?.id ?? null;
}

export async function createOrderSystemMessage(
  input: {
    orderId: string;
    type: string;
    bodyKey: string;
    params?: TranslateParams;
    metadata?: Record<string, unknown>;
  },
  client: DbClient = pool
): Promise<SystemMessage | null> {
  const conversationId = await getConversationIdForOrder(input.orderId, client);
  if (!conversationId) return null;
  return createSystemMessage(
    {
      conversationId,
      type: input.type,
      bodyKey: input.bodyKey,
      params: input.params,
      metadata: input.metadata
    },
    client
  );
}
