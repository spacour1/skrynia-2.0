import { nanoid } from "nanoid";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { buildTelegramConnectLink, sendTelegramMessage } from "../../common/telegram-bot.js";
import { badRequest } from "../../common/errors.js";
import { normalizeLocale } from "../../i18n/config.js";
import { t } from "../../i18n/t.js";
import { createNotification } from "../notifications/notifications.service.js";

/**
 * Issues a fresh deep-link token for a user to connect their Telegram account for
 * notifications. Each call replaces any previous unconsumed token (and leaves an already
 * connected chat_id alone) rather than accumulating tokens forever.
 */
export async function createTelegramConnectToken(userId: string) {
  const token = nanoid(24);
  await pool.query(
    `insert into telegram_accounts(user_id, connect_token)
     values ($1, $2)
     on conflict (user_id) do update set connect_token = excluded.connect_token`,
    [userId, token]
  );
  const link = buildTelegramConnectLink(token);
  if (!link) throw badRequest("Telegram notifications are not configured on this server");
  return { token, link };
}

export type TelegramConnectOutcome = "connected" | "already_connected" | "invalid";

/**
 * Called from the bot webhook when a user sends /start <token> - links their chat_id.
 * Distinguishes a fresh connection from an already-used/expired token (including the case
 * where this exact chat is already connected, e.g. the user tapped a stale link a second
 * time) so the webhook can reply with the right message instead of going silent.
 */
export async function consumeTelegramConnectToken(token: string, chatId: string): Promise<TelegramConnectOutcome> {
  const result = await pool.query<{ userId: string }>(
    `update telegram_accounts
     set chat_id = $2, connected_at = now(), connect_token = null
     where connect_token = $1
     returning user_id as "userId"`,
    [token, chatId]
  );
  const userId = result.rows[0]?.userId;
  if (!userId) {
    const existing = await pool.query(
      `select 1 from telegram_accounts where chat_id = $1 and connected_at is not null`,
      [chatId]
    );
    return existing.rows[0] ? "already_connected" : "invalid";
  }

  const localeResult = await pool.query<{ preferredLocale: string }>(
    `select preferred_locale as "preferredLocale" from users where id = $1`,
    [userId]
  );
  const locale = normalizeLocale(localeResult.rows[0]?.preferredLocale);
  await sendTelegramMessage(chatId, t(locale, "telegram.connectedGreeting"), {
    buttons: [{ text: t(locale, "telegram.buttons.settings"), url: `${env.FRONTEND_URL}/settings` }]
  });
  // The greeting above already confirms the connection on Telegram itself, so skip a
  // duplicate queued Telegram message for this notification — only its email leg fires.
  await createNotification({
    userId,
    type: "telegram_connected",
    templateKey: "notifications.telegramConnected",
    skipTelegram: true
  });
  return "connected";
}

export async function getTelegramChatId(userId: string): Promise<string | null> {
  const result = await pool.query<{ chatId: string | null }>(
    `select chat_id as "chatId" from telegram_accounts where user_id = $1 and connected_at is not null`,
    [userId]
  );
  return result.rows[0]?.chatId ?? null;
}

/** Resolves the connected user's language for bot replies (/help, /settings, etc); falls back to the default locale for unlinked chats. */
export async function getPreferredLocaleByChatId(chatId: string) {
  const result = await pool.query<{ preferredLocale: string }>(
    `select u.preferred_locale as "preferredLocale"
     from telegram_accounts ta
     join users u on u.id = ta.user_id
     where ta.chat_id = $1 and ta.connected_at is not null`,
    [chatId]
  );
  return normalizeLocale(result.rows[0]?.preferredLocale);
}

export async function disconnectTelegram(userId: string) {
  await pool.query(`delete from telegram_accounts where user_id = $1`, [userId]);
  // The row (and its chat_id) is already gone, so this notification's Telegram leg
  // naturally no-ops in the delivery job — only email confirms the disconnect.
  await createNotification({
    userId,
    type: "telegram_disconnected",
    templateKey: "notifications.telegramDisconnected"
  });
}
