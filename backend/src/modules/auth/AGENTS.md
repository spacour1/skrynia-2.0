# Authentication module instructions

This file applies to `backend/src/modules/auth/`. Inherit the repository and backend
instructions. Authentication, sessions, 2FA, and WebSocket identity are D4 high risk.

## Invariants

- `session_version` is the durable invalidation epoch. Increment it in the same
  database transaction as a password, 2FA, ban, role, recovery, or logout-all change;
  perform Redis/realtime revocation after commit.
- Preserve refresh rotation semantics. Store only token hashes, reject stale session
  versions, distinguish an invalid token (`401`) from unavailable session storage
  (`503`), and never clear a usable session because Redis briefly failed.
- Apply ban, session-version, and 2FA policy consistently to every login method,
  including Telegram. Do not create an alternate authentication path around them.
- A 2FA-pending token is short-lived, purpose-bound, session-version-bound, and
  single-use. It is not an authenticated session.
- TOTP must follow RFC 6238 with explicit algorithm, period, digits, bounded drift,
  strict Base32 validation, timing-safe comparison, rate limiting, and a defined replay
  policy. Add RFC vectors for algorithm changes.
- Encrypt TOTP secrets with authenticated encryption and explicit key versions. Support
  controlled key rotation; reject malformed or unknown versions and never fall back to
  plaintext. Never log TOTP secrets, encryption keys, codes, or backup codes.
- Backup codes are hashed, displayed only when created, consumed atomically once, and
  invalidated on regeneration. Security-state changes must revoke old sessions and
  WebSockets while rotating the caller only when the endpoint promises continuity.
- WebSocket tickets remain random, hashed at rest, short-lived, and atomically consumed.
  Handshake validation must check the live session, session version, user state, and
  allowed Origin; revocation events must close existing sockets.
- Validate every request with Zod, keep credential/OTP/WS-ticket rate limits, preserve
  CSRF protection, and never expose whether a recovery account exists.

## Verification gates

Commands assume the repository root. Run targeted tests first:

```bash
cd backend
npx vitest run test/auth.test.ts test/session-versioning.test.ts test/twofa-lifecycle.test.ts test/ws-ticket.test.ts
```

Then run the complete D4 backend gate:

```bash
cd backend
npm run lint
npm run build
npm test
```

For any change affecting an HTTP response, cookies, session generation, refresh,
login/logout, 2FA, or WebSocket behavior, run the frontend D2 and E2E gates too:

```bash
cd frontend
npm run typecheck
npm run i18n:check
npm test
npm run build
```

```bash
node e2e/scripts/run.mjs
```

If the authentication schema changes, use only an isolated non-production test
database and run:

```bash
cd backend
npm run migrate:deploy
npm run migrate:deploy
npx vitest run test/schema-contract.test.ts
```
