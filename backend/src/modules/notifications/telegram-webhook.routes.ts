import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../common/errors.js";
import { webhookRateLimit } from "../../common/middleware/security.js";
import { consumeTelegramConnectToken } from "../users/telegram-link.service.js";
import { logger } from "../../common/logger.js";

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
 * Telegram's webhook for the notification-linking bot. Only handles `/start <token>` (the
 * deep link from createTelegramConnectToken); everything else is acknowledged and ignored.
 * Telegram retries aggressively on non-2xx, so this always responds 200 even on a malformed
 * or irrelevant update.
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
    const chatId = parsed.success ? parsed.data.message?.chat.id : undefined;
    if (text?.startsWith("/start") && chatId !== undefined) {
      const token = text.split(" ")[1]?.trim();
      if (token) {
        try {
          await consumeTelegramConnectToken(token, String(chatId));
        } catch (error) {
          logger.warn({ error }, "telegram_webhook_connect_failed");
        }
      }
    }

    res.status(200).send("ok");
  })
);

export default router;
