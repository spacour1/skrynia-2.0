import { env } from "../config/env.js";
import { logger } from "./logger.js";

const TELEGRAM_API_TIMEOUT_MS = 10_000;

/**
 * Sends a plain text message through the Telegram Bot API. Mirrors mailer.sendEmail's
 * "warn and no-op when unconfigured" behavior rather than throwing, since Telegram delivery
 * is always a best-effort secondary channel alongside email.
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.warn({ chatId }, "telegram_message_not_sent_bot_unconfigured");
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Telegram API responded ${response.status}: ${body}`);
    }
    return true;
  } catch (error) {
    logger.warn({ error, chatId }, "telegram_message_send_failed");
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildTelegramConnectLink(connectToken: string): string | null {
  if (!env.TELEGRAM_BOT_USERNAME) return null;
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${connectToken}`;
}
