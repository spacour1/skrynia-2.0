# Email verification

Registration creates an account that can log in immediately, but a real-email account
stays in an **unverified** state until the user clicks the link in their confirmation
email. Unverified accounts can browse, but cannot perform marketplace actions that move
money or contact other users (see "Gated actions" below).

Telegram-only accounts (no real email address, `tg_<id>@telegram.local`) are treated as
verified automatically — there is no inbox to confirm.

## How the flow works

1. `POST /auth/register` creates the user + wallet, then creates a one-time verification
   token and fires off the confirmation email in the background (it never blocks or
   fails the registration response, even if SMTP is slow/down).
2. The email contains a link to `FRONTEND_URL/verify-email?token=...`. The page requires
   a click on "Confirm email" before it calls the API — it does **not** auto-confirm on
   page load, so an email client's link-prefetch/security-scanner can't burn the token
   before the real recipient gets to it.
3. `POST /auth/verify-email/confirm` consumes the token (one-time use) and sets
   `users.email_verified_at`.
4. `GET /auth/me` / `GET /users/me` / login / register / refresh / Telegram login all
   return a computed `emailVerified` boolean:
   `email_verified_at is not null or telegram_id is not null`.
5. A site-wide banner (dismissible per session) and a card in Settings let the user
   resend the email at any point via `POST /auth/verify-email/request`.

## Token storage

Tokens are stored in **Redis** (`email_verify:<sha256(token)>` → userId, 24h TTL) — the
raw token is never persisted, only its hash, and `consume` deletes the key so it can't be
replayed. If Redis is unreachable, the affected endpoints return a clear
"Sessions are unavailable right now" error instead of silently failing.

This is intentionally the same lightweight pattern already used for refresh tokens and
sessions elsewhere in the codebase. A dedicated `email_verification_tokens` table would
be more durable (survives a Redis flush, queryable for audit) but isn't needed while
Redis is already a hard dependency for sessions.

## Required env vars

```
RESEND_API_KEY=
EMAIL_FROM=SKRYNIA <no-reply@skrynia.com.ua>
```

Mail is sent over [Resend](https://resend.com)'s HTTPS API, not SMTP. Most PaaS hosts
(Railway included) block outbound SMTP ports (25/465/587) at the network level, which
makes any SMTP provider — Gmail or otherwise — silently time out regardless of how
correct the credentials are. Resend's API runs over plain HTTPS (443), which isn't
blocked.

- **Missing in development/test**: the server starts normally; `sendEmail` logs
  `email_not_sent_resend_unconfigured` and resolves `false` instead of sending. Register
  and `/auth/verify-email/request` both still respond with the link itself
  (`debugVerificationUrl`) so you can copy-paste it without an inbox.
- **Missing in production**: the server still starts (a `console.warn` is logged at
  boot), so a half-configured deploy doesn't go down — but
  `POST /auth/verify-email/request` returns a real error instead of a fake "sent", since
  that's an explicit user action waiting on an email. Registration itself still never
  fails because of this — the account exists either way, it just won't have gotten an
  email.

## Setting up Resend

1. Sign up at [resend.com](https://resend.com) (free tier covers low-volume
   transactional mail).
2. Create an API key, set it as `RESEND_API_KEY`.
3. Without a verified sending domain, you can still send from `onboarding@resend.dev` —
   set `EMAIL_FROM=SKRYNIA <onboarding@resend.dev>` to get mail working immediately.
4. To send from your own domain (e.g. `no-reply@skrynia.com.ua`), verify it in Resend's
   dashboard (adds a few DNS TXT/CNAME records for SPF/DKIM), then update `EMAIL_FROM`.

## Testing locally without Resend

1. Leave `RESEND_API_KEY` unset.
2. Register a user — the response includes `debugVerificationUrl` (dev/test only).
3. Open that URL, click "Confirm email".
4. Check `GET /auth/me` — `emailVerified` should now be `true`.

Resending also works the same way: `POST /auth/verify-email/request` (authenticated)
returns `{ status: "sent", debugVerificationUrl }` outside production.

## Endpoints

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /auth/register` | none | Always succeeds even if the email send fails; includes `debugVerificationUrl` outside production. |
| `POST /auth/verify-email/request` | cookie | Rate-limited (see below). Returns `{ status: "already_verified" }` if nothing to do. In production, surfaces a real error if Resend is broken/unconfigured. |
| `POST /auth/verify-email/confirm` | none (token-based) | Body `{ token }`. One-time use, 24h TTL. CSRF-exempt (no session cookie exists yet when the link is opened in a fresh tab). |
| `GET /auth/me` / `GET /users/me` | cookie | Both include `emailVerified`. |
| `POST /auth/password/forgot` / `POST /auth/password/reset` | none | Unrelated to email verification, but share the same Redis-token pattern. Never reveal whether an email is registered. |

## Resend rate limiting

Per user, backed by Redis counters in `verification.service.ts`:

- No more than **1 request per 60 seconds**.
- No more than **5 requests per rolling hour**.

If Redis is down, this limiter is skipped (token creation itself will already fail with
a clear error in that case, so requests don't silently succeed unlimited).

## Gated actions (`requireEmailVerified`)

`backend/src/common/middleware/require-email-verified.ts` runs after `authenticate` and
checks the same `emailVerified` flag already attached to `req.user`. On failure it throws
`403 { code: "email_not_verified" }`.

Applied to:

- Creating a listing — `POST /marketplace/products`
- Order lifecycle — `POST /orders`, `/:id/start`, `/:id/deliver`, `/:id/confirm`, `/:id/review`
- All buyer-initiated payment/checkout endpoints — `POST /payments/orders/:orderId/pay`
  and the LiqPay/Monobank/WayForPay checkout routes, for both order payments and wallet top-ups
- `POST /users/me/wallet/withdraw`
- Starting a chat — `POST /chat/sellers/:sellerId/start`, `POST /chat/products/:productId/start`
- Sending a chat message — `POST /chat/conversations/:conversationId/messages`, and the
  WebSocket `{ type: "message" }` frame (checked in `ws.service.ts`'s `authenticateSocket`)
- Opening a dispute — `POST /disputes/orders/:orderId/dispute`

**Not** applied to: any `GET` endpoint, login/register/refresh/logout,
`verify-email/request`/`confirm`, password forgot/reset, or profile editing
(`PATCH /users/me`) — an unverified user must still be able to fix a typo'd email or
view their own settings.

The frontend never shows the raw `email_not_verified` error text: `apiFetch` exposes
`isEmailNotVerifiedError()` (`frontend/lib/api.ts`), and the buy/create-listing/chat/wallet
forms render `<EmailNotVerifiedNotice />` (a friendly message + resend button) instead.

## What to check in production

1. Register a real account and confirm the email actually arrives (not just logged).
2. Hit `POST /auth/verify-email/request` once — confirm it returns `{ status: "sent" }`
   without an error.
3. Temporarily break `RESEND_API_KEY` and confirm `/auth/verify-email/request` now returns
   an error (not a fake "sent") — then fix it back.
4. Confirm an unverified test account gets a 403 with `code: "email_not_verified"` when
   trying to create a listing, and that the UI shows the friendly notice, not raw JSON.

## If the email doesn't arrive

- Check spam/junk first.
- Check backend logs for `email_not_sent_resend_unconfigured` (`RESEND_API_KEY` missing)
  or a `verification_email_resend_failed` / `password_reset_email_failed` entry with the
  Resend API's error response (bad API key, unverified `EMAIL_FROM` domain, rate limit).
- Confirm `EMAIL_FROM`'s domain is verified in Resend, or fall back to
  `onboarding@resend.dev` while testing.
- As a fallback, an admin can manually verify an account by running
  `update users set email_verified_at = now() where email = '...'` — there's no UI for
  this today; it's a deliberate manual escape hatch, not a supported flow.
