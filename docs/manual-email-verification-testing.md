# Manual testing checklist: email verification

Automated coverage (`backend/test/email-verification.test.ts`) exercises the token
lifecycle, the `requireEmailVerified` middleware, and the computed `emailVerified` flag
directly against the test database/Redis. This checklist covers the rest: the full
HTTP + frontend flow, which the project's test suite doesn't drive end-to-end (there's no
supertest/HTTP harness in this repo today — existing tests call services directly).

Run the dev stack (`docker compose -f docker-compose.dev.yml up`) before starting.

## 1. Register → confirm

1. Register a new account with a real email you can check (or leave `SMTP_HOST` unset
   and use the `debugVerificationUrl` from the register response).
2. Confirm the response includes `"emailVerified": false`.
3. Open the link. The `/verify-email` page should show a **"Confirm email"** button —
   it must *not* auto-confirm on load.
4. Click it. Confirm you see the success state, then `GET /auth/me` shows
   `"emailVerified": true`.
5. Reload `/verify-email` with the *same* link again — it should now show the
   "invalid or expired" state (token already consumed), not a false success.

## 2. Banner and resend

1. Register a second account, don't confirm it.
2. Confirm the amber banner appears on every page while logged in.
3. Dismiss it (×) — reload the page in the same tab/session: it should stay hidden.
4. Open a new tab/session as the same user: the banner should reappear (dismiss is
   per-`sessionStorage`, not permanent).
5. Click "Send email" in the banner, then again in Settings → "Подтверждение email" —
   confirm the second click within 60s is rejected ("wait a minute...").
6. Wait or manually clear Redis (`del email_verify_cooldown:<userId>`) and click 5 more
   times within an hour — the 6th should be rejected with the hourly-limit message.

## 3. Gated actions

With the unconfirmed account from step 2, confirm each of these shows the friendly
"confirm your email" notice (not raw JSON / a generic error):

- [ ] Create a listing (`/seller/create`)
- [ ] Buy a product (any checkout button on a product page)
- [ ] Top up the wallet (any provider button on `/wallet`)
- [ ] Withdraw from the wallet
- [ ] Start a chat with a seller from a product page
- [ ] Send a chat message (if a conversation already exists)
- [ ] Open a dispute on an order

Then confirm the email (step 1) and verify all of the above now work normally.

## 4. Unaffected actions (must NOT be blocked while unverified)

- [ ] Browsing the catalog and product pages
- [ ] Viewing your own profile/settings
- [ ] Editing display name / avatar / email in Settings
- [ ] Logout / login / refresh
- [ ] Password forgot/reset

## 5. Telegram accounts

1. Log in via Telegram (or check an existing `tg_...@telegram.local` account in the DB).
2. Confirm `emailVerified` is `true` immediately, with no email ever sent, and none of
   the gated actions above are blocked.

## 6. Production-only behavior

These only matter on a deploy with `NODE_ENV=production`:

1. With SMTP configured correctly: `POST /auth/verify-email/request` returns
   `{ "status": "sent" }` with no `debugVerificationUrl` field.
2. Temporarily set `SMTP_PASSWORD` to something wrong (or unset `SMTP_HOST`), redeploy,
   and confirm `/auth/verify-email/request` now returns a 400 error instead of a fake
   "sent" — then revert.
3. Confirm registration *still succeeds* in both cases above (it must never fail due to
   the email send itself) — check the response is 201 with a `user` object.
