# Deployment Guide — Stage 1

SKRYNIA targets 10 k online users, 500–1 500 API RPS, 1 k–5 k WebSocket connections.

---

## Frontend — Vercel or Cloudflare Pages

### Vercel (recommended)

1. Push the repo to GitHub. In Vercel, import the repo.
2. Set **Root Directory** to `frontend/`.
3. Framework preset: **Next.js** (auto-detected).
4. Add all `NEXT_PUBLIC_*` env vars in the Vercel dashboard → Settings → Environment Variables.
5. Build command: `npm run build` (default). Output: `.next` (auto-configured).

Required env vars on Vercel:

```
NEXT_PUBLIC_API_URL=https://api.your-domain.example
NEXT_PUBLIC_WS_URL=wss://api.your-domain.example/ws
NEXT_PUBLIC_SITE_URL=https://your-domain.example
NEXT_PUBLIC_SENTRY_DSN=...           # optional
NEXT_PUBLIC_POSTHOG_KEY=...          # optional
NEXT_PUBLIC_POSTHOG_HOST=...         # optional
SENTRY_ORG=...                       # build-time only, for source maps
SENTRY_PROJECT=...
SENTRY_AUTH_TOKEN=...
```

> **Do not hardcode localhost** in any `NEXT_PUBLIC_*` variable for production builds.

### Cloudflare Pages

1. Connect repo, set root directory `frontend/`, build command `npm run build`, output `frontend/.next`.
2. Enable **Next.js** preset (Cloudflare supports Next.js via `@cloudflare/next-on-pages`).
3. Set env vars in Pages → Settings → Environment Variables.

### Notes

- `NEXT_PUBLIC_API_URL` is used by the Next.js `rewrites()` rule to proxy `/api/*` requests server-side. On Vercel/Cloudflare this works without additional configuration.
- WebSocket connections (`NEXT_PUBLIC_WS_URL`) connect browser → backend directly and bypass the Next.js proxy.
- Source maps are uploaded to Sentry at build time if `SENTRY_AUTH_TOKEN` is set. They are hidden from browser responses via `hideSourceMaps: true` in `next.config.mjs`.

---

## Backend — Railway, Fly.io, Render, or DigitalOcean App Platform

The backend image contains four compiled commands with separate ownership:

| Process | Command | Responsibility |
|---|---|---|
| Release job | `npm run migrate:deploy` | SQL migrations plus encrypted legacy-2FA backfill |
| API | `npm run start:api` | HTTP, WebSocket, Redis realtime subscriber |
| Job worker | `npm run start:worker` | BullMQ processors and schedules |
| Outbox | `npm run start:outbox` | PostgreSQL outbox polling, retries, and stale-claim recovery |

Never use the API, worker, or outbox command as a migration hook. Run exactly one
release job before rolling out the three long-running process types. The release
runner holds a repository-stable PostgreSQL advisory lock across both SQL and 2FA
data migrations, so accidentally concurrent release jobs serialize safely.
The release process validates only `DATABASE_URL`, `TWO_FACTOR_ENCRYPTION_KEY`, and
`TWO_FACTOR_ENCRYPTION_KEY_VERSION`; it does not load HTTP, Redis, metrics, mail, or
payment-provider configuration.

### Production-shaped Compose

Use `docker-compose.yml` (root of repo) with a `.env` filled from `.env.example`.
The `migrate` service must complete successfully before API/worker/outbox start.

```bash
cp .env.example .env
# Edit .env with real secrets
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

The images use non-root users, direct exec-form Node commands, bounded healthchecks,
and graceful-stop windows. The frontend uses Next.js standalone output; the backend
runtime contains compiled code, production dependencies, and migration files only.
The root Compose topology is suitable for a single Docker host. Do not scale its
local upload volume across hosts; set `STORAGE_DRIVER=s3` for multi-replica production.

### Railway

1. Connect repo, set service root to `backend/`.
2. Railway auto-detects the `Dockerfile`.
3. Set all required env vars in Railway → Variables.
4. Add a `RAILWAY_DEPLOYMENT_ID` tag (Railway sets this automatically) — the backend reads it for the Sentry release.
5. Health check path: `/health/ready` (use `/health/live` only for liveness where
   the platform supports separate probes).

### Fly.io

```bash
fly launch --dockerfile backend/Dockerfile --name skrynia-api
fly secrets set JWT_SECRET=... DATABASE_URL=... REDIS_URL=...
fly deploy
```

Add to `fly.toml`:

```toml
[[services.ports]]
  handlers = ["http"]
  port = 4000

[deploy]
  health_checks = [{ path = "/health/ready" }]
```

### API, job worker, and outbox replicas

The API entrypoint cannot start BullMQ or outbox processors. Deploy each process
type with its command from the table above. Entrypoints, not environment flags,
select the process role; the flags remain false on API as compatibility metadata.

| Process | Command | Initial replicas |
|---|---|---|
| API | `npm run start:api` | 2–N |
| Job worker | `npm run start:worker` | 1 |
| Outbox | `npm run start:outbox` | 1–N |

Outbox replicas are safe to scale because rows are claimed through
`FOR UPDATE SKIP LOCKED`. Worker and outbox processes publish expiring readiness
heartbeats in Redis. Give every replica a unique `RUNTIME_INSTANCE_ID`; the local
Compose file uses stable `worker` and `outbox` IDs because it runs one of each.

Every API replica subscribes to `REALTIME_CHANNEL`. Let the application generate
`REALTIME_INSTANCE_ID`, or set a different value on every API process. Reusing one
realtime instance ID causes replicas to mistake remote events for their own.

### Required backend env vars (production)

```
NODE_ENV=production
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://host:6379
JWT_SECRET=<min-24-char-random-secret>
TWO_FACTOR_ENCRYPTION_KEY=<64-hex-chars — unique 32-byte AES key>
TWO_FACTOR_ENCRYPTION_KEY_VERSION=1
TWO_FACTOR_ENCRYPTION_PREVIOUS_KEYS=  # optional: version:64-hex-key,...
METRICS_USER=metrics
METRICS_PASSWORD=<strong-password>
FRONTEND_URL=https://your-domain.example
PUBLIC_BACKEND_URL=https://api.your-domain.example
```

`TWO_FACTOR_ENCRYPTION_KEY` encrypts stored 2FA secrets (AES-256-GCM). The backend
refuses to boot in production when it is unset or equals the dev default. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Rotating the 2FA encryption key

Treat every key version as immutable. A rolling or multi-replica deployment requires a
two-phase rotation so every live replica can decrypt both versions before any replica
writes the new version. Despite its historical name,
`TWO_FACTOR_ENCRYPTION_PREVIOUS_KEYS` is the non-current decryption keyring and may
temporarily contain the staged next version.

Phase 1: keep version 1 current, preload version 2 on every API replica, worker, and
outbox process, then wait for the rollout to finish and verify that no old configuration
is still serving:

```text
TWO_FACTOR_ENCRYPTION_KEY=<old-64-hex-key>
TWO_FACTOR_ENCRYPTION_KEY_VERSION=1
TWO_FACTOR_ENCRYPTION_PREVIOUS_KEYS=2:<new-64-hex-key>
```

Phase 2: only after phase 1 has reached every replica, make version 2 current while
retaining version 1, and complete a second rollout:

```text
TWO_FACTOR_ENCRYPTION_KEY=<new-64-hex-key>
TWO_FACTOR_ENCRYPTION_KEY_VERSION=2
TWO_FACTOR_ENCRYPTION_PREVIOUS_KEYS=1:<old-64-hex-key>
```

The API encrypts new secrets with the current version and lazily rewrites successfully
used non-current rows. During the second rolling rollout, replicas may briefly rewrite a
row in either direction, but both configurations can decrypt both versions; after all
replicas use version 2, rows converge to version 2. Multiple non-current entries are
comma-separated. Startup rejects malformed or duplicate keyring configuration and any
entry that repeats the current version. A database ciphertext whose version is absent
from the configured keyring fails closed when that row is decrypted.

Keep version 1 configured until no active or pending 2FA row references it, then remove
it in a later deployment. For rollback, restore the corresponding key and version
together; never assign a new key to a version that has already encrypted data. If the
platform cannot perform both phases, use a verified zero-overlap deployment instead of
a rolling rotation.

---

## Managed PostgreSQL

Recommended providers: Supabase Postgres, Neon, Railway Postgres, DigitalOcean Managed Databases, AWS RDS.

- Set `DATABASE_URL` to the managed instance's connection string.
- Set `PG_POOL_MAX` based on your plan's connection limit (see [docs/pgbouncer.md](./pgbouncer.md)).
- Before rollout, run the built image once with `npm run migrate:deploy`. A clean run
  applies all SQL migrations and the legacy 2FA secret backfill; a repeated run is a
  no-op. Do not replace this with migration execution in an application command.
- Preserve the `Idempotency-Key` request header at every proxy/CDN hop. Order clients must
  retain one UUID only while retrying the same request body; completed results are retained
  for 24 hours.
- **Never connect AI tools or local dev machines to the production database.**

### Read replica (Stage 2)

Read replicas are not implemented yet. Add as Stage 2 work: route read-heavy marketplace listing queries to a replica, keep writes on the primary.

---

## Managed Redis

Redis is required in production for:

| Feature | Without Redis |
|---------|--------------|
| Session revocation | Durable `session_version` checks still reject revoked HTTP sessions and WebSocket frames; immediate cross-replica socket disconnect is degraded until Redis recovers |
| BullMQ job queue | Jobs silently dropped; escrow auto-release, reconciliation, notifications do not run |
| Application cache | Every request hits PostgreSQL directly |
| Realtime Pub/Sub | Only sockets on the producing process receive best-effort events |
| Global presence | API returns `null` (unknown), never a false offline result |

Use managed Redis: Railway Redis, Upstash, Redis Cloud, or AWS ElastiCache.

```
REDIS_URL=redis://:password@host:6379
# TLS: rediss://host:6380
```

The API process stays alive during a Redis outage and local WebSocket delivery still works.
`GET /health/ready` returns `503` when PostgreSQL, required Redis, or the realtime
subscriber is unavailable, while `GET /health/live` (and compatibility alias
`GET /health`) remains the dependency-free liveness probe. Outbox-backed realtime events stay
retryable until Redis accepts their publication.

---

## S3 / Cloudflare R2 file uploads

Local uploads (`STORAGE_DRIVER=local`) are written to the `uploads/` directory on the API container. In a multi-replica setup, each replica has its own filesystem — uploads land on one replica and are invisible to others. **Use object storage for any production deployment with more than one backend instance.**

### Cloudflare R2 setup

1. Create a Cloudflare R2 bucket named `skrynia-uploads`.
2. Create an R2 API token with **Object Read & Write** permission.
3. Set env vars:

```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=skrynia-uploads
S3_REGION=auto
S3_ACCESS_KEY_ID=<r2-access-key>
S3_SECRET_ACCESS_KEY=<r2-secret-key>
```

4. For a new deployment, keep **Public Access disabled** and do not attach a public R2
   development URL or custom domain. The API reads objects with its service credential
   and serves new public assets and authorized private attachments through opaque UUID
   proxy routes. Existing deployments must complete the legacy-URL transition below
   before disabling an already-public bucket.

### AWS S3 setup

```
STORAGE_DRIVER=s3
S3_BUCKET=skrynia-uploads
S3_REGION=eu-central-1
S3_ACCESS_KEY_ID=<iam-key>
S3_SECRET_ACCESS_KEY=<iam-secret>
# S3_ENDPOINT is omitted for AWS (default endpoint is used)
```

### Security notes

- The backend validates image magic bytes before accepting any upload (rejects forged Content-Type headers).
- `avatar`, `product_media`, and `catalog_asset` are the only public purposes. They are
  served from `/api/storage/public/:storageObjectId` only after attachment. The legacy
  `/uploads/:purpose/:ownerId/:fileName` route is database-backed and accepts only those
  attached public purposes; it never exposes a filesystem directory.
- `chat_attachment` is private. `/api/storage/private/:storageObjectId` authenticates every
  request, then rechecks the conversation/dispute membership and hidden-message state.
  Temporary previews are owner-only. Private responses use `no-store`, and API payloads
  contain neither the provider object key nor the bucket name.
- Keep every S3/R2 bucket private, including read access. All browser uploads and reads
  for newly owned objects go through the API; `MEDIA_PUBLIC_BASE_URL` is retained only
  as a legacy deployment setting and is not used to construct new media URLs.
- Successful reads are capped by `STORAGE_MAX_STORED_IMAGE_BYTES` (16 MiB by default),
  `STORAGE_MAX_CONCURRENT_READS` (8), `STORAGE_READ_QUEUE_LIMIT` (32), and
  `STORAGE_READ_TIMEOUT_MS` (10 seconds). `HEAD` is explicitly handled without loading
  the provider body and shares the public read rate-limit bucket with `GET`.
- A `catalog_asset` is not publicly readable merely because upload attachment completed.
  The public proxy rechecks that an active catalog group references it, or that both the
  referencing catalog item and its parent group are active. Draft/hidden references stay
  private but protect the asset from cleanup; truly abandoned attached catalog uploads
  return 404 and enter durable cleanup after the temporary TTL.
  The attach response keeps the canonical public URL for the catalog form and supplies a
  separate owner-admin-only private preview URL; the preview URL must never be persisted
  in a catalog row.

### Existing public URL transition

Do not turn off an existing CDN/custom-domain endpoint in the same release that first
introduces the proxy. Older `product_media.url`, `users.avatar_url`, seller settings, and
catalog image fields may still contain absolute CDN URLs or `/uploads/...` object-key
paths. Use this staged rollout:

1. Inventory those fields and classify every referenced object as public or private.
   Private chat/dispute rows without a valid `attachment_storage_object_id` already fail
   closed and must be mapped or deliberately retired; never preserve their raw URL.
2. Before deploying the proxy cutover, backfill public rows that have an owned storage FK
   to `/api/storage/public/:storageObjectId`. Legacy local `/uploads/...` rows without a
   matching `storage_objects` record must be imported and linked first; the database-backed
   legacy route intentionally returns 404 for unmanaged files. This repository contains no
   automatic backfill or compatibility feature flag. If the pre-deploy inventory is not at
   zero, keep the proxy cutover disabled behind an operator-supplied feature flag and retain
   the previous read-only legacy handler until the backfill is complete. Do not silently
   fall back to serving the upload directory.
3. Verify in a non-production copy that no active database row, rendered API payload,
   cache entry, email, or frontend page still references the public bucket/custom domain
   or an object-key URL. Migration and verification against an external S3/R2 provider are
   **BLOCKED / NOT RUN** because no non-production provider environment is available.
4. Only after the inventory reaches zero, disable bucket public access, purge CDN/API
   caches, and verify representative avatar, product, and catalog reads through the API.
   Roll back by restoring the read-only legacy endpoint, not by making uploads public.

### Malware and quarantine boundary

The current pipeline validates declared MIME against decoded image bytes, enforces byte,
dimension, pixel, quota, queue, and concurrency limits, then decodes and re-encodes the
image as WebP. This reduces parser and metadata risk but is **not** malware scanning.

No ClamAV or managed scanning provider is available in this repository or its local test
environment, so malware-provider verification is **BLOCKED / NOT RUN**. Real S3/R2
authorization is likewise **NOT RUN** until a non-production provider environment is
supplied. Until a scanner is integrated, `quarantined` objects are fail-closed and are
never downloadable. A future scanner must keep new objects unavailable while pending,
promote only a clean result to `temporary`, leave infected/error results quarantined,
and enqueue durable deletion with retry rather than silently dropping provider failures.

### Durable storage-state migration rollout

Migration `1784752500000_add-storage-operation-states.sql` adds the `uploading` and
`deleting` recovery states used by API and outbox workers. Apply the migration before
deploying the matching backend build, then restart API and worker replicas together;
avoid a prolonged mixed-version rollout because older replicas do not include these
reserved states in quota totals. Keep the domain outbox worker enabled so deletion
intents retry provider failures. Before rolling back, stop writers and drain pending
`storage.delete` events; the down migration maps any remaining operation rows to
`quarantined`, preserving their object keys for manual cleanup instead of discarding
recovery evidence.
The replacement CHECK constraints are validated before the short constraint-name swap.
The partial cleanup index is built transactionally, however, so on a very large
`storage_objects` table schedule this migration in a maintenance window: PostgreSQL can
block concurrent writes while that index is built.

---

## Production deployment checklist

- [ ] `JWT_SECRET` is a unique ≥32-char random string
- [ ] `TWO_FACTOR_ENCRYPTION_KEY` is a unique 64-hex (32-byte) key, not the dev default
- [ ] Every version in `TWO_FACTOR_ENCRYPTION_PREVIOUS_KEYS` is unique and still required
- [ ] `METRICS_PASSWORD` is a unique strong password
- [ ] `DATABASE_URL` points to managed PostgreSQL, not local Docker
- [ ] `REDIS_URL` is set and reachable
- [ ] `STORAGE_DRIVER=s3` + S3 credentials set (for multi-replica)
- [ ] At least one payment provider configured (LiqPay, Monobank, WayForPay, or manual)
- [ ] Release job `npm run migrate:deploy` completed before application rollout
- [ ] API, job worker, and outbox use their separate compiled commands
- [ ] API environment keeps legacy worker flags false
- [ ] Every scaled worker/outbox replica has a unique `RUNTIME_INSTANCE_ID`
- [ ] `FRONTEND_URL` set to the exact origin (no trailing slash)
- [ ] `SENTRY_DSN` set on backend; `NEXT_PUBLIC_SENTRY_DSN` set on frontend build
- [ ] `ENABLE_TEST_PAYMENTS` is `false` (or unset)
- [ ] `/health/live` returns 200 and `/health/ready` returns 200 before receiving traffic
- [ ] `/metrics` requires basic auth and is not publicly reachable without it
- [ ] Reverse proxies forward `Idempotency-Key` unchanged
- [ ] Migration logs show the release runner completed SQL and legacy-2FA steps
