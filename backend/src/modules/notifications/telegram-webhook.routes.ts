import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../common/errors.js";
import { webhookRateLimit } from "../../common/middleware/security.js";
import { consumeTelegramConnectToken, getPreferredLocaleByChatId } from "../users/telegram-link.service.js";
import { sendTelegramMessage } from "../../common/telegram-bot.js";
import { logger } from "../../common/logger.js";
import { t } from "../../i18n/t.js";

const router = Router();

const updateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.union([z.number(), z.string()]) })
    })
    .optional()
});

/**
 * Telegram's webhook for the notification-linking bot. Handles `/start <token>` (the deep
 * link from createTelegramConnectToken) plus `/help` and `/settings`; everything else is
 * acknowledged and ignored. Telegram retries aggressively on non-2xx, so this always
 * responds 200 even on a malformed or irrelevant update.
 */
router.post(
  "/webhook",
  webhookRateLimit,
  asyncHandler(async (req, res) => {
    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const provided = req.header("x-telegram-bot-api-secret-token");
      if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return res.status(200).send("ok");
    }

    const parsed = updateSchema.safeParse(req.body);
    const text = parsed.success ? parsed.data.message?.text : undefined;
    const chatId = parsed.success ? String(parsed.data.message?.chat.id ?? "") : "";

    if (text?.startsWith("/start") && chatId) {
      const token = text.split(" ")[1]?.trim();
      if (!token) {
        const locale = await getPreferredLocaleByChatId(chatId);
        await sendTelegramMessage(chatId, t(locale, "telegram.help"));
      } else {
        try {
          const outcome = await consumeTelegramConnectToken(token, chatId);
          // "connected" already got its greeting sent from inside consumeTelegramConnectToken.
          if (outcome === "already_connected") {
            const locale = await getPreferredLocaleByChatId(chatId);
            await sendTelegramMessage(chatId, t(locale, "telegram.alreadyConnected"));
          } else if (outcome === "invalid") {
            await sendTelegramMessage(chatId, t(await getPreferredLocaleByChatId(chatId), "telegram.invalidToken"));
          }
        } catch (error) {
          logger.warn({ error }, "telegram_webhook_connect_failed");
        }
      }
    } else if (text?.startsWith("/settings") && chatId) {
      const locale = await getPreferredLocaleByChatId(chatId);
      await sendTelegramMessage(chatId, t(locale, "telegram.settingsPrompt"), {
        buttons: [{ text: t(locale, "telegram.buttons.settings"), url: `${env.FRONTEND_URL}/settings` }]
      });
    } else if (text?.startsWith("/help") && chatId) {
      const locale = await getPreferredLocaleByChatId(chatId);
      await sendTelegramMessage(chatId, t(locale, "telegram.help"));
    }

    res.status(200).send("ok");
  })
);

export default router;
