import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { redactSensitive } from "../src/common/audit-redact.js";
import { sanitizeSentryEvent } from "../src/common/middleware/request-context.js";
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

async function waitForAuditTrace(traceId: string, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    const result = await pool.query<{
      path: string;
      endpoint: string;
      metadata: { query?: Record<string, unknown> };
    }>(
      `select path, endpoint, metadata from audit_logs where trace_id = $1 order by created_at desc limit 1`,
      [traceId]
    );
    if (result.rows[0]) return result.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`audit row for trace ${traceId} never appeared`);
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

  it("removes query secrets from audit paths and captured structured logs", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });
    const capturedLogger = pino({ base: null, timestamp: false }, destination);
    const capturedApp = createApp({ requestLogger: capturedLogger });
    const secretValue = `secret-${randomUUID()}`;

    const response = await request(capturedApp).post(
      `/test?token=${encodeURIComponent(secretValue)}&safe=value&nested[secret]=${encodeURIComponent(secretValue)}`
    );
    const traceId = response.headers["x-trace-id"];
    expect(typeof traceId).toBe("string");

    const audit = await waitForAuditTrace(traceId as string);
    expect(audit.path).toBe("/test");
    expect(audit.endpoint).toBe("/test");
    expect(audit.path).not.toContain("?");
    expect(audit.endpoint).not.toContain("?");
    expect(audit.metadata.query?.token).toBe("[redacted]");
    expect(audit.metadata.query?.safe).toBe("value");
    expect(JSON.stringify(audit)).not.toContain(secretValue);

    const entries = chunks
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const httpLog = entries.find((entry) => entry.traceId === traceId && entry.msg === "http_request");
    expect(httpLog).toMatchObject({
      path: "/test",
      route: "/test",
      query: { token: "[redacted]", safe: "value" }
    });
    expect(JSON.stringify(httpLog)).not.toContain(secretValue);
  });
});

describe("redactSensitive", () => {
  it("scrubs sensitive keys case-insensitively and recursively", () => {
    const result = redactSensitive({
      Password: "a",
      newPASSWORD: "b",
      refreshToken: "c",
      TOTPSecret: "d",
      verificationCode: "e",
      wsTicket: "f",
      nested: { backupCodes: ["1", "2"], iban: "UA123", note: "digital key", safe: "keep-me" },
      list: [{ cardNumber: "4111" }]
    }) as Record<string, unknown>;

    expect(result.Password).toBe("[redacted]");
    expect(result.newPASSWORD).toBe("[redacted]");
    expect(result.refreshToken).toBe("[redacted]");
    expect(result.TOTPSecret).toBe("[redacted]");
    expect(result.verificationCode).toBe("[redacted]");
    expect(result.wsTicket).toBe("[redacted]");
    expect((result.nested as Record<string, unknown>).backupCodes).toBe("[redacted]");
    expect((result.nested as Record<string, unknown>).iban).toBe("[redacted]");
    expect((result.nested as Record<string, unknown>).note).toBe("[redacted]");
    expect((result.nested as Record<string, unknown>).safe).toBe("keep-me");
    expect(((result.list as unknown[])[0] as Record<string, unknown>).cardNumber).toBe("[redacted]");
  });

  it("removes URL queries and request payloads from Sentry events and breadcrumbs", () => {
    const secretValue = `ticket-${randomUUID()}`;
    const event = sanitizeSentryEvent({
      request: {
        url: `https://api.test/test?token=${secretValue}`,
        query_string: `token=${secretValue}`,
        data: { code: secretValue },
        cookies: { session: secretValue },
        headers: { authorization: secretValue, "x-safe": "keep-me" }
      },
      transaction: `POST /test?token=${secretValue}`,
      breadcrumbs: [
        {
          data: {
            url: `wss://api.test/ws?ticket=${secretValue}`,
            ticket: secretValue,
            nested: { path: `/test?secret=${secretValue}` }
          }
        }
      ]
    });

    expect(event.request).toEqual({
      url: "https://api.test/test",
      headers: { authorization: "[redacted]", "x-safe": "keep-me" }
    });
    expect(event.transaction).toBe("POST /test");
    expect(event.breadcrumbs?.[0].data).toMatchObject({
      url: "wss://api.test/ws",
      ticket: "[redacted]",
      nested: { path: "/test" }
    });
    expect(JSON.stringify(event)).not.toContain(secretValue);
  });
});
