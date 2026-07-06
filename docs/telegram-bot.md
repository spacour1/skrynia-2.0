# Telegram bot notifications

SKRYNIA can deliver notifications (order events, disputes, payouts, security alerts, chat
messages, admin alerts) over Telegram in addition to email. A user opts in by linking
their Telegram account via a bot deep link; delivery then respects the same
`notification_preferences` row used for email (`emailEnabled` / `telegramEnabled`).

## How linking works

1. Frontend calls `POST /users/me/telegram/connect` — backend generates a short random
   token and stores it on `telegram_accounts.connect_token` (replacing any previous
   unconsumed token for that user).
2. The response includes a `link` of the form
   `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<token>`, which the frontend opens in a new
   tab.
3. The user taps "Start" in Telegram, which sends `/start <token>` to the bot.
4. Telegram calls our webhook (`POST /telegram/webhook`) with that message. The webhook
   consumes the token, sets `telegram_accounts.chat_id`/`connected_at`, and replies in the
   chat with a confirmation message (plus a "Notification settings" button).
5. From then on, `getTelegramChatId(userId)` resolves a connected chat, and background
   delivery sends notifications there (subject to `telegramEnabled`).

Disconnecting (`POST /users/me/telegram/disconnect`) deletes the `telegram_accounts` row.
A confirmation is still emailed (not Telegrammed, obviously — the link is already gone).

### Bot commands

- `/start <token>` — completes the link above. Replies differ by outcome:
  - fresh token → connected greeting + settings button.
  - token already used and this chat is the one it belongs to → "already connected".
  - unknown/expired token → "invalid or expired, get a new one from settings".
- `/start` (no token) / `/help` — shows the command list.
- `/settings` — sends a "Notification settings" button linking to `FRONTEND_URL/settings`.

Anything else is acknowledged with a bare `200 OK` and ignored — the webhook **always**
returns HTTP 200 (even for a malformed body or wrong secret) so Telegram doesn't treat it
as a delivery failure and retry-storm it.

## Required environment variables

```
TELEGRAM_BOT_TOKEN=123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
TELEGRAM_BOT_USERNAME=skrynia_bot
TELEGRAM_WEBHOOK_SECRET=<random string>
FRONTEND_URL=https://skrynia.com.ua
PUBLIC_BACKEND_URL=https://api.skrynia.com.ua
```

- `TELEGRAM_BOT_TOKEN` — only ever read on the backend (`sendTelegramMessage`,
  `common/telegram-bot.ts`); never sent to the frontend or logged.
- `TELEGRAM_BOT_USERNAME` — used to build the `t.me/<username>?start=...` deep link.
- `TELEGRAM_WEBHOOK_SECRET` — Telegram echoes this back on every webhook call in the
  `x-telegram-bot-api-secret-token` header; the webhook rejects (silently, with a bare
  200) any request where it doesn't match.
- All three are `optional()` in `config/env.ts` — if `TELEGRAM_BOT_TOKEN` is unset,
  `sendTelegramMessage` logs a warning and no-ops instead of failing whatever business
  action queued the notification. Telegram is always a best-effort secondary channel.

## Creating the bot in BotFather

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`.
2. Pick a display name and a `_bot`-suffixed username — the username is
   `TELEGRAM_BOT_USERNAME`.
3. BotFather replies with the bot token — this is `TELEGRAM_BOT_TOKEN`. Treat it like a
   password; anyone with it can send messages as your bot and read webhook updates.
4. Optional: `/setdescription`, `/setuserpic` to make the bot recognizable before users
   link it.

## Setting the webhook in production

Telegram pushes updates to whatever URL you register — there's no polling in this setup.

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "'"$PUBLIC_BACKEND_URL"'/telegram/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'"
  }'
```

A successful response looks like `{"ok":true,"result":true,"description":"Webhook was set"}`.
Verify it any time with:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Check `url` matches, `last_error_message` is empty, and `pending_update_count` isn't
climbing (a climbing count usually means the webhook is erroring or timing out).

## Testing locally

Telegram can't reach `localhost`, so local testing needs a tunnel:

1. `ngrok http 4000` (or any tunnel to your backend port) to get a public HTTPS URL.
2. Run the `setWebhook` command above with `PUBLIC_BACKEND_URL` set to the tunnel URL.
3. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` in your
   local `.env`.
4. In the app, go to Settings → Notifications → "Connect Telegram", follow the deep link,
   tap Start in Telegram.
5. Trigger any notification (e.g. place a test order) and confirm it arrives in the chat.
6. When done, either leave the webhook pointed at the tunnel or clear it:
   `curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"`.

Without a tunnel, you can still exercise the connect flow's HTTP surface directly: call
`POST /users/me/telegram/connect`, then simulate the webhook yourself with `curl -X POST
$PUBLIC_BACKEND_URL/telegram/webhook -H "x-telegram-bot-api-secret-token:
$TELEGRAM_WEBHOOK_SECRET" -d '{"message":{"text":"/start <token>","chat":{"id":12345}}}'`.

## Verifying the bot is connected

- `GET /users/me` returns `telegramConnected: true/false`.
- Settings page shows a green "Connected" badge with a Disconnect link, or a "Connect
  Telegram" button.
- Backend: `select chat_id, connected_at from telegram_accounts where user_id = '...'`.

## Message format

Notifications render as:

```
<b>{title}</b>
{body}

Order: #{shortOrderId}
Status: {status}
```

The `Order:`/`Status:` block only appears when the notification carries an `orderId`
(most order/dispute/payout-adjacent events do). `{shortOrderId}` is the first 8 characters
of the order UUID — enough to cross-reference in the admin panel, short enough to read on
a phone. Titles/bodies are localized in the recipient's `preferred_locale` at send time
(not at enqueue time), since the actor who triggered the event may use a different
language than the recipient.

Every message that carries an `orderId`, `conversationId`, or is an admin/security event
gets one contextual inline button (`Open order`, `Open chat`, `Open dispute`, `Open
wallet`, `Open admin panel`, or `Notification settings`), all pointing at `FRONTEND_URL`.

User-generated content (chat previews, report reasons, dispute reasons) is HTML-escaped
before being interpolated into the Telegram message — Telegram's `parse_mode: "HTML"`
would otherwise interpret raw `<`/`>` from a message body as markup.

## Delivery pipeline

`createNotification()` (`modules/notifications/notifications.service.ts`) is the single
entry point every business flow calls. It writes the `notifications` row (for the in-app
bell) and enqueues a `notification_delivery` BullMQ job carrying the recipient, the i18n
template keys, and enough context (`orderId`/`conversationId`/`type`) for the worker to
render the Telegram-specific extras above. The worker (`modules/jobs/queue.ts`) then:

1. Loads the recipient's `preferred_locale` and notification preferences.
2. Sends email if `emailEnabled`.
3. Sends Telegram if `telegramEnabled` **and** the user has a linked `chat_id`. No linked
   chat is not an error — it's silently skipped.
4. Either channel failing (e.g. Telegram API down, Resend rejecting) is logged and does
   **not** throw — the job completes successfully so BullMQ doesn't retry a
   half-delivered notification forever. A hard failure inside `createNotification` itself
   (the DB insert) is the only thing that can fail the calling business action, and that's
   a pre-existing, unrelated failure mode (same as any other DB write).

The job name is `notification_delivery`; the worker also still accepts the historical
`email_notification` name so any already-scheduled/repeatable job from before this change
keeps being processed after a deploy, rather than being silently dropped.

## Known failure modes

- **`TELEGRAM_BOT_TOKEN` unset**: every send logs `telegram_message_not_sent_bot_unconfigured`
  and no-ops. Nothing breaks, Telegram just never delivers.
- **`TELEGRAM_BOT_USERNAME` unset**: `POST /users/me/telegram/connect` returns a 400
  ("Telegram notifications are not configured on this server") since there's no deep link
  to build.
- **Wrong/missing `TELEGRAM_WEBHOOK_SECRET` header**: webhook returns 200 immediately
  without processing the update — check `x-telegram-bot-api-secret-token` on the incoming
  request if `/start` isn't linking anything.
- **Webhook not set / wrong URL**: `getWebhookInfo` shows a stale `url` or a nonzero
  `last_error_message`. Re-run `setWebhook`.
- **User taps an old link twice**: handled explicitly — second tap gets "already
  connected" instead of silently doing nothing.
- **Telegram API times out or 4xx/5xx's**: `sendTelegramMessage` has a 10s timeout,
  catches and logs the error, returns `false`. The notification is still recorded in the
  DB and still emailed if enabled.
- **Redis/BullMQ unreachable**: `enqueueJob` logs `job_queue_unavailable` and returns
  `null` — the notification row is still created (visible in-app), but no email/Telegram
  delivery happens for it until the queue is back and a new event fires.
