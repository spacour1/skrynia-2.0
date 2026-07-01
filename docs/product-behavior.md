# Product Behavior

Rules that define how SKRYNIA works from a user perspective. These are invariants — changing them changes the product, not just the code.

## Order lifecycle

### Creation
- Buyer selects a product and creates an order. A chat conversation is created atomically in the same DB transaction.
- Order starts in `created` status.
- System message `order_created` is posted to the chat.

### Payment
- Buyer initiates payment via a supported provider (LiqPay, Monobank, WayForPay, manual transfer).
- Payment is a **hold**, not a capture to the seller. Funds move to `provider-clearing` in the ledger.
- On provider webhook confirmation: order status → `paid`, system message `payment_received`.
- Webhooks are idempotent — a second callback for the same order does nothing.

### Seller starts work
- Seller marks the order as started: status → `in_progress`, system message `seller_started`.

### Delivery
- Seller marks delivered: status → `delivered`, system message `delivery_sent`.
- Auto-release timer starts: if the buyer does not confirm or open a dispute within `AUTO_RELEASE_HOURS` (default 72), the escrow releases automatically.

### Buyer confirms
- Buyer confirms receipt: escrow releases.
- Platform fee is deducted: `fee = ceil(amount * PLATFORM_FEE_BPS / 10000)`.
- Seller's wallet balance increases by `amount - fee` (cents).
- Status → `completed`, system message `escrow_released`.
- Ledger: debit seller-escrow, credit user-payable (net amount) + credit platform-fee.

### Auto-release
- BullMQ job fires after `AUTO_RELEASE_HOURS`.
- Checks order is still `delivered` before acting (idempotent).
- Same escrow-release flow as buyer confirmation.

### Dispute
- Either party can open a dispute while order is `delivered`.
- Status → `disputed`, system message `dispute_opened`.
- Admin or moderator resolves with a decision: `release` or `refund`.
  - `release`: escrow released to seller (fee still deducted). System messages: `dispute_resolved` + `escrow_released`.
  - `refund`: funds returned to buyer wallet. No platform fee taken. System messages: `dispute_resolved` + `refunded`.
- Ledger entry is posted in both cases.

### Cancellation
- Order can be canceled before payment (`created` status).
- No ledger entry (no money moved yet).

## Wallet

- Each user has one wallet per currency (currently UAH only).
- Balance is stored in integer cents. Never use floats.
- Wallet balance = sum of `liability:user-payable` credit lines minus debit lines in the ledger. The `wallets.balance_cents` column is a cached denormalization — always update it together with the ledger entry in the same transaction.
- Top-up: funds arrive via payment provider → wallet balance increases, ledger entry posted.
- Withdrawal: admin manually pays out → wallet balance decreases, ledger entry posted. Admin can reject a withdrawal (reversal entry posted).
- Manual adjustment (admin only): arbitrary increase or decrease for support purposes. Requires a reason string. Booked against `equity:manual-adjustment` account.

## Platform fee

- Configured via `PLATFORM_FEE_BPS` env var. Default: 1000 (= 10%).
- Calculated as `ceil(amountCents * PLATFORM_FEE_BPS / 10000)` using integer arithmetic.
- Only charged on successful escrow release. Not charged on refunds.
- Credited to `revenue:platform-fee` ledger account.

## Roles

**user** — default role for all registered accounts.
- Can buy and sell products.
- Can open disputes on their own orders.
- Can manage their own profile, wallet, 2FA, notification preferences.

**moderator** — elevated support role.
- Access to admin panel: user list, reports, media moderation.
- Can ban users, resolve disputes, view orders.
- Cannot access financial data: transactions, ledger, payouts, reconciliation, manual adjustments.

**admin** — full access.
- Everything moderator can do, plus all financial operations.
- Can manually adjust wallet balances (with reason).
- Can approve/reject payouts.
- Can trigger reconciliation and export CSV reports.
- Can assign moderator role to users.

## Notifications

Users receive notifications for order events (payment, delivery, dispute, resolution).

Two delivery channels, both configurable per-user:
- **Email** (via Resend). Sent if `notification_preferences.email_enabled = true` and user has an email address.
- **Telegram DM** (via Bot API). Sent if `notification_preferences.telegram_enabled = true` and user has connected a Telegram account via the bot deep-link flow.

Connecting Telegram for notifications is separate from Telegram login (Telegram login sets `users.telegram_id`; notification connect sets `telegram_accounts.chat_id`).

## 2FA

Users can enable TOTP-based two-factor authentication.

Setup flow:
1. `POST /me/2fa/setup` → returns `otpauthUri` (QR code) + `secret`.
2. User scans QR in authenticator app, enters 6-digit code.
3. `POST /me/2fa/enable { code }` → confirms the TOTP method, issues 8 backup codes, sets `users.two_factor_enabled = true`.

Login flow (when 2FA is enabled):
1. `POST /auth/login` with correct credentials → returns `{ twoFactorRequired: true, twoFactorToken }` (no session cookie yet).
2. `POST /auth/2fa/verify { twoFactorToken, code }` → verifies TOTP or backup code → issues session cookies.

Backup codes: 8 one-time codes in `XXXX-XXXX` format, bcrypt-hashed at rest. Each code can only be used once.

Disable: `POST /me/2fa/disable { currentPassword }` — requires password re-confirmation.

## Chat

- Each order has exactly one chat conversation (created atomically with the order).
- Conversations are identified by `conversation_id` (UUID). Messages reference `conversation_id`, not `order_id`.
- System messages (`kind = 'system'`) have `sender_id = null` and a `system_type` field. Displayed as centered pills in the UI, not as chat bubbles.
- User messages (`kind = 'user'`) are normal chat messages with a sender.
- WebSocket room = `conversation_id`. All participants receive real-time broadcasts.

## Reconciliation

Daily job (cron 03:00 UTC) compares:
- Sum of wallet balance columns (`wallets.balance_cents`)
- Sum of `liability:user-payable` net movements in the ledger

If they differ by more than a small threshold, all admins receive an alert notification.

Admins can manually trigger reconciliation, view snapshots, and export a CSV report.
