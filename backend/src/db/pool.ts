import pg from "pg";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import { transactionRetryExhaustedTotal, transactionRetryTotal } from "../common/metrics.js";
import { currentTraceId } from "../common/trace-context.js";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  connectionTimeoutMillis: env.PG_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: 30_000
});

let poolClosePromise: Promise<void> | null = null;

/** The process entrypoint is the only owner allowed to close the shared pool. */
export function closeDbPool() {
  poolClosePromise ??= pool.end();
  return poolClosePromise;
}

export type DbClient = pg.PoolClient | pg.Pool;

export type TransactionRetryOptions = {
  /** Total attempts including the first one. Default 3. Use 1 to opt out of retries. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

// serialization_failure and deadlock_detected: PostgreSQL explicitly documents both as
// "retry the transaction" outcomes of concurrent SERIALIZABLE/row-lock traffic. Nothing
// else is retried - a constraint violation or business error will fail identically on
// every attempt.
const RETRYABLE_TX_CODES = new Set(["40001", "40P01"]);

function retryableTxCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_TX_CODES.has(code)) return code;
  }
  return null;
}

export async function inTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTxWithIsolation("READ COMMITTED", fn);
}

/**
 * SERIALIZABLE transaction with bounded retries on transient concurrency failures.
 * Each attempt runs the callback in a fresh transaction; the previous attempt was
 * rolled back before the retry starts.
 *
 * The callback MUST NOT perform non-idempotent external side effects (emails, HTTP
 * provider calls, queue publishes) - a retry would repeat them. Idempotent Redis
 * cache deletes are tolerated. Callers that do talk to an external provider inside
 * the transaction (see lockEscrow) must pass `{ maxAttempts: 1 }`.
 */
export async function inSerializableTx<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  options: TransactionRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 20;
  const maxDelayMs = options.maxDelayMs ?? 200;
  // HTTP work inherits the request trace; background work still gets one stable
  // transaction trace shared by every attempt, rather than unrelated log lines.
  const traceId = currentTraceId() ?? randomUUID();

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await inTxWithIsolation("SERIALIZABLE", fn);
    } catch (error) {
      const code = retryableTxCode(error);
      if (!code) throw error;
      if (attempt >= maxAttempts) {
        transactionRetryExhaustedTotal.labels(code).inc();
        logger.warn(
          { traceId, code, attempt, maxAttempts },
          "serializable_tx_retries_exhausted"
        );
        throw error;
      }
      transactionRetryTotal.labels(code).inc();
      // Full jitter over an exponentially growing cap keeps colliding transactions
      // from re-colliding in lockstep.
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.round(cap * (0.5 + Math.random() * 0.5));
      logger.warn(
        { traceId, code, attempt, maxAttempts, delayMs },
        "serializable_tx_retry"
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function inTxWithIsolation<T>(
  isolationLevel: "READ COMMITTED" | "SERIALIZABLE",
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
