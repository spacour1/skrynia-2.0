# Testing

## Test runner

Backend uses **Vitest** (`npm test` / `npm run test:watch`). Frontend has no test suite — CI verifies it via `npm run typecheck` + `npm run build`.

## CI checks (must pass before merging)

```
# Backend
npm run lint    # tsc --noEmit — TypeScript errors fail CI
npm test        # vitest run

# Frontend
npm run typecheck   # tsc --noEmit
npm run build       # catches static-generation and server/client boundary errors
```

CI config: `.github/workflows/ci.yml`. Backend CI spins up real PostgreSQL 16 and Redis 7 service containers — do not mock the database in tests.

## Test database

Connection string: `TEST_DATABASE_URL` env var (falls back to `DATABASE_URL`). CI uses `postgres://marketplace:marketplace@localhost:5432/marketplace_test`. Migrations are applied before tests run (`npm run migrate`).

## Writing tests

Test files live next to the source they test, named `*.test.ts`.

```
src/modules/orders/orders.test.ts
src/modules/auth/totp.service.test.ts
```

Use `supertest` for HTTP integration tests against the Express app:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";

describe("POST /orders", () => {
  it("creates order and chat conversation atomically", async () => {
    const res = await request(app)
      .post("/orders")
      .set("Cookie", authCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ productId, quantity: 1 });

    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeDefined();
  });
});
```

## What must have tests

**Before touching these areas, add tests if none exist:**

| Area | Why |
|------|-----|
| Order status transitions | State machine correctness; wrong transitions lose money |
| Escrow release + fee calculation | Financial correctness; off-by-one = money loss |
| Payment webhook idempotency | Double-payment bugs are catastrophic |
| Refund flow | Buyer gets money back from correct account |
| Ledger balance | `sum(debit) = sum(credit)` on every entry |
| TOTP verification | Drift window, backup code one-time use |
| Role-based access | Moderator must not reach financial admin endpoints |

## Unit-testable pure functions

These have no I/O and are straightforward to unit-test:

- `verifyTotpCode(secret, code, atTimeMs?)` — `src/modules/auth/totp.service.ts`
- `generateTotpSecret()` — returns valid base32 string
- Fee calculation: `ceil(amountCents * bps / 10000)` — inline in orders.routes.ts, consider extracting

## Integration test helpers

Seed a test user and get auth cookies:

```ts
import { pool } from "../../db/pool.js";
import bcrypt from "bcryptjs";
import { issueSession } from "../auth/session.service.js";
import { setAuthCookies } from "../../common/cookies.js";

async function createTestUser(role = "user") {
  const hash = await bcrypt.hash("test-password", 4); // low rounds for speed
  const { rows } = await pool.query(
    `insert into users(email, password_hash, display_name, role)
     values ($1, $2, $3, $4) returning id, role`,
    [`test-${Date.now()}@example.com`, hash, "Test User", role]
  );
  await pool.query(
    `insert into wallets(user_id, currency) values ($1, 'UAH') on conflict do nothing`,
    [rows[0].id]
  );
  return rows[0];
}
```

## What CI does NOT cover (manual smoke testing)

- WebSocket real-time chat delivery
- Payment provider sandbox flows (LiqPay / Monobank / WayForPay test modes)
- Email delivery via Resend
- Telegram bot notification delivery
- File upload to S3

For these, use the dev Docker environment (`docker-compose.dev.yml`) and the seeded demo accounts:

| Email | Password | Role |
|-------|----------|------|
| admin@example.com | password123 | admin |
| moderator@example.com | password123 | moderator |
| buyer@example.com | password123 | user |
| seller@example.com | password123 | user |
