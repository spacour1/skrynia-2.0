import bcrypt from "bcryptjs";
import type { Express } from "express";
import type Redis from "ioredis";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type TestSession = {
  accessToken: string;
  csrfToken: string;
  jti: string;
};

let app: Express;
let db: Pool;
let redis: Redis;
let resetDb: () => Promise<void>;
let closeDb: () => Promise<void>;
let createUser: (role?: "user" | "moderator" | "admin") => Promise<string>;
let issueSession: (userId: string, role: "user" | "moderator" | "admin") => Promise<TestSession>;

beforeAll(async () => {
  process.env.TRUST_PROXY = "1";
  process.env.ANONYMOUS_WRITE_RATE_LIMIT_PER_MIN = "100";
  process.env.CREDENTIAL_RATE_LIMIT_PER_15MIN = "2";
  process.env.CREDENTIAL_RATE_LIMIT_PER_IDENTITY_15MIN = "2";
  process.env.AUTHENTICATED_WRITE_RATE_LIMIT_PER_MIN = "2";
  process.env.AUTHENTICATED_WRITE_RATE_LIMIT_PER_IP = "3";
  process.env.WS_TICKET_RATE_LIMIT_PER_MIN = "2";
  process.env.WS_TICKET_RATE_LIMIT_PER_IP = "2";
  process.env.PHONE_OTP_RATE_LIMIT_PER_15MIN = "100";
  process.env.PHONE_OTP_RATE_LIMIT_PER_IP_15MIN = "100";
  process.env.EMAIL_VERIFICATION_RATE_LIMIT_PER_15MIN = "100";
  process.env.EMAIL_VERIFICATION_RATE_LIMIT_PER_IP_15MIN = "100";
  process.env.PASSWORD_RESET_RATE_LIMIT_PER_15MIN = "100";
  process.env.PASSWORD_RESET_RATE_LIMIT_PER_IP_15MIN = "100";
  process.env.WEBHOOK_RATE_LIMIT_PER_MIN = "100";

  vi.resetModules();
  const [
    appModule,
    dbModule,
    redisModule,
    fixturesModule,
    sessionModule
  ] = await Promise.all([
    import("../src/app.js"),
    import("../src/db/pool.js"),
    import("../src/common/redis.js"),
    import("./fixtures.js"),
    import("../src/modules/auth/session.service.js")
  ]);

  app = appModule.createApp();
  db = dbModule.pool;
  const redisClient = redisModule.getRedis();
  if (!redisClient) throw new Error("Rate-limit integration tests require Redis");
  redis = redisClient;
  resetDb = fixturesModule.resetDb;
  closeDb = fixturesModule.closeDb;
  createUser = fixturesModule.createUser;
  issueSession = sessionModule.issueSession;
});

beforeEach(async () => {
  await resetDb();
  const keys = await redis.keys("rl:*");
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  const keys = await redis.keys("rl:*");
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
  await closeDb();
});

async function sessionFor(userId: string) {
  const session = await issueSession(userId, "user");
  return {
    cookie: [
      `access_token=${session.accessToken}`,
      `csrf_token=${session.csrfToken}`
    ].join("; "),
    csrf: session.csrfToken
  };
}

function updatePreferences(
  session: Awaited<ReturnType<typeof sessionFor>>,
  ip: string
) {
  return request(app)
    .patch("/users/me/notifications/preferences")
    .set("X-Forwarded-For", ip)
    .set("Cookie", session.cookie)
    .set("X-CSRF-Token", session.csrf)
    .send({ emailEnabled: true });
}

async function userWithPassword() {
  const userId = await createUser();
  const email = `${userId}@test.local`;
  const password = "Valid-password-1!";
  const passwordHash = await bcrypt.hash(password, 4);
  await db.query(`update users set password_hash = $2 where id = $1`, [
    userId,
    passwordHash
  ]);
  return { userId, email, password };
}

function login(email: string, password: string, ip: string) {
  return request(app)
    .post("/auth/login")
    .set("X-Forwarded-For", ip)
    .send({ email, password });
}

function wsTicket(
  session: Awaited<ReturnType<typeof sessionFor>>,
  ip: string
) {
  return request(app)
    .post("/auth/ws-ticket")
    .set("X-Forwarded-For", ip)
    .set("Cookie", session.cookie)
    .set("X-CSRF-Token", session.csrf);
}

describe("separated rate limits", () => {
  it("keeps authenticated user buckets separate behind one IP and returns Retry-After", async () => {
    const firstSession = await sessionFor(await createUser());
    const secondSession = await sessionFor(await createUser());
    const sharedIp = "198.51.100.10";

    expect((await updatePreferences(firstSession, sharedIp)).status).toBe(200);
    expect((await updatePreferences(firstSession, sharedIp)).status).toBe(200);

    const limited = await updatePreferences(firstSession, sharedIp);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    expect(limited.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
    expect(limited.body.error.retryAfterSeconds).toBe(
      Number(limited.headers["retry-after"])
    );

    expect((await updatePreferences(secondSession, sharedIp)).status).toBe(200);
  });

  it("enforces one user ceiling even when the source IP changes", async () => {
    const session = await sessionFor(await createUser());

    expect((await updatePreferences(session, "198.51.100.21")).status).toBe(200);
    expect((await updatePreferences(session, "198.51.100.22")).status).toBe(200);
    expect((await updatePreferences(session, "198.51.100.23")).status).toBe(429);
  });

  it("also enforces the aggregate authenticated IP ceiling", async () => {
    const sessions = await Promise.all([
      sessionFor(await createUser()),
      sessionFor(await createUser()),
      sessionFor(await createUser()),
      sessionFor(await createUser())
    ]);
    const sharedIp = "198.51.100.30";

    expect((await updatePreferences(sessions[0], sharedIp)).status).toBe(200);
    expect((await updatePreferences(sessions[1], sharedIp)).status).toBe(200);
    expect((await updatePreferences(sessions[2], sharedIp)).status).toBe(200);
    expect((await updatePreferences(sessions[3], sharedIp)).status).toBe(429);
  });

  it("does not let the WS ticket bucket block login", async () => {
    const credentials = await userWithPassword();
    const session = await sessionFor(credentials.userId);
    const sharedIp = "198.51.100.40";

    expect((await wsTicket(session, sharedIp)).status).toBe(201);
    expect((await wsTicket(session, sharedIp)).status).toBe(201);
    expect((await wsTicket(session, sharedIp)).status).toBe(429);

    expect(
      (await login(credentials.email, credentials.password, sharedIp)).status
    ).toBe(200);
  });

  it("does not let the login bucket block WS reconnect tickets", async () => {
    const credentials = await userWithPassword();
    const session = await sessionFor(credentials.userId);
    const sharedIp = "198.51.100.50";

    expect(
      (await login(credentials.email, credentials.password, sharedIp)).status
    ).toBe(200);
    expect(
      (await login(credentials.email, credentials.password, sharedIp)).status
    ).toBe(200);
    expect(
      (await login(credentials.email, credentials.password, sharedIp)).status
    ).toBe(429);

    expect((await wsTicket(session, sharedIp)).status).toBe(201);
  });

  it("hashes credential identity and applies its ceiling across IPs", async () => {
    const credentials = await userWithPassword();

    expect(
      (await login(credentials.email, credentials.password, "198.51.100.61")).status
    ).toBe(200);
    expect(
      (await login(credentials.email, credentials.password, "198.51.100.62")).status
    ).toBe(200);
    expect(
      (await login(credentials.email, credentials.password, "198.51.100.63")).status
    ).toBe(429);

    const keys = await redis.keys("rl:credential:identity:*");
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join("\n")).not.toContain(credentials.email);
  });
});
