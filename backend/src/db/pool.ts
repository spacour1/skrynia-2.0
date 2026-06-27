import pg from "pg";
import { env } from "../config/env.js";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000
});

export type DbClient = pg.PoolClient | pg.Pool;

export async function inTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTxWithIsolation("READ COMMITTED", fn);
}

export async function inSerializableTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTxWithIsolation("SERIALIZABLE", fn);
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
