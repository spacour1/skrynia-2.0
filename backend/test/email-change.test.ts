import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import {
  requestEmailChange,
  type EmailChangeDependencies
} from "../src/modules/auth/email-change.service.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import {
  consumeStepUpToken,
  type StepUpPurpose
} from "../src/modules/auth/step-up.service.js";
import {
  confirmTwoFactor,
  setupTwoFactor
} from "../src/modules/auth/twofa.service.js";
import { generateTotpCode } from "../src/modules/auth/totp.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

const app = createApp();
const PASSWORD = "CurrentPassword1!";

type Session = {
  cookies: string[];
  csrfToken: string;
  sessionId: string;
  sessionVersion: number;
};

type Account = {
  userId: string;
  email: string;
  password: string;
  session: Session;
};

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

function parseSession(setCookie: string[]): Session {
  const values = new Map<string, string>();
  for (const cookie of setCookie) {
    const [pair] = cookie.split(";");
    const [name, ...rest] = pair.split("=");
    values.set(name, rest.join("="));
  }
  const accessToken = values.get("access_token")!;
  const payload = jwt.verify(accessToken, process.env.JWT_SECRET!) as {
    jti: string;
    sv: number;
  };
  return {
    cookies: [
      `access_token=${accessToken}`,
      `refresh_token=${values.get("refresh_token")}`,
      `csrf_token=${values.get("csrf_token")}`
    ],
    csrfToken: values.get("csrf_token")!,
    sessionId: payload.jti,
    sessionVersion: payload.sv
  };
}

async function registerAccount(email = `${randomUUID()}@email-change.local`): Promise<Account> {
  const response = await request(app)
    .post("/auth/register")
    .send({ email, password: PASSWORD, displayName: "Email Change User" })
    .expect(201);
  return {
    userId: response.body.user.id as string,
    email,
    password: PASSWORD,
    session: parseSession(response.headers["set-cookie"] as unknown as string[])
  };
}

async function loginAccount(email: string, password = PASSWORD) {
  const response = await request(app)
    .post("/auth/login")
    .send({ email, password })
    .expect(200);
  return parseSession(response.headers["set-cookie"] as unknown as string[]);
}

function authedPost(path: string, session: Session) {
  return request(app)
    .post(path)
    .set("Cookie", session.cookies)
    .set("X-CSRF-Token", session.csrfToken);
}

function authedPatch(path: string, session: Session) {
  return request(app)
    .patch(path)
    .set("Cookie", session.cookies)
    .set("X-CSRF-Token", session.csrfToken);
}

async function passwordStepUp(account: Account) {
  const response = await authedPost("/users/me/step-up", account.session)
    .send({
      purpose: "change_email",
      method: "password",
      currentPassword: account.password
    })
    .expect(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body.expiresInSeconds).toBe(300);
  return response.body.stepUpToken as string;
}

function requestChange(account: Account, email: string, stepUpToken: string) {
  return authedPost("/users/me/email-change/request", account.session)
    .send({ email, stepUpToken });
}

function tokenFromDebugUrl(body: { debugConfirmationUrl?: string }) {
  expect(body.debugConfirmationUrl).toBeTruthy();
  return new URL(body.debugConfirmationUrl!).searchParams.get("token")!;
}

describe("secure email change", () => {
  it("keeps the old email active until confirmation, then revokes every session and rejects replay", async () => {
    const account = await registerAccount();
    const otherSession = await loginAccount(account.email);
    await pool.query(`update users set email_verified_at = now() where id = $1`, [account.userId]);
    const nextEmail = `${randomUUID()}@new-email.local`;
    const stepUpToken = await passwordStepUp(account);

    const pending = await requestChange(account, nextEmail, stepUpToken).expect(202);
    expect(pending.headers["cache-control"]).toBe("no-store");
    const confirmationToken = tokenFromDebugUrl(pending.body);

    const before = await pool.query<{
      email: string;
      verified: boolean;
      pendingEmail: string;
      deliveryConfirmed: boolean;
    }>(
      `select u.email, (u.email_verified_at is not null) as verified,
              e.pending_email as "pendingEmail",
              e.delivery_confirmed as "deliveryConfirmed"
       from users u
       join user_email_change_requests e on e.user_id = u.id
       where u.id = $1`,
      [account.userId]
    );
    expect(before.rows[0]).toMatchObject({
      email: account.email,
      verified: true,
      pendingEmail: nextEmail,
      deliveryConfirmed: true
    });

    const me = await request(app)
      .get("/users/me")
      .set("Cookie", account.session.cookies)
      .expect(200);
    expect(me.body.user.email).toBe(account.email);
    expect(me.body.user.pendingEmail).toBe(nextEmail);
    expect(me.body.user.pendingEmailExpiresAt).toBeTruthy();

    await request(app)
      .post("/users/email-change/confirm")
      .send({ token: confirmationToken })
      .expect(200);

    const after = await pool.query<{
      email: string;
      verified: boolean;
      sessionVersion: number;
      pendingCount: string;
    }>(
      `select email, (email_verified_at is not null) as verified,
              session_version as "sessionVersion",
              (select count(*) from user_email_change_requests where user_id = users.id)::text as "pendingCount"
       from users where id = $1`,
      [account.userId]
    );
    expect(after.rows[0]).toEqual({
      email: nextEmail,
      verified: true,
      sessionVersion: 2,
      pendingCount: "0"
    });

    await request(app).get("/auth/me").set("Cookie", account.session.cookies).expect(401);
    await request(app).get("/auth/me").set("Cookie", otherSession.cookies).expect(401);
    await authedPost("/auth/refresh", otherSession).expect(401);
    await request(app).post("/auth/login").send({ email: account.email, password: PASSWORD }).expect(400);
    await request(app).post("/auth/login").send({ email: nextEmail, password: PASSWORD }).expect(200);

    await request(app)
      .post("/users/email-change/confirm")
      .send({ token: confirmationToken })
      .expect(400);
  });

  it("rejects direct profile email mutation and a stolen session without step-up", async () => {
    const account = await registerAccount();
    const nextEmail = `${randomUUID()}@blocked.local`;

    await authedPatch("/users/me", account.session)
      .send({ email: nextEmail })
      .expect(400);
    await requestChange(account, nextEmail, "x".repeat(43)).expect(401);

    const state = await pool.query<{ email: string; pendingCount: string }>(
      `select email,
              (select count(*) from user_email_change_requests where user_id = users.id)::text as "pendingCount"
       from users where id = $1`,
      [account.userId]
    );
    expect(state.rows[0]).toEqual({ email: account.email, pendingCount: "0" });
  });

  it("binds a one-use step-up token to purpose, session, version, and user", async () => {
    const account = await registerAccount();
    const stepUpToken = await passwordStepUp(account);
    const base = {
      userId: account.userId,
      sessionId: account.session.sessionId,
      sessionVersion: account.session.sessionVersion,
      purpose: "change_email" as const,
      stepUpToken
    };
    const expectedKey = `step_up:${createHash("sha256").update(stepUpToken).digest("hex")}`;
    const redis = getRedis()!;
    expect(await redis.get(expectedKey)).not.toContain(stepUpToken);
    expect((await redis.keys("step_up:*")).some((key) => key.includes(stepUpToken))).toBe(false);

    await expect(
      consumeStepUpToken({
        ...base,
        purpose: "change_password" as StepUpPurpose
      })
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      consumeStepUpToken({ ...base, sessionId: randomUUID() })
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      consumeStepUpToken({ ...base, sessionVersion: base.sessionVersion + 1 })
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      consumeStepUpToken({ ...base, userId: randomUUID() })
    ).rejects.toMatchObject({ status: 401 });

    await consumeStepUpToken(base);
    await expect(consumeStepUpToken(base)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects expired, non-delivered, and stale-session confirmation tokens", async () => {
    const expired = await registerAccount();
    const expiredPending = await requestChange(
      expired,
      `${randomUUID()}@expired.local`,
      await passwordStepUp(expired)
    ).expect(202);
    const expiredToken = tokenFromDebugUrl(expiredPending.body);
    await pool.query(
      `update user_email_change_requests set expires_at = now() - interval '1 second' where user_id = $1`,
      [expired.userId]
    );
    await request(app)
      .post("/users/email-change/confirm")
      .send({ token: expiredToken })
      .expect(400);

    const undelivered = await registerAccount();
    const undeliveredPending = await requestChange(
      undelivered,
      `${randomUUID()}@undelivered.local`,
      await passwordStepUp(undelivered)
    ).expect(202);
    const undeliveredToken = tokenFromDebugUrl(undeliveredPending.body);
    await pool.query(
      `update user_email_change_requests set delivery_confirmed = false where user_id = $1`,
      [undelivered.userId]
    );
    await request(app)
      .post("/users/email-change/confirm")
      .send({ token: undeliveredToken })
      .expect(400);

    const stale = await registerAccount();
    const stalePending = await requestChange(
      stale,
      `${randomUUID()}@stale-session.local`,
      await passwordStepUp(stale)
    ).expect(202);
    const staleToken = tokenFromDebugUrl(stalePending.body);
    await pool.query(
      `update users set session_version = session_version + 1 where id = $1`,
      [stale.userId]
    );
    await request(app)
      .post("/users/email-change/confirm")
      .send({ token: staleToken })
      .expect(400);
    const staleEmail = await pool.query<{ email: string }>(
      `select email from users where id = $1`,
      [stale.userId]
    );
    expect(staleEmail.rows[0].email).toBe(stale.email);
  });

  it("rejects a duplicate pending address without changing either active email", async () => {
    const first = await registerAccount();
    const second = await registerAccount();
    const sharedPendingEmail = `${randomUUID()}@shared-pending.local`;

    await requestChange(first, sharedPendingEmail, await passwordStepUp(first)).expect(202);
    await requestChange(second, sharedPendingEmail, await passwordStepUp(second)).expect(409);

    const users = await pool.query<{ id: string; email: string }>(
      `select id, email from users where id = any($1::uuid[]) order by id`,
      [[first.userId, second.userId]]
    );
    expect(users.rows.map((row) => row.email).sort()).toEqual(
      [first.email, second.email].sort()
    );
  });

  it("reclaims expired and session-version-stale pending addresses", async () => {
    const first = await registerAccount();
    const second = await registerAccount();
    const third = await registerAccount();
    const releasedEmail = `${randomUUID()}@released-pending.local`;

    await requestChange(first, releasedEmail, await passwordStepUp(first)).expect(202);
    await pool.query(
      `update user_email_change_requests
       set expires_at = now() - interval '1 second'
       where user_id = $1`,
      [first.userId]
    );

    await requestChange(second, releasedEmail, await passwordStepUp(second)).expect(202);

    await pool.query(
      `update users set session_version = session_version + 1 where id = $1`,
      [second.userId]
    );
    await requestChange(third, releasedEmail, await passwordStepUp(third)).expect(202);

    const pending = await pool.query<{ userId: string; pendingEmail: string }>(
      `select user_id as "userId", pending_email as "pendingEmail"
       from user_email_change_requests
       where pending_email = $1`,
      [releasedEmail]
    );
    expect(pending.rows).toEqual([
      { userId: third.userId, pendingEmail: releasedEmail }
    ]);
  });

  it("delivers to both addresses and removes pending state on provider failure", async () => {
    const delivered = await registerAccount();
    const nextEmail = `${randomUUID()}@delivery.local`;
    const deliveredTo: string[] = [];
    const deliveredToken = await passwordStepUp(delivered);
    const sendEmail: EmailChangeDependencies["sendEmail"] = async (message) => {
      deliveredTo.push(message.to);
      return true;
    };

    await requestEmailChange(
      {
        userId: delivered.userId,
        sessionId: delivered.session.sessionId,
        sessionVersion: delivered.session.sessionVersion,
        pendingEmail: nextEmail,
        stepUpToken: deliveredToken,
        locale: "en"
      },
      { sendEmail }
    );
    expect(deliveredTo.sort()).toEqual([delivered.email, nextEmail].sort());

    const failed = await registerAccount();
    const failedToken = await passwordStepUp(failed);
    await expect(
      requestEmailChange(
        {
          userId: failed.userId,
          sessionId: failed.session.sessionId,
          sessionVersion: failed.session.sessionVersion,
          pendingEmail: `${randomUUID()}@provider-failure.local`,
          stepUpToken: failedToken,
          locale: "en"
        },
        { sendEmail: async () => { throw new Error("provider unavailable"); } }
      )
    ).rejects.toMatchObject({ status: 503 });

    const failedState = await pool.query<{ email: string; pendingCount: string }>(
      `select email,
              (select count(*) from user_email_change_requests where user_id = users.id)::text as "pendingCount"
       from users where id = $1`,
      [failed.userId]
    );
    expect(failedState.rows[0]).toEqual({
      email: failed.email,
      pendingCount: "0"
    });
  });

  it("fails closed on Redis consume failure without creating pending identity state", async () => {
    const account = await registerAccount();
    const stepUpToken = await passwordStepUp(account);
    const redis = getRedis()!;
    const evalSpy = vi.spyOn(redis, "eval").mockRejectedValueOnce(new Error("redis unavailable"));
    try {
      await requestChange(
        account,
        `${randomUUID()}@redis-failure.local`,
        stepUpToken
      ).expect(503);
    } finally {
      evalSpy.mockRestore();
    }
    const pending = await pool.query(
      `select 1 from user_email_change_requests where user_id = $1`,
      [account.userId]
    );
    expect(pending.rows).toHaveLength(0);
  });

  it("requires password for non-2FA accounts and TOTP or backup code for 2FA accounts", async () => {
    const account = await registerAccount();
    await authedPost("/users/me/step-up", account.session)
      .send({ purpose: "change_email", method: "password", currentPassword: "wrong" })
      .expect(401);
    await authedPost("/users/me/step-up", account.session)
      .send({ purpose: "change_email", method: "two_factor", code: "123456" })
      .expect(401);
    await passwordStepUp(account);

    await pool.query(`update users set email_verified_at = now() where id = $1`, [account.userId]);
    const setup = await setupTwoFactor(account.userId, account.email);
    const backupCodes = await confirmTwoFactor(account.userId, generateTotpCode(setup.secret));
    const currentVersion = await pool.query<{ sessionVersion: number }>(
      `select session_version as "sessionVersion" from users where id = $1`,
      [account.userId]
    );
    const rawSession = await issueSession(account.userId, "user", {
      expectedSessionVersion: currentVersion.rows[0].sessionVersion
    });
    const twoFactorSession: Session = {
      cookies: [
        `access_token=${rawSession.accessToken}`,
        `refresh_token=${rawSession.refreshToken}`,
        `csrf_token=${rawSession.csrfToken}`
      ],
      csrfToken: rawSession.csrfToken,
      sessionId: rawSession.jti,
      sessionVersion: rawSession.sessionVersion
    };

    await authedPost("/users/me/step-up", twoFactorSession)
      .send({ purpose: "change_email", method: "password", currentPassword: PASSWORD })
      .expect(401);
    await authedPost("/users/me/step-up", twoFactorSession)
      .send({ purpose: "change_email", method: "two_factor", code: generateTotpCode(setup.secret) })
      .expect(200);
    await authedPost("/users/me/step-up", twoFactorSession)
      .send({ purpose: "change_email", method: "two_factor", code: backupCodes[0] })
      .expect(200);
    await authedPost("/users/me/step-up", twoFactorSession)
      .send({ purpose: "change_email", method: "two_factor", code: backupCodes[0] })
      .expect(401);
  });

  it("fails closed for an account with no password or enabled 2FA", async () => {
    const userId = await createUser();
    const raw = await issueSession(userId, "user");
    const session: Session = {
      cookies: [
        `access_token=${raw.accessToken}`,
        `refresh_token=${raw.refreshToken}`,
        `csrf_token=${raw.csrfToken}`
      ],
      csrfToken: raw.csrfToken,
      sessionId: raw.jti,
      sessionVersion: raw.sessionVersion
    };
    await authedPost("/users/me/step-up", session)
      .send({ purpose: "change_email", method: "password", currentPassword: PASSWORD })
      .expect(401);
  });
});
