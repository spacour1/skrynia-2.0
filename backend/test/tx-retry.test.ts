import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inSerializableTx, pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { closeDb, resetDb } from "./fixtures.js";

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

function pgError(code: string) {
  const error = new Error(`fabricated ${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

describe("inSerializableTx retry", () => {
  it("retries a serialization_failure (40001) and succeeds", async () => {
    let attempts = 0;
    const result = await inSerializableTx(async () => {
      attempts += 1;
      if (attempts === 1) throw pgError("40001");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries a deadlock_detected (40P01) and succeeds", async () => {
    let attempts = 0;
    const result = await inSerializableTx(async () => {
      attempts += 1;
      if (attempts === 1) throw pgError("40P01");
      return attempts;
    });
    expect(result).toBe(2);
  });

  it("does not retry arbitrary errors", async () => {
    let attempts = 0;
    await expect(
      inSerializableTx(async () => {
        attempts += 1;
        throw pgError("23505");
      })
    ).rejects.toThrow(/23505/);
    expect(attempts).toBe(1);
  });

  it("gives up after max attempts and rethrows the last error", async () => {
    let attempts = 0;
    await expect(
      inSerializableTx(
        async () => {
          attempts += 1;
          throw pgError("40001");
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 }
      )
    ).rejects.toThrow(/40001/);
    expect(attempts).toBe(3);
  });

  it("runs a successful callback exactly once", async () => {
    let attempts = 0;
    await inSerializableTx(async () => {
      attempts += 1;
    });
    expect(attempts).toBe(1);
  });

  it("rolls back the failed attempt before retrying", async () => {
    const email = `${randomUUID()}@retry.local`;
    let attempts = 0;
    await inSerializableTx(
      async (client) => {
        attempts += 1;
        if (attempts === 1) {
          await client.query(`insert into users(email, display_name, role) values ($1, 'Attempt1', 'user')`, [email]);
          throw pgError("40001");
        }
        // The first attempt's insert must have been rolled back, or this second
        // insert would hit the unique constraint.
        const existing = await client.query(`select count(*)::int as count from users where email = $1`, [email]);
        expect(existing.rows[0].count).toBe(0);
        await client.query(`insert into users(email, display_name, role) values ($1, 'Attempt2', 'user')`, [email]);
      },
      { baseDelayMs: 1 }
    );
    const rows = await pool.query<{ display_name: string }>(`select display_name from users where email = $1`, [email]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].display_name).toBe("Attempt2");
  });

  it("respects maxAttempts: 1 (no retry) for side-effectful callers", async () => {
    let attempts = 0;
    await expect(
      inSerializableTx(
        async () => {
          attempts += 1;
          throw pgError("40001");
        },
        { maxAttempts: 1 }
      )
    ).rejects.toThrow(/40001/);
    expect(attempts).toBe(1);
  });
});
