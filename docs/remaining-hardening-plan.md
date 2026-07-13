# Remaining production-hardening plan

Status after the `fix/production-hardening` branch (P0 complete). Every item below was
scoped in the hardening audit but deliberately deferred; nothing here blocks the P0
guarantees already merged. Work top-to-bottom.

## Done in this branch (P0)

| # | Item | Commit |
| - | ---- | ------ |
| 1 | Schema reconciliation + clean-DB contract tests | `fix(db): reconcile application schema...` |
| 2 | Audit log stops storing request bodies; redactor; history purge | `fix(security): stop persisting request bodies...` |
| 3 | Public product detail restricted (active + non-banned seller; owner/staff preview) | `fix(marketplace): restrict public product detail...` |
| 4 | One-time WS tickets + Origin allowlist + maxPayload + per-user cap | `fix(auth): add one-time websocket authentication tickets...` |
| 5 | Password change rotates a full new session (refresh survives) | `fix(auth): rotate a full new session...` |
| 6 | Product + media atomic transaction | `fix(marketplace): make product create/update and media replacement atomic` |
| 7 | Dispute open transactional/idempotent; resolve single-shot state machine | `fix(orders): make dispute open transactional...` |

Test suite: 162 backend tests green; suite-level auth rate limits raised in test/setup.ts
(no test asserts 429s; production limits unchanged).

## P1 — reliability

1. **Transactional outbox (`domain_outbox`)** — table + FOR UPDATE SKIP LOCKED worker with
   exponential backoff; write events inside business transactions with stable keys
   (`order:{id}:created`, ...). Migrate side effects (notifications, WS, BullMQ, cache
   invalidation) out of HTTP handlers, starting with order lifecycle, messages, disputes,
   moderation actions. Deduplicate notifications by event_key. Do NOT move money logic.
2. **WebSocket Redis pub/sub distribution** — realtime event bus envelope
   (id/type/scope/targetId/payload/sourceInstanceId); `notifyOrderEvent` /
   `broadcastConversation` publish globally, replicas fan out locally. Degrade without
   crashing when Redis is down. PresenceService with TTL/heartbeat ephemeral keys instead
   of local-map `isUserOnline`. Backpressure: check `bufferedAmount`, drop slow clients,
   metric for drops.
3. **Idempotency of business operations** — `Idempotency-Key` for order creation
   (request-hash table, conflict on mismatched body, parallel-safe); `clientMessageId`
   with `(sender_id, client_message_id)` unique for chat send (HTTP + WS) plus frontend
   retry reuse; review endpoint returns existing review on retry instead of 500 on unique
   violation.
4. **Seller statistics** — current single JOIN with SUMs multiplies aggregates; rewrite
   with per-domain CTEs (product/order/favorite/review stats), return
   `hasEnoughData: false` instead of fake 100% success rate; SQL integration tests with
   multi-product/multi-order fixtures.
5. **Storage ownership** — `storage_objects` table (owner, object_key, purpose, status
   temporary/attached/deleted), attach-by-id instead of привязки чужих URL; orphan cleanup
   job; upload quotas; image re-encode pipeline (sharp) + EXIF strip; store `object_key`
   not full URL, build public URLs via `MEDIA_PUBLIC_BASE_URL`; S3 client singleton.
6. **API contracts** — DTO mappers so no snake_case leaks (dispute detail endpoint
   currently returns raw `d.*`); centralize Order/Product/Dispute/Role/DeliveryType enums
   shared with frontend; document the order state machine (initial status `pending`).

## P2 — product/ops polish

1. **Search** — pg_trgm + unaccent migration, normalized search vector across
   title/description/game/aliases; ranking exact > prefix > alias > trigram > FTS;
   verify with EXPLAIN ANALYZE; UA/RU/EN test queries (already partially covered by
   catalog aliases in /suggest).
2. **Frontend reliability** — authStatus degraded state (network/5xx must not clear the
   cached user); currency store without full-app remount via React key; homepage category
   cards navigate to real catalog filters; product cards as links (keyboard/new-tab);
   error/retry states on main queries; locale-aware date/number formatting; SSR/initialData
   for homepage data.
3. **E2E (Playwright)** — smoke: register → create product → visible publicly → favorite →
   chat → order lifecycle (test payments mock) → review → block hides product.
4. **CI** — add clean-migration smoke (create empty DB + migrate + run schema-contract
   tests), frontend tests job, docker build smoke, npm audit gate, secret scanning.
5. **Ops** — graceful shutdown (SIGTERM: HTTP → WS → BullMQ → Redis → PG); /health/live +
   /health/ready; separate `start:api` / `start:worker` entrypoints; migrations as a
   release step instead of on every container start (dev compose already runs them at
   start; production images must not); Docker non-root user + healthcheck; outbox/WS/pool
   metrics.

## Known constraints

- Test suite requires the dev docker stack (postgres:5432, redis:6379) running; suite
  re-runs previously flaked on 429s — fixed via test-env rate-limit overrides.
- `docker-compose.dev.yml` uses stock node images with volume mounts; there is no
  production Dockerfile build smoke yet (see P2/Ops).
- External integrations (LiqPay/Monobank/WayForPay callbacks, Resend, Twilio, Telegram)
  are exercised only through existing mocks; no live calls were made.
