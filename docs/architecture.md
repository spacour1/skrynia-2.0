# Architecture

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, Express 4, TypeScript 5 (ESM) |
| Frontend | Next.js 14 App Router, React 18, Tailwind CSS |
| Database | PostgreSQL 16 |
| Cache / queues | Redis 7, BullMQ 5 |
| Auth | JWT (access + refresh tokens in httpOnly cookies, CSRF token in readable cookie) |
| File storage | Local disk (dev) or S3-compatible (prod) |
| Email | Resend HTTP API (not SMTP) |
| SMS / phone OTP | Twilio Verify |
| Notifications | Resend (email) + Telegram Bot API |
| 2FA | TOTP/RFC 6238 (hand-rolled, no external dep) |
| Migrations | node-pg-migrate, SQL format, numeric timestamp filenames |
| Tests | Vitest (backend) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

## Repository layout

```
New project/
├── backend/
│   ├── migrations/          # SQL migration files (numeric timestamp prefix)
│   ├── src/
│   │   ├── app.ts           # Express app setup, routes mounted here
│   │   ├── server.ts        # HTTP + WebSocket server entry point
│   │   ├── common/
│   │   │   ├── cookies.ts   # setAuthCookies, clearAuthCookies, cookie names
│   │   │   ├── errors.ts    # ApiError, asyncHandler, badRequest, forbidden, notFound
│   │   │   ├── logger.ts    # pino logger
│   │   │   ├── mailer.ts    # Resend email (sendEmail, renderBrandedEmail)
│   │   │   ├── redis.ts     # ioredis client (getRedis)
│   │   │   ├── sms.ts       # Twilio Verify OTP
│   │   │   ├── telegram-bot.ts  # sendTelegramMessage, buildTelegramConnectLink
│   │   │   ├── types.ts     # Role type, AuthedRequest
│   │   │   └── middleware/
│   │   │       ├── auth.ts      # authenticate (JWT cookie → req.user)
│   │   │       ├── csrf.ts      # csrfProtection (double-submit cookie)
│   │   │       ├── rbac.ts      # requireRole(...roles)
│   │   │       └── security.ts  # authRateLimit, helmet
│   │   ├── config/env.ts    # Zod-validated env vars (fails on startup if invalid)
│   │   ├── db/
│   │   │   ├── pool.ts      # pg Pool, inTx() transaction helper, DbClient type
│   │   │   └── seed.ts      # demo data (dev/test only)
│   │   └── modules/
│   │       ├── auth/        # login, register, refresh, logout, 2FA, password reset, Telegram login
│   │       ├── chat/        # WebSocket service, chat.service.ts (messages + system messages)
│   │       ├── disputes/    # dispute open/resolve
│   │       ├── jobs/        # BullMQ worker + recurring jobs (auto-release, reconciliation)
│   │       ├── marketplace/ # product CRUD + search
│   │       ├── notifications/ # preferences.service.ts, telegram-webhook.routes.ts
│   │       ├── orders/      # order lifecycle, accounting.service.ts
│   │       ├── payments/    # LiqPay, Monobank, WayForPay, manual transfer webhooks
│   │       ├── admin/       # admin + moderator routes (users, reports, payouts, ledger, reconciliation)
│   │       └── users/       # profile, wallet, telegram-link, phone-verification
│   └── package.json
├── frontend/
│   ├── app/                 # Next.js App Router pages
│   │   ├── admin/           # Admin panel (admin + moderator)
│   │   ├── dashboard/       # User dashboard
│   │   ├── login/           # Login + 2FA step
│   │   ├── settings/        # Profile, 2FA, notifications, Telegram connect
│   │   └── wallet/          # Wallet top-up and withdrawal
│   ├── components/          # Shared components (Nav, ChatPanel, RequireAuth, etc.)
│   ├── lib/
│   │   ├── api.ts           # apiFetch wrapper, User/Role types
│   │   ├── auth-store.ts    # Zustand auth state
│   │   └── i18n.ts          # Translation strings (Ukrainian)
│   └── package.json
├── docs/                    # This directory
├── docker-compose.dev.yml
├── CLAUDE.md
└── AGENTS.md
```

## Auth flow

```
POST /auth/login
  → password OK, no 2FA  → issueSession() → httpOnly access+refresh cookies
  → password OK, has 2FA → issueTwoFactorPendingToken() → { twoFactorRequired, twoFactorToken }

POST /auth/2fa/verify (CSRF-exempt, no session yet)
  → verifyTwoFactorPendingToken() + verifyTwoFactorCode() → issueSession() → cookies

POST /auth/refresh
  → refresh cookie → new access+refresh pair (rotation enabled by default)
```

Access token: 15 min JWT in httpOnly cookie. Refresh token: 90-day JWT in httpOnly cookie, hash stored in Redis. CSRF: double-submit cookie (`X-CSRF-Token` header must match `csrf_token` cookie).

## Order / escrow state machine

```
created
  └─→ paid (payment webhook confirms hold)
        └─→ in_progress (seller starts)
              └─→ delivered (seller marks delivered)
                    └─→ completed (buyer confirms OR auto-release after 72 h)
                    └─→ disputed
                          └─→ resolved → completed or refunded

Any state → canceled (before payment)
```

Each transition posts a system message to the order's chat conversation.

## Double-entry ledger

Every money movement posts to `ledger_entries` / `ledger_lines`. Entries are immutable (DB trigger). The four standard account codes:

| Code pattern | Type | Meaning |
|---|---|---|
| `asset:provider-clearing:{currency}` | asset | Money held at payment provider |
| `liability:seller-escrow:{currency}:{sellerId}` | liability | Buyer-paid funds in escrow for this seller |
| `liability:user-payable:{currency}:{userId}` | liability | Wallet balance owed to user |
| `revenue:platform-fee:{currency}` | revenue | Platform commission earned |

Payment capture: debit provider-clearing, credit seller-escrow.
Escrow release: debit seller-escrow, credit user-payable (net) + credit platform-fee.
Refund: debit seller-escrow, credit buyer user-payable.

All helpers live in `orders/accounting.service.ts`. Manual adjustments use `equity:manual-adjustment:{currency}`.

## Job queue (BullMQ)

Worker runs in the same backend process when `JOB_WORKER_ENABLED=true`. Job names:

| Job | Trigger | Effect |
|-----|---------|--------|
| `auto_release_order` | Scheduled at order creation (+72 h) | Releases escrow if still `delivered` |
| `email_notification` | Enqueued by `notifications.service.ts` | Sends email via Resend + Telegram DM |
| `reconciliation_daily` | Cron 03:00 UTC | Snapshots ledger, alerts admins on mismatch |

## Transactional domain outbox

Business transactions enqueue durable rows in `domain_outbox`; they do not wait for
Redis, WebSocket, email, Telegram, or BullMQ. The PostgreSQL worker claims batches with
`FOR UPDATE SKIP LOCKED`, processes them concurrently, retries with exponential backoff,
and moves exhausted events to `failed`.

`event_key` is unique for producer idempotency. Notifications also carry a unique
`event_key`, and their BullMQ delivery uses a stable hashed job ID, so retrying an event
does not create a second notification. Failed events can be reset through
`POST /admin/outbox/retry`.

The worker runs when `OUTBOX_WORKER_ENABLED=true`. Multiple replicas are safe; a heartbeat
keeps a live claim from being reclaimed, while stale claims become available after
`OUTBOX_LOCK_TIMEOUT_MS`.

## Environment variables

Required in all environments:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — min 24 chars (must not be the dev default in production)

Optional but needed for full functionality:
- `REDIS_URL` — BullMQ + session storage (sessions degraded without Redis)
- `RESEND_API_KEY` + `EMAIL_FROM` — email delivery
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` — notification bot
- `TELEGRAM_WEBHOOK_SECRET` — webhook signature verification
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_VERIFY_SERVICE_SID` — phone OTP
- `SENTRY_DSN` — error tracking
- `OUTBOX_WORKER_ENABLED` — durable side-effect worker (defaults to `JOB_WORKER_ENABLED`)

Payment providers (at least one required in production):
- `LIQPAY_PUBLIC_KEY` + `LIQPAY_PRIVATE_KEY`
- `MONOBANK_TOKEN`
- `WAYFORPAY_MERCHANT_ACCOUNT` + `WAYFORPAY_MERCHANT_SECRET_KEY`
- `MANUAL_PAYMENT_CARD_NUMBER` + `MANUAL_PAYMENT_RECEIVER_NAME` + `MANUAL_PAYMENT_BANK`

Storage:
- `STORAGE_DRIVER` — `local` (default) or `s3`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`

Tuning:
- `PLATFORM_FEE_BPS` — fee in basis points, default `1000` (10%)
- `AUTO_RELEASE_HOURS` — escrow auto-release timeout, default `72`
- `ACCESS_TOKEN_TTL_MIN` — default `15`
- `REFRESH_TOKEN_TTL_DAYS` — default `90`
- `OUTBOX_BATCH_SIZE`, `OUTBOX_CONCURRENCY`, `OUTBOX_POLL_INTERVAL_MS` — outbox throughput
- `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BASE_BACKOFF_MS`, `OUTBOX_LOCK_TIMEOUT_MS` — retry and claim policy

## WebSocket

Single WS endpoint at `/ws`. After connection, clients send `{ type: "auth", token: "..." }` (CSRF token). Server routes messages to conversation rooms. `broadcastConversation(conversationId, message)` sends to all room members. Used for real-time chat and system messages.

## Roles and permissions

| Route group | user | moderator | admin |
|---|:---:|:---:|:---:|
| Own profile / orders / wallet | ✓ | ✓ | ✓ |
| `/admin` (users, reports, media) | — | ✓ | ✓ |
| `/admin` financial (transactions, ledger, payouts, reconciliation, manual adjustments) | — | — | ✓ |
