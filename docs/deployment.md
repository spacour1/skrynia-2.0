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

The backend is a stateless Express API. Multiple replicas can run in parallel as long as all shared state lives in PostgreSQL and Redis.

### Single container (simplest)

Use `docker-compose.yml` (root of repo) with a `.env` filled from `.env.example`.

```bash
cp .env.example .env
# Edit .env with real secrets
docker compose up -d
```

### Railway

1. Connect repo, set service root to `backend/`.
2. Railway auto-detects the `Dockerfile`.
3. Set all required env vars in Railway → Variables.
4. Add a `RAILWAY_DEPLOYMENT_ID` tag (Railway sets this automatically) — the backend reads it for the Sentry release.
5. Health check path: `/health`.

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
  health_checks = [{ path = "/health" }]
```

### API replica vs. Worker replica

The backend runs both the HTTP API and the BullMQ job worker in the same process by default. For production at scale, split them:

| Replica type | `JOB_WORKER_ENABLED` | Replicas |
|---|---|---|
| API | `false` | 2–N (horizontal scale) |
| Worker | `true` | 1 (exactly one; multiple workers cause double-processing) |

Set `JOB_WORKER_ENABLED=false` on API replicas and run one separate worker replica with `JOB_WORKER_ENABLED=true`.

### Required backend env vars (production)

```
NODE_ENV=production
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://host:6379
JWT_SECRET=<min-24-char-random-secret>
METRICS_USER=metrics
METRICS_PASSWORD=<strong-password>
FRONTEND_URL=https://your-domain.example
PUBLIC_BACKEND_URL=https://api.your-domain.example
```

---

## Managed PostgreSQL

Recommended providers: Supabase Postgres, Neon, Railway Postgres, DigitalOcean Managed Databases, AWS RDS.

- Set `DATABASE_URL` to the managed instance's connection string.
- Set `PG_POOL_MAX` based on your plan's connection limit (see [docs/pgbouncer.md](./pgbouncer.md)).
- Run migrations on deploy: the Dockerfile `CMD` already runs `node-pg-migrate up` before starting the server.
- **Never connect AI tools or local dev machines to the production database.**

### Read replica (Stage 2)

Read replicas are not implemented yet. Add as Stage 2 work: route read-heavy marketplace listing queries to a replica, keep writes on the primary.

---

## Managed Redis

Redis is required in production for:

| Feature | Without Redis |
|---------|--------------|
| Session revocation | JWT expiry only (revoked tokens remain valid until TTL) |
| BullMQ job queue | Jobs silently dropped; escrow auto-release, reconciliation, notifications do not run |
| Application cache | Every request hits PostgreSQL directly |

Use managed Redis: Railway Redis, Upstash, Redis Cloud, or AWS ElastiCache.

```
REDIS_URL=redis://:password@host:6379
# TLS: rediss://host:6380
```

The `getRedis()` helper in `backend/src/common/redis.ts` uses `lazyConnect: true` and swallows connection errors — the server starts without Redis in dev, but production without Redis is unsupported and will silently degrade.

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

4. In R2 bucket settings, set **Public Access** → Custom Domain → `media.your-domain.example` so uploaded URLs are served from your domain (optional but recommended for CDN caching).

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
- Object scanning (virus/malware scan) is a future hardening item. Do not assume uploaded content is safe.
- Never make the S3 bucket public-write from the browser. All uploads go through the authenticated `/storage/upload` endpoint.

---

## Production deployment checklist

- [ ] `JWT_SECRET` is a unique ≥32-char random string
- [ ] `METRICS_PASSWORD` is a unique strong password
- [ ] `DATABASE_URL` points to managed PostgreSQL, not local Docker
- [ ] `REDIS_URL` is set and reachable
- [ ] `STORAGE_DRIVER=s3` + S3 credentials set (for multi-replica)
- [ ] At least one payment provider configured (LiqPay, Monobank, WayForPay, or manual)
- [ ] `JOB_WORKER_ENABLED=false` on API replicas; one worker replica has it `=true`
- [ ] `FRONTEND_URL` set to the exact origin (no trailing slash)
- [ ] `SENTRY_DSN` set on backend; `NEXT_PUBLIC_SENTRY_DSN` set on frontend build
- [ ] `ENABLE_TEST_PAYMENTS` is `false` (or unset)
- [ ] `/health` returns 200 from the load balancer
- [ ] `/metrics` requires basic auth and is not publicly reachable without it
- [ ] Migrations ran successfully (`node-pg-migrate up` output in deploy logs)
