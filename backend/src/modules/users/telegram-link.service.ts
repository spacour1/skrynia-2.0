import { nanoid } from "nanoid";
import { pool } from "../../db/pool.js";
import { buildTelegramConnectLink, sendTelegramMessage } from "../../common/telegram-bot.js";
import { badRequest } from "../../common/errors.js";
import { normalizeLocale } from "../../i18n/config.js";
import { t } from "../../i18n/t.js";

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

/** Called from the bot webhook when a user sends /start <token> - links their chat_id. */
export async function consumeTelegramConnectToken(token: string, chatId: string) {
  const result = await pool.query<{ userId: string }>(
    `update telegram_accounts
     set chat_id = $2, connected_at = now(), connect_token = null
     where connect_token = $1
     returning user_id as "userId"`,
    [token, chatId]
  );
  const userId = result.rows[0]?.userId;
  if (userId) {
    const localeResult = await pool.query<{ preferredLocale: string }>(
      `select preferred_locale as "preferredLocale" from users where id = $1`,
      [userId]
    );
    const locale = normalizeLocale(localeResult.rows[0]?.preferredLocale);
    await sendTelegramMessage(chatId, t(locale, "telegram.connectedGreeting"));
  }
  return userId ?? null;
}

export async function getTelegramChatId(userId: string): Promise<string | null> {
  const result = await pool.query<{ chatId: string | null }>(
    `select chat_id as "chatId" from telegram_accounts where user_id = $1 and connected_at is not null`,
    [userId]
  );
  return result.rows[0]?.chatId ?? null;
}

export async function disconnectTelegram(userId: string) {
  await pool.query(`delete from telegram_accounts where user_id = $1`, [userId]);
}
