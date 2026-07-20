import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import {
  confirmTwoFactor,
  disableTwoFactor,
  setupTwoFactor
} from "../src/modules/auth/twofa.service.js";
import { generateTotpCode } from "../src/modules/auth/totp.service.js";
import { closeDb, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

type SessionCookies = {
  cookieHeader: string[];
  csrfToken: string;
  accessToken: string;
  refreshToken: string;
  jti: string;
};

function parseSessionCookies(setCookie: string[]): SessionCookies {
  const values = new Map<string, string>();
  for (const cookie of setCookie) {
    const [pair] = cookie.split(";");
    const [name, ...rest] = pair.split("=");
    values.set(name.trim(), rest.join("="));
  }
  const accessToken = values.get("access_token") ?? "";
  const refreshToken = values.get("refresh_token") ?? "";
  const csrfToken = values.get("csrf_token") ?? "";
  const payload = jwt.verify(accessToken, process.env.JWT_SECRET!) as { jti: string };
  return {
    cookieHeader: [
      `access_token=${accessToken}`,
      `refresh_token=${refreshToken}`,
      `csrf_token=${csrfToken}`
    ],
    csrfToken,
    accessToken,
    refreshToken,
    jti: payload.jti
  };
}

async function registerSession(email = `${randomUUID()}@sv.local`, password = "Password-123") {
  const response = await request(app)
    .post("/auth/register")
    .send({ email, password, displayName: "Version User" })
    .expect(201);
  const session = parseSessionCookies(response.headers["set-cookie"] as unknown as string[]);
  return { email, password, userId: response.body.user.id as string, session };
}

async function loginSession(email: string, password: string) {
  const response = await request(app).post("/auth/login").send({ email, password }).expect(200);
  return parseSessionCookies(response.headers["set-cookie"] as unknown as string[]);
}

/**
 * Re-creates the Redis state of a session as if the revocation there had been lost
 * (crash, connection blip). The DB session-version check must reject it anyway.
 */
async function restoreRedisSession(userId: string, session: SessionCookies, version: number) {
  const redis = getRedis()!;
  const refreshHash = createHash("sha256").update(session.refreshToken).digest("hex");
  await redis.set(`session:${session.jti}`, userId, "EX", 900);
  await redis.set(`refresh:${refreshHash}`, JSON.stringify({ u: userId, v: version }), "EX", 3600);
  await redis.sadd(`user_sessions:${userId}`, session.jti);
  await redis.sadd(`user_refresh:${userId}`, refreshHash);
}

async function getSessionVersion(userId: string): Promise<number> {
  const result = await pool.query<{ sessionVersion: number }>(
    `select session_version as "sessionVersion" from users where id = $1`,
    [userId]
  );
  return result.rows[0].sessionVersion;
}

function me(session: SessionCookies) {
  return request(app).get("/auth/me").set("Cookie", session.cookieHeader);
}

function postWithCsrf(path: string, session: SessionCookies) {
  return request(app)
    .post(path)
    .set("Cookie", session.cookieHeader)
    .set("X-CSRF-Token", session.csrfToken);
}

describe("password change", () => {
  it("invalidates other sessions at the DB level and rotates the caller", async () => {
    const { email, password, userId, session: sessionA } = await registerSession();
    const sessionB = await loginSession(email, password);

    const response = await postWithCsrf("/users/me/password", sessionA)
      .send({ currentPassword: password, newPassword: "NewPassword-456!" })
      .expect(200);

    expect(await getSessionVersion(userId)).toBe(2);

    // The caller's response carries a fresh, working session.
    const rotated = parseSessionCookies(response.headers["set-cookie"] as unknown as string[]);
    await me(rotated).expect(200);

    // The other device is out - even if Redis "forgot" the revocation.
    await restoreRedisSession(userId, sessionB, 1);
    await me(sessionB).expect(401);
    await postWithCsrf("/auth/refresh", sessionB).expect(401);
  });
});

describe("password reset", () => {
  it("kills every existing session even when Redis revocation is lost", async () => {
    const { email, password, userId, session } = await registerSession();

    const redis = getRedis()!;
    const resetToken = `test-reset-${randomUUID()}`;
    await redis.set(`pwd_reset:${createHash("sha256").update(resetToken).digest("hex")}`, userId, "EX", 600);

    await request(app)
      .post("/auth/password/reset")
      .send({ token: resetToken, password: "AfterReset-789!" })
      .expect(200);

    expect(await getSessionVersion(userId)).toBe(2);

    await restoreRedisSession(userId, session, 1);
    await me(session).expect(401);
    await postWithCsrf("/auth/refresh", session).expect(401);

    await request(app).post("/auth/login").send({ email, password }).expect(400);
    await request(app).post("/auth/login").send({ email, password: "AfterReset-789!" }).expect(200);
  });
});

describe("logout-all", () => {
  it("bumps the version so restored Redis state cannot revive a session", async () => {
    const { email, password, userId, session: sessionA } = await registerSession();
    const sessionB = await loginSession(email, password);

    await postWithCsrf("/auth/logout-all", sessionA).expect(204);
    expect(await getSessionVersion(userId)).toBe(2);

    await restoreRedisSession(userId, sessionB, 1);
    await me(sessionB).expect(401);

    // A fresh login works and carries the new version.
    const fresh = await loginSession(email, password);
    await me(fresh).expect(200);
  });
});

describe("ban", () => {
  it("invalidates sessions durably when an admin bans the user", async () => {
    const { userId, session } = await registerSession();
    const admin = await registerSession();
    await pool.query(`update users set role = 'admin' where id = $1`, [admin.userId]);
    // Role is embedded in the access token; issue a fresh admin session after the change.
    const adminSession = await loginSession(admin.email, admin.password);

    await request(app)
      .patch(`/admin/users/${userId}`)
      .set("Cookie", adminSession.cookieHeader)
      .set("X-CSRF-Token", adminSession.csrfToken)
      .send({ isBanned: true })
      .expect(200);

    expect(await getSessionVersion(userId)).toBe(2);
    await restoreRedisSession(userId, session, 1);
    const response = await me(session);
    expect([401, 403]).toContain(response.status);
  });
});

describe("2FA lifecycle", () => {
  it("bumps the session version on enable and on disable", async () => {
    const { userId } = await registerSession();
    await pool.query(`update users set email_verified_at = now() where id = $1`, [userId]);

    const setup = await setupTwoFactor(userId, "sv-test@example.com", {});
    await confirmTwoFactor(userId, generateTotpCode(setup.secret));
    expect(await getSessionVersion(userId)).toBe(2);

    await disableTwoFactor(userId, { totpCode: generateTotpCode(setup.secret) });
    expect(await getSessionVersion(userId)).toBe(3);
  });
});

describe("legacy compatibility", () => {
  it("accepts a pre-rollout access token (no sv claim) until the first bump", async () => {
    const { userId, session } = await registerSession();

    // Forge a legacy token: same jti, no sv claim.
    const legacyToken = jwt.sign({ sub: userId, role: "user", jti: session.jti }, process.env.JWT_SECRET!, {
      expiresIn: "15m"
    });
    const legacyCookies = [
      `access_token=${legacyToken}`,
      `refresh_token=${session.refreshToken}`,
      `csrf_token=${session.csrfToken}`
    ];
    await request(app).get("/auth/me").set("Cookie", legacyCookies).expect(200);

    await pool.query(`update users set session_version = session_version + 1 where id = $1`, [userId]);
    await request(app).get("/auth/me").set("Cookie", legacyCookies).expect(401);
  });

  it("treats a legacy plain-string refresh record as version 1", async () => {
    const { userId, session } = await registerSession();
    const redis = getRedis()!;
    const refreshHash = createHash("sha256").update(session.refreshToken).digest("hex");
    // Overwrite the JSON record with the legacy format (plain user id).
    await redis.set(`refresh:${refreshHash}`, userId, "EX", 3600);

    await postWithCsrf("/auth/refresh", session).expect(200);

    await pool.query(`update users set session_version = session_version + 1 where id = $1`, [userId]);
    await redis.set(`refresh:${refreshHash}`, userId, "EX", 3600);
    await postWithCsrf("/auth/refresh", session).expect(401);
  });
});
