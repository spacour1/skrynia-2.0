import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { redactSensitive } from "../src/common/audit-redact.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

/**
 * Security regression tests: nothing sensitive from a mutating request may end up in
 * audit_logs. The generic middleware must not persist request bodies, and the redactor
 * must scrub token-bearing params/query as defense in depth.
 */

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function auditRowsContaining(needle: string) {
  const result = await pool.query(
    `select count(*)::int as count from audit_logs
     where coalesce(request_body::text, '') ilike $1 or coalesce(metadata::text, '') ilike $1`,
    [`%${needle}%`]
  );
  return result.rows[0].count as number;
}

async function waitForAuditRow(endpointLike: string, attempts = 20) {
  // the audit insert is fire-and-forget on res 'finish'; poll briefly until it lands
  for (let i = 0; i < attempts; i += 1) {
    const result = await pool.query(`select count(*)::int as count from audit_logs where endpoint like $1`, [endpointLike]);
    if (result.rows[0].count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`audit row for ${endpointLike} never appeared`);
}

describe("audit logging does not capture secrets", () => {
  it("login request bodies (password) are not persisted", async () => {
    const secretPassword = `Sup3r-${randomUUID()}`;
    await request(app).post("/auth/login").send({ email: "someone@test.local", password: secretPassword });
    await waitForAuditRow("%login%");
    expect(await auditRowsContaining(secretPassword)).toBe(0);
  });

  it("support ticket bodies and delivery-note-like payloads are not persisted", async () => {
    const userId = await createUser("user");
    const session = await issueSession(userId, "user");
    const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
    const secretNote = `KEY-${randomUUID()}`;

    // Whatever the endpoint does with validation, the middleware audits every mutating
    // request - the assertion is that the secret never reaches audit_logs.
    await request(app)
      .post("/support/tickets")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", session.csrfToken)
      .send({ subject: "help", body: secretNote });
    await request(app)
      .post("/auth/2fa/verify")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", session.csrfToken)
      .send({ code: secretNote });

    await waitForAuditRow("%2fa%");
    expect(await auditRowsContaining(secretNote)).toBe(0);
  });

  it("audit rows still record the technical envelope", async () => {
    await request(app).post("/auth/login").send({ email: "someone@test.local", password: "x" });
    await waitForAuditRow("%login%");
    const row = await pool.query(
      `select method, endpoint, status_code, request_body from audit_logs where endpoint like '%login%' order by created_at desc limit 1`
    );
    expect(row.rows[0].method).toBe("POST");
    expect(row.rows[0].request_body).toBeNull();
    expect(row.rows[0].status_code).toBeGreaterThanOrEqual(400);
  });
});

describe("redactSensitive", () => {
  it("scrubs sensitive keys case-insensitively and recursively", () => {
    const result = redactSensitive({
      Password: "a",
      newPASSWORD: "b",
      refreshToken: "c",
      TOTPSecret: "d",
      nested: { backupCodes: ["1", "2"], iban: "UA123", note: "digital key", safe: "keep-me" },
      list: [{ cardNumber: "4111" }]
    }) as Record<string, unknown>;

    expect(result.Password).toBe("[redacted]");
    expect(result.newPASSWORD).toBe("[redacted]");
    expect(result.refreshToken).toBe("[redacted]");
    expect(result.TOTPSecret).toBe("[redacted]");
    expect((result.nested as Record<string, unknown>).backupCodes).toBe("[redacted]");
    expect((result.nested as Record<string, unknown>).iban).toBe("[redacted]");
    expect((result.nested as Record<string, unknown>).note).toBe("[redacted]");
    expect((result.nested as Record<string, unknown>).safe).toBe("keep-me");
    expect(((result.list as unknown[])[0] as Record<string, unknown>).cardNumber).toBe("[redacted]");
  });
});
