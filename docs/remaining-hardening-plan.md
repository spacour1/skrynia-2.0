# Remaining production-hardening plan

Stages 0–7 are complete at baseline `36ea677`; the Stage 8 test foundation is now
implemented on top of it. This document tracks the remaining work in execution order.
It does not certify production readiness.

## Stage 8 — frontend test foundation

Status: complete. Vitest, jsdom, React Testing Library, deterministic browser/network
helpers, coverage reporting, and the existing realtime-client coverage are wired into
`npm test`. Stage 9 owns the focused user-visible reliability tests listed below.

1. Add a frontend test runner and React Testing Library setup without replacing the
   existing realtime-client test.
2. Cover focused user-visible contracts: authentication hydration/degraded state,
   retry states, currency-draft preservation, category filter navigation, and product
   links that remain accessible and open in a new tab.
3. Keep tests deterministic: mock network boundaries, do not require a live backend for
   component tests, and run them in CI.

## Stage 9 — frontend reliability

1. Temporary API 500/network/429 failures must render a degraded state and preserve an
   existing authenticated user instead of treating the failure as logout.
2. Retry must restore failed data without losing in-progress drafts; a currency change
   must not reset a draft through an application remount.
3. Category links must encode a real marketplace filter. Product cards must be semantic
   links, keyboard-accessible, and safe to open in another tab.
4. Add UI tests before treating these behaviours as complete.

## Stage 10 — production runtime and operations

1. Add API/worker runtime entry points and ensure workers are explicitly enabled only
   where intended.
2. Implement graceful SIGTERM/SIGINT shutdown in dependency order: stop HTTP intake,
   close WebSockets, stop BullMQ/outbox work, then Redis and PostgreSQL pools.
3. Keep migrations as a release/deployment step, not an API process startup side effect.
4. Complete `/health/live` and `/health/ready` semantics with bounded dependency checks.
5. Verify Docker healthchecks, non-root runtime user, restart behaviour, and shutdown
   under Compose. Record only commands that were actually run.

## Stage 11 — CI gates

1. Add the frontend test job from stage 8.
2. Add clean-database migration smoke followed by schema-contract coverage.
3. Add Docker build/config checks, dependency/audit policy, and secret scanning.
4. Add Playwright only after the isolated environment in stage 12 exists; keep traces
   and screenshots as failure artifacts.

## Stage 12 — Playwright E2E

### Environment

1. Add `@playwright/test`, a Playwright configuration, E2E fixtures, and a dedicated
   Compose environment with clean PostgreSQL, Redis, API, worker/outbox, and frontend.
2. Use a distinct Compose project/ports/volume and unique data per run; never point E2E
   at the developer or production database.
3. Provide deterministic verified seller, buyer, and admin fixtures (or a controlled
   registration/verification bootstrap).
4. Limit payment-simulation routes to explicit test mode. They are currently available
   in all non-production environments, which is too broad for this stage.

### Required browser flows

1. Golden marketplace: registration, seller listing/public visibility, favorite, chat
   message and ACK, idempotent order creation, mock payment, start/deliver/confirm,
   completed order, and replay-safe review.
2. Dispute: use a separate paid order, open dispute, seller response, admin detail and
   resolution, predictable repeated resolution, immutable original reason, and
   post-resolution participant-message rule. Add participant dispute-message UI if the
   intended flow must be browser-only.
3. Moderation/cache: warm anonymous list/detail, block, prove list/detail no longer
   resolve, prove owner/admin preview rule, then unblock/reactivate and verify cache
   invalidation.
4. Session security: two browser contexts and sockets; password change must rotate the
   caller, revoke the other HTTP session/refresh token, close its socket, reject old
   password, and accept the new one.
5. Frontend reliability: transient API/network failure, recovery through retry, draft
   survival during currency change, real category filter, and new-tab product link.

## Stage 13 — multilingual typo-tolerant search

1. Add a migration for `pg_trgm` and `unaccent`; check extension availability with the
   target PostgreSQL provider before rollout.
2. Build a maintained denormalized product search representation. It must include title,
   description, game name and catalog aliases, category, section, product type, server,
   and platform. Do not use a generated column with joined-table subqueries.
3. Normalize case, accents, spaces, and hyphens; store Cyrillic/Latin variants as catalog
   aliases rather than hardcoding them in query SQL.
4. Use indexed search and deterministic relevance tiers: exact normalized title, title
   prefix, exact game alias, exact game name, trigram similarity, full-text, popularity,
   then recency. Popularity/recency must not outrank exact matches.
5. Backfill aliases and fixtures for: `контр страйк`, `counter strike`, `cs2`, `кс2`,
   `valorant`, `валик`, `roblox`, `роблокс`, `аккаунт`, `акаунт`, `boost`, and `буст`.
   Assert a first relevant game/product rather than an entire brittle result ordering.
6. Add a realistic load fixture (tens of thousands of products where practical) and
   record `EXPLAIN ANALYZE`: planning/execution time, rows scanned, index use, sequential
   scans, and short/typo/common-query behaviour.
7. For large production tables, use a safe rollout: batched backfill, concurrent index
   creation outside a transaction where required, documented lock risk, and rollback
   limits.

## Ongoing constraints

- Do not integrate or call real payment providers. Playwright and integration tests use
  the mock payment flow only.
- All migrations require a timestamped SQL file, safe rollout notes, and relevant tests.
- Do not claim a check passed unless it was run and completed successfully.
