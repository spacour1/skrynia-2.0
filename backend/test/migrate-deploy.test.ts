import { describe, expect, it } from "vitest";
import {
  RELEASE_MIGRATION_LOCK_ID,
  runReleaseMigrations,
  type ReleaseMigrationClient
} from "../src/db/migrate-deploy.js";

function clientWithEvents(events: string[]): ReleaseMigrationClient {
  return {
    async connect() {
      events.push("connect");
    },
    async query(text, values) {
      if (text.includes("pg_advisory_lock(")) events.push(`lock:${String(values?.[0])}`);
      if (text.includes("pg_advisory_unlock(")) events.push(`unlock:${String(values?.[0])}`);
      return { rows: [] };
    },
    async end() {
      events.push("end");
    }
  };
}

describe("release migrations", () => {
  it("holds one stable advisory lock across SQL and legacy-secret migrations", async () => {
    const events: string[] = [];
    const result = await runReleaseMigrations({
      databaseUrl: "postgres://test.invalid/release",
      createClient: () => clientWithEvents(events),
      runSqlMigrations: async () => {
        events.push("sql");
        return 3;
      },
      migrateLegacySecrets: async () => {
        events.push("legacy");
        return 2;
      }
    });

    expect(result).toEqual({ sqlMigrations: 3, legacyTwoFactorSecrets: 2 });
    expect(events).toEqual([
      "connect",
      `lock:${RELEASE_MIGRATION_LOCK_ID}`,
      "sql",
      "legacy",
      `unlock:${RELEASE_MIGRATION_LOCK_ID}`,
      "end"
    ]);
  });

  it("treats a repeated no-op migration as a successful release", async () => {
    const results = [4, 0];
    for (const expected of results) {
      await expect(
        runReleaseMigrations({
          databaseUrl: "postgres://test.invalid/release",
          createClient: () => clientWithEvents([]),
          runSqlMigrations: async () => expected,
          migrateLegacySecrets: async () => 0
        })
      ).resolves.toEqual({ sqlMigrations: expected, legacyTwoFactorSecrets: 0 });
    }
  });

  it("serializes concurrent release jobs", async () => {
    let lockTail = Promise.resolve();
    let active = 0;
    let maxActive = 0;

    const createSerializedClient = (): ReleaseMigrationClient => {
      let releaseOwnLock: (() => void) | undefined;
      return {
        async connect() {},
        async query(text) {
          if (text.includes("pg_advisory_lock(")) {
            const previous = lockTail;
            lockTail = new Promise<void>((resolve) => {
              releaseOwnLock = resolve;
            });
            await previous;
          } else if (text.includes("pg_advisory_unlock(")) {
            releaseOwnLock?.();
          }
          return { rows: [] };
        },
        async end() {}
      };
    };

    const run = () =>
      runReleaseMigrations({
        databaseUrl: "postgres://test.invalid/release",
        createClient: createSerializedClient,
        runSqlMigrations: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return 0;
        },
        migrateLegacySecrets: async () => 0
      });

    await Promise.all([run(), run()]);
    expect(maxActive).toBe(1);
  });

  it("releases the advisory lock and connection when migration fails", async () => {
    const events: string[] = [];
    await expect(
      runReleaseMigrations({
        databaseUrl: "postgres://test.invalid/release",
        createClient: () => clientWithEvents(events),
        runSqlMigrations: async () => {
          events.push("sql");
          throw new Error("migration failed");
        },
        migrateLegacySecrets: async () => 0
      })
    ).rejects.toThrow("migration failed");

    expect(events).toEqual([
      "connect",
      `lock:${RELEASE_MIGRATION_LOCK_ID}`,
      "sql",
      `unlock:${RELEASE_MIGRATION_LOCK_ID}`,
      "end"
    ]);
  });
});
