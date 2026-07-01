# PgBouncer connection pooling

PostgreSQL has a hard limit on simultaneous connections (`max_connections`, default 100 for most managed plans). Without a pooler, every backend replica holds up to `PG_POOL_MAX` connections to PostgreSQL. With only 3 API replicas × 20 connections each, you already consume 60 of 100 slots — leaving little room for migrations, psql sessions, monitoring tools, and bursts.

PgBouncer sits between the application and PostgreSQL and multiplexes many application connections onto a small number of real PostgreSQL connections.

---

## Recommended topology

```
Browser / WS clients
        │
        ▼
   Load Balancer
   (Cloudflare / nginx)
        │
   ┌────┴────┐
   │ API ×N  │   JOB_WORKER_ENABLED=false
   │ replicas│
   └────┬────┘
        │  application connections (many)
        ▼
   PgBouncer
   (transaction mode)
        │  real PG connections (few)
        ▼
   PostgreSQL
   (managed or self-hosted)
```

---

## PgBouncer mode

Use **transaction mode** (`pool_mode = transaction`). Each SQL transaction acquires a real connection and releases it immediately on COMMIT/ROLLBACK. This is compatible with the `inTx()` / `inSerializableTx()` helpers in `backend/src/db/pool.ts` since every transaction is a single client.acquire → BEGIN → COMMIT → client.release block.

> **Do not use statement mode** — it breaks multi-statement transactions.
> **Session mode** provides no benefit over the node-postgres pool itself.

---

## Connection math

```
total_pg_connections = api_replicas × PG_POOL_MAX
                     + worker_replicas × PG_POOL_MAX
                     + pgbouncer_pool_size           (if using pgbouncer)
                     + 3                             (psql, migrate, monitoring)
```

### Example: 3 API + 1 worker, no PgBouncer (direct connections)

```
3 × 20 + 1 × 20 + 3 = 83 connections
```
Manageable for a plan with max_connections = 100. Tight but workable.

### Example: 5 API + 1 worker + PgBouncer

```
PgBouncer → PostgreSQL: 20 real connections
Applications → PgBouncer: 5×5 + 1×5 = 30 application connections (PG_POOL_MAX=5)
PostgreSQL sees: 20 + 3 = 23 connections
```

This is the recommended approach for Stage 1 at scale.

---

## Recommended production values

| Setup | `PG_POOL_MAX` | PgBouncer pool_size |
|---|---|---|
| 1 API replica, no PgBouncer | 20 | — |
| 3–5 API replicas, no PgBouncer | 10 | — |
| 3–5 API replicas + PgBouncer | 5 | 20–30 |
| 10+ API replicas + PgBouncer | 3–5 | 30–50 |

---

## Minimal PgBouncer config (`pgbouncer.ini`)

```ini
[databases]
marketplace = host=postgres-host port=5432 dbname=marketplace

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 500
default_pool_size = 25
server_idle_timeout = 600
log_connections = 0
log_disconnections = 0
```

`userlist.txt`:
```
"marketplace" "md5<hash>"
```

### Docker Compose addition (optional dev/staging)

Add to `docker-compose.yml` (do not add to `docker-compose.dev.yml` — local dev does not need it):

```yaml
pgbouncer:
  image: edoburu/pgbouncer:1.22
  environment:
    DATABASE_URL: "postgres://marketplace:${POSTGRES_PASSWORD}@postgres:5432/marketplace"
    POOL_MODE: transaction
    MAX_CLIENT_CONN: 500
    DEFAULT_POOL_SIZE: 25
  ports:
    - "6432:5432"
  depends_on:
    - postgres
```

Update `DATABASE_URL` to `postgres://marketplace:password@pgbouncer:5432/marketplace`.

---

## Caveats

- `SERIALIZABLE` transactions (used by `inSerializableTx()`) work correctly in transaction mode.
- Prepared statements are not compatible with PgBouncer transaction mode — the `pg` driver does not use prepared statements by default, so this is not an issue.
- `LISTEN/NOTIFY` does not work through PgBouncer — if you add real-time features using NOTIFY in future, route those connections directly to PostgreSQL.
- PgBouncer is stateless — it can be replaced or restarted without losing data.

---

## Stage 2: read replica

For 50 k+ users, route read-heavy marketplace listing queries to a PostgreSQL read replica. The application does not yet differentiate between read and write pools (`pool.ts` exports a single `pool`). Stage 2 work: export a `readPool` pointing at the replica URL and use it in marketplace listing routes.
