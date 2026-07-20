import { createHash } from "node:crypto";
import type pg from "pg";
import { ApiError } from "../../common/errors.js";
import { inTx } from "../../db/pool.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const EXPIRED_CLEANUP_BATCH_SIZE = 100;

type StoredIdempotencyRow = {
  id: string;
  requestHash: string;
  status: "processing" | "completed";
  responseStatus: number | null;
  responseBody: unknown;
  resourceId: string | null;
};

type IdempotentResponse<T> = {
  statusCode: number;
  body: T;
  resourceId?: string;
};

export type IdempotentTransactionResult<T> = IdempotentResponse<T> & {
  replayed: boolean;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) sorted[key] = canonicalize(record[key]);
  }
  return sorted;
}

export function hashIdempotencyPayload(payload: unknown) {
  const canonical = JSON.stringify(canonicalize(payload));
  return createHash("sha256").update(canonical).digest("hex");
}

function normalizeResponseBody<T>(body: T): T {
  const serialized = JSON.stringify(body);
  if (serialized === undefined) {
    throw new Error("Idempotent response body must be JSON serializable");
  }
  return JSON.parse(serialized) as T;
}

async function cleanupExpiredKeys(
  client: pg.PoolClient,
  input: { userId: string; scope: string; key: string }
) {
  await client.query(
    `delete from idempotency_keys
     where user_id = $1 and scope = $2 and key = $3 and expires_at <= now()`,
    [input.userId, input.scope, input.key]
  );
  await client.query(
    `delete from idempotency_keys
     where id in (
       select id
       from idempotency_keys
       where expires_at <= now()
       order by expires_at
       for update skip locked
       limit $1
     )`,
    [EXPIRED_CLEANUP_BATCH_SIZE]
  );
}

export async function runIdempotentTransaction<T>(input: {
  userId: string;
  scope: string;
  key: string;
  requestHash: string;
  ttlMs?: number;
  execute: (client: pg.PoolClient) => Promise<IdempotentResponse<T>>;
}): Promise<IdempotentTransactionResult<T>> {
  return inTx(async (client) => {
    await cleanupExpiredKeys(client, input);

    const claim = await client.query<{ id: string }>(
      `insert into idempotency_keys(
         user_id, scope, key, request_hash, status, expires_at
       )
       values ($1, $2, $3, $4, 'processing', $5)
       on conflict (user_id, scope, key) do nothing
       returning id`,
      [
        input.userId,
        input.scope,
        input.key,
        input.requestHash,
        new Date(Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString()
      ]
    );

    if (!claim.rows[0]) {
      const existing = await client.query<StoredIdempotencyRow>(
        `select id, request_hash as "requestHash", status,
                response_status as "responseStatus",
                response_body as "responseBody",
                resource_id as "resourceId"
         from idempotency_keys
         where user_id = $1 and scope = $2 and key = $3`,
        [input.userId, input.scope, input.key]
      );
      const row = existing.rows[0];
      if (!row) {
        throw new Error("Idempotency key conflicted but could not be read");
      }
      if (row.requestHash !== input.requestHash) {
        throw new ApiError(
          409,
          "This idempotency key was already used with a different request",
          "idempotency_key_reused"
        );
      }
      if (
        row.status !== "completed" ||
        row.responseStatus === null ||
        row.responseBody === null
      ) {
        throw new ApiError(
          409,
          "A request with this idempotency key is still processing",
          "idempotency_in_progress"
        );
      }
      return {
        statusCode: row.responseStatus,
        body: row.responseBody as T,
        resourceId: row.resourceId ?? undefined,
        replayed: true
      };
    }

    const executed = await input.execute(client);
    const responseBody = normalizeResponseBody(executed.body);
    const completed = await client.query(
      `update idempotency_keys
       set status = 'completed',
           response_status = $2,
           response_body = $3,
           resource_id = $4
       where id = $1 and status = 'processing'`,
      [
        claim.rows[0].id,
        executed.statusCode,
        JSON.stringify(responseBody),
        executed.resourceId ?? null
      ]
    );
    if (completed.rowCount !== 1) {
      throw new Error("Idempotency result could not be completed");
    }

    return {
      ...executed,
      body: responseBody,
      replayed: false
    };
  });
}
