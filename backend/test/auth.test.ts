import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { createPasswordResetToken } from "../src/modules/auth/verification.service.js";
import { hashRefreshToken } from "../src/modules/auth/session.service.js";
import { closeDb, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

function cookieValue(setCookieHeader: string[] | undefined, name: string): string | undefined {
  const line = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
  return line?.split(";")[0].split("=")[1];
}

function cookieMaxAge(setCookieHeader: string[] | undefined, name: string): number | undefined {
  const line = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
  const match = line?.match(/Max-Age=(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Mirrors the frontend's apiFetch: every mutating request must echo the csrf_token cookie
// back as an X-CSRF-Token header, and that token rotates every time a session is (re)issued.
class AuthedAgent {
  private agent = request.agent(app);
  csrfToken = "";
  userId = "";
  email = "";
  password = "correct-horse-battery-staple";

  async register(overrides: { email?: string } = {}) {
    this.email = overrides.email ?? `${randomUUID()}@test.local`;
    const response = await this.agent
      .post("/auth/register")
      .send({ email: this.email, password: this.password, displayName: "Test User" })
      .expect(201);
    this.userId = response.body.user.id as string;
    this.csrfToken = cookieValue(response.headers["set-cookie"] as unknown as string[], "csrf_token")!;
    return response;
  }

  async login() {
    const response = await this.agent.post("/auth/login").send({ email: this.email, password: this.password }).expect(200);
    this.csrfToken = cookieValue(response.headers["set-cookie"] as unknown as string[], "csrf_token")!;
    return response;
  }

  get(path: string) {
    return this.agent.get(path);
  }

  post(path: string) {
    return this.agent.post(path).set("X-CSRF-Token", this.csrfToken);
  }

  async refresh() {
    const response = await this.post("/auth/refresh");
    if (response.status === 200) {
      this.csrfToken = cookieValue(response.headers["set-cookie"] as unknown as string[], "csrf_token")!;
    }
    return response;
  }
}

describe("persistent login: access-token expiry vs refresh-token validity", () => {
  it("stays logged in once the access-token session is gone but the refresh token is still valid", async () => {
    const auth = new AuthedAgent();
    await auth.register();

    await auth.get("/auth/me").expect(200);

    // Simulate the access token's 15-minute window elapsing: its Redis revocation-check
    // entry is gone, even though the JWT itself hasn't reached its signed exp yet.
    const sessionKeys = await getRedis()!.keys("session:*");
    for (const key of sessionKeys) await getRedis()!.del(key);

    await auth.get("/auth/me").expect(401);

    await auth.refresh().then((r) => expect(r.status).toBe(200));

    // /auth/me must work again immediately after the silent refresh, with no logout in between.
    const meAfterRefresh = await auth.get("/auth/me").expect(200);
    expect(meAfterRefresh.body.user.id).toBe(auth.userId);
  });

  it("rotates the refresh token so the previous one can't be redeemed twice", async () => {
    const auth = new AuthedAgent();
    const registerResponse = await auth.register();
    const setCookie = registerResponse.headers["set-cookie"] as unknown as string[];
    const oldRefreshToken = cookieValue(setCookie, "refresh_token");
    const oldCsrfToken = cookieValue(setCookie, "csrf_token");

    await auth.refresh().then((r) => expect(r.status).toBe(200));

    // Replaying the pre-rotation refresh token (e.g. a stale cookie from another flow)
    // must fail now that a newer one has been issued.
    const replay = await request(app)
      .post("/auth/refresh")
      .set("Cookie", [`refresh_token=${oldRefreshToken}`, `csrf_token=${oldCsrfToken}`])
      .set("X-CSRF-Token", oldCsrfToken!)
      .expect(401);
    expect(replay.body.error.code).toBe("refresh_token_invalid");
  });

  it("issues a refresh cookie that survives browser close (Max-Age, not a session cookie)", async () => {
    const auth = new AuthedAgent();
    const response = await auth.register();
    const maxAge = cookieMaxAge(response.headers["set-cookie"] as unknown as string[], "refresh_token");
    expect(maxAge).toBeGreaterThan(60 * 24 * 60 * 60); // well over 60 days
  });

  it("recovers the same rotation when the first Redis acknowledgement is lost", async () => {
    const auth = new AuthedAgent();
    await auth.register();
    const redis = getRedis()!;
    const originalEval = redis.eval.bind(redis) as (
      script: string,
      numberOfKeys: number,
      ...args: Array<string | number>
    ) => Promise<unknown>;
    const evalSpy = vi.spyOn(redis, "eval").mockImplementationOnce(async (
      script: string,
      numberOfKeys: number,
      ...args: Array<string | number>
    ) => {
      await originalEval(script, numberOfKeys, ...args);
      throw new Error("ECONNRESET after commit");
    });

    try {
      await auth.refresh().then((response) => expect(response.status).toBe(200));
      expect(evalSpy).toHaveBeenCalledTimes(2);
      await auth.get("/auth/me").expect(200);
    } finally {
      evalSpy.mockRestore();
    }
  });

  it("returns 503 without clearing cookies for an unconfirmed refresh script result", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const refreshToken = cookieValue(
      registered.headers["set-cookie"] as unknown as string[],
      "refresh_token"
    )!;
    const redis = getRedis()!;
    const evalSpy = vi.spyOn(redis, "eval")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    let response;
    try {
      response = await auth.refresh();
    } finally {
      evalSpy.mockRestore();
    }

    expect(response.status).toBe(503);
    const setCookies = (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    for (const cookieName of ["access_token", "refresh_token", "csrf_token"]) {
      expect(setCookies.some((cookie) => cookie.startsWith(`${cookieName}=;`))).toBe(false);
    }
    expect(await redis.get(`refresh:${hashRefreshToken(refreshToken)}`)).toBeTruthy();
  });

  it("carries a legacy access jti into the refresh family session index", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const cookies = registered.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(cookies, "access_token")!;
    const refreshToken = cookieValue(cookies, "refresh_token")!;
    const csrfToken = cookieValue(cookies, "csrf_token")!;
    const payload = jwt.decode(accessToken) as {
      sub: string;
      role: string;
      jti: string;
      sv: number;
    };
    const legacyAccessToken = jwt.sign(
      {
        sub: payload.sub,
        role: payload.role,
        jti: payload.jti,
        sv: payload.sv
      },
      process.env.JWT_SECRET!,
      { expiresIn: "15m" }
    );
    const oldRefreshHash = hashRefreshToken(refreshToken);
    const redis = getRedis()!;
    await redis.set(
      `refresh:${oldRefreshHash}`,
      JSON.stringify({ u: payload.sub, v: payload.sv }),
      "EX",
      24 * 60 * 60
    );

    const refreshed = await request(app)
      .post("/auth/refresh")
      .set("Cookie", [
        `access_token=${legacyAccessToken}`,
        `refresh_token=${refreshToken}`,
        `csrf_token=${csrfToken}`
      ])
      .set("X-CSRF-Token", csrfToken)
      .expect(200);
    const refreshedAccess = cookieValue(
      refreshed.headers["set-cookie"] as unknown as string[],
      "access_token"
    )!;
    const refreshedPayload = jwt.decode(refreshedAccess) as { jti: string; fid: string };

    expect(refreshedPayload.fid).toBe(oldRefreshHash);
    expect(await redis.zrange(`refresh_family_sessions:${oldRefreshHash}`, 0, -1))
      .toEqual(expect.arrayContaining([payload.jti, refreshedPayload.jti]));
    expect(await redis.get(`session_family:${payload.jti}`)).toBe(oldRefreshHash);
    const legacyBridgeTtl = await redis.ttl(`session_family:${payload.jti}`);
    expect(legacyBridgeTtl).toBeGreaterThan(0);
    expect(legacyBridgeTtl).toBeLessThanOrEqual(15 * 60);
  });

  it("bounds stale refresh-family aliases to the five-minute race window", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const cookies = registered.headers["set-cookie"] as unknown as string[];
    const refreshToken = cookieValue(cookies, "refresh_token")!;
    const refreshHash = hashRefreshToken(refreshToken);
    const accessToken = cookieValue(cookies, "access_token")!;
    const accessJti = (jwt.decode(accessToken) as { jti: string }).jti;
    const redis = getRedis()!;

    const initialTtl = await redis.ttl(`refresh_family_for:${refreshHash}`);
    expect(initialTtl).toBeGreaterThan(0);
    expect(initialTtl).toBeLessThanOrEqual(5 * 60);
    expect(await redis.get(`session_family:${accessJti}`)).toBeNull();

    const refreshed = await auth.refresh();
    expect(refreshed.status).toBe(200);

    const rotatedAliasTtl = await redis.ttl(`refresh_family_for:${refreshHash}`);
    expect(rotatedAliasTtl).toBeGreaterThan(0);
    expect(rotatedAliasTtl).toBeLessThanOrEqual(5 * 60);
    const refreshedAccess = cookieValue(
      refreshed.headers["set-cookie"] as unknown as string[],
      "access_token"
    )!;
    const refreshedJti = (jwt.decode(refreshedAccess) as { jti: string }).jti;
    expect(await redis.get(`session_family:${refreshedJti}`)).toBeNull();
  });

  it("rejects rotation instead of silently evicting a live family session", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const cookies = registered.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(cookies, "access_token")!;
    const refreshToken = cookieValue(cookies, "refresh_token")!;
    const familyId = (jwt.decode(accessToken) as { fid: string }).fid;
    const refreshHash = hashRefreshToken(refreshToken);
    const redis = getRedis()!;
    const fill = redis.pipeline();
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    // The real session issued above is member 1. Fill the bounded live index to 512.
    for (let index = 1; index < 512; index += 1) {
      const sessionId = `capacity-live-${index}`;
      fill.zadd(`refresh_family_sessions:${familyId}`, expiresAt, sessionId);
      fill.sadd(`user_sessions:${auth.userId}`, sessionId);
    }
    const fillResults = await fill.exec();
    expect(fillResults?.every(([error]) => error === null)).toBe(true);
    expect(await redis.zcard(`refresh_family_sessions:${familyId}`)).toBe(512);

    const response = await auth.refresh();

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("service_unavailable");
    expect(await redis.get(`refresh:${refreshHash}`)).toBeTruthy();
    expect(await redis.zcard(`refresh_family_sessions:${familyId}`)).toBe(512);
  });

  it("does not attach an access session from another login family to the refreshed family", async () => {
    const first = new AuthedAgent();
    const firstLogin = await first.register();
    const firstCookies = firstLogin.headers["set-cookie"] as unknown as string[];
    const firstAccess = cookieValue(firstCookies, "access_token")!;
    const firstPayload = jwt.decode(firstAccess) as { jti: string; fid: string };

    const second = new AuthedAgent();
    second.email = first.email;
    second.password = first.password;
    const secondLogin = await second.login();
    const secondCookies = secondLogin.headers["set-cookie"] as unknown as string[];
    const secondRefresh = cookieValue(secondCookies, "refresh_token")!;
    const secondCsrf = cookieValue(secondCookies, "csrf_token")!;
    const redis = getRedis()!;
    const secondRecord = JSON.parse(
      (await redis.get(`refresh:${hashRefreshToken(secondRefresh)}`))!
    ) as { f: string };
    expect(secondRecord.f).not.toBe(firstPayload.fid);

    await request(app)
      .post("/auth/refresh")
      .set("Cookie", [
        `access_token=${firstAccess}`,
        `refresh_token=${secondRefresh}`,
        `csrf_token=${secondCsrf}`
      ])
      .set("X-CSRF-Token", secondCsrf)
      .expect(200);

    expect(await redis.zrange(`refresh_family_sessions:${secondRecord.f}`, 0, -1))
      .not.toContain(firstPayload.jti);
  });

  it("does not report a recovered refresh after logout wins between commit and acknowledgement", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const cookies = registered.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(cookies, "access_token")!;
    const refreshToken = cookieValue(cookies, "refresh_token")!;
    const csrfToken = cookieValue(cookies, "csrf_token")!;
    const presentedCookies = [
      `access_token=${accessToken}`,
      `refresh_token=${refreshToken}`,
      `csrf_token=${csrfToken}`
    ];
    const redis = getRedis()!;
    const originalEval = redis.eval.bind(redis) as (
      script: string,
      numberOfKeys: number,
      ...args: Array<string | number>
    ) => Promise<unknown>;
    const evalSpy = vi.spyOn(redis, "eval").mockImplementationOnce(async (
      script: string,
      numberOfKeys: number,
      ...args: Array<string | number>
    ) => {
      await originalEval(script, numberOfKeys, ...args);
      await request(app)
        .post("/auth/logout")
        .set("Cookie", presentedCookies)
        .set("X-CSRF-Token", csrfToken)
        .expect(204);
      throw new Error("ECONNRESET after refresh commit");
    });

    let refreshResponse;
    try {
      refreshResponse = await request(app)
        .post("/auth/refresh")
        .set("Cookie", presentedCookies)
        .set("X-CSRF-Token", csrfToken);
    } finally {
      evalSpy.mockRestore();
    }

    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.body.error.code).toBe("refresh_token_invalid");
    const familyId = (jwt.decode(accessToken) as { fid: string }).fid;
    expect(JSON.parse((await redis.get(`refresh_family:${familyId}`))!))
      .toMatchObject({ s: "revoked", u: auth.userId });
  });
});

describe("logout", () => {
  it("clears cookies and revokes the refresh token so it can't be used again", async () => {
    const auth = new AuthedAgent();
    const registerResponse = await auth.register();
    const setCookie = registerResponse.headers["set-cookie"] as unknown as string[];
    const refreshToken = cookieValue(setCookie, "refresh_token");
    const csrfToken = cookieValue(setCookie, "csrf_token");

    const logoutResponse = await auth.post("/auth/logout").expect(204);
    const clearedRefresh = (logoutResponse.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("refresh_token=;")
    );
    expect(clearedRefresh).toBeTruthy();

    await auth.get("/auth/me").expect(401);

    // The pre-logout refresh token must be dead server-side too, not just removed from
    // this browser's cookie jar - replay it directly to prove that.
    const replay = await request(app)
      .post("/auth/refresh")
      .set("Cookie", [`refresh_token=${refreshToken}`, `csrf_token=${csrfToken}`])
      .set("X-CSRF-Token", csrfToken!)
      .expect(401);
    expect(replay.body.error.code).toBe("refresh_token_invalid");
  });

  it("revokes a live refresh credential even when the access cookie is invalid", async () => {
    const auth = new AuthedAgent();
    const registerResponse = await auth.register();
    const setCookie = registerResponse.headers["set-cookie"] as unknown as string[];
    const refreshToken = cookieValue(setCookie, "refresh_token")!;
    const csrfToken = cookieValue(setCookie, "csrf_token")!;

    const logoutResponse = await request(app)
      .post("/auth/logout")
      .set("Cookie", [
        "access_token=expired-or-invalid",
        `refresh_token=${refreshToken}`,
        `csrf_token=${csrfToken}`
      ])
      .set("X-CSRF-Token", csrfToken)
      .expect(204);
    expect(
      (logoutResponse.headers["set-cookie"] as unknown as string[]).some((cookie) =>
        cookie.startsWith("refresh_token=;")
      )
    ).toBe(true);

    await request(app)
      .post("/auth/refresh")
      .set("Cookie", [`refresh_token=${refreshToken}`, `csrf_token=${csrfToken}`])
      .set("X-CSRF-Token", csrfToken)
      .expect(401);
  });

  it("uses an expired access token only to revoke its exact session, not the whole family", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const cookies = registered.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(cookies, "access_token")!;
    const payload = jwt.decode(accessToken) as {
      sub: string;
      role: string;
      jti: string;
      sv: number;
      fid: string;
    };
    const expiredAccess = jwt.sign(
      {
        sub: payload.sub,
        role: payload.role,
        jti: payload.jti,
        sv: payload.sv,
        fid: payload.fid
      },
      process.env.JWT_SECRET!,
      { expiresIn: -1 }
    );
    const csrfToken = "expired-access-logout-csrf";

    await request(app)
      .post("/auth/logout")
      .set("Cookie", [`access_token=${expiredAccess}`, `csrf_token=${csrfToken}`])
      .set("X-CSRF-Token", csrfToken)
      .expect(204);

    await auth.refresh().then((response) => expect(response.status).toBe(200));
    await auth.get("/auth/me").expect(200);
  });

  it("keeps durable revocation tombstones when realtime publish fails", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const cookies = registered.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(cookies, "access_token")!;
    const refreshToken = cookieValue(cookies, "refresh_token")!;
    const csrfToken = cookieValue(cookies, "csrf_token")!;
    const redis = getRedis()!;
    const record = JSON.parse(
      (await redis.get(`refresh:${hashRefreshToken(refreshToken)}`))!
    ) as { f: string };
    const accessPayload = jwt.decode(accessToken) as { jti: string };
    const presentedCookies = [
      `access_token=${accessToken}`,
      `refresh_token=${refreshToken}`,
      `csrf_token=${csrfToken}`
    ];
    const publishSpy = vi.spyOn(redis, "publish")
      .mockRejectedValueOnce(new Error("Redis publish unavailable"));

    let response;
    try {
      response = await request(app)
        .post("/auth/logout")
        .set("Cookie", presentedCookies)
        .set("X-CSRF-Token", csrfToken)
        .expect(204);
    } finally {
      publishSpy.mockRestore();
    }
    const clearedCookies =
      (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    expect(clearedCookies.some((cookie) => cookie.startsWith("refresh_token=;"))).toBe(true);
    expect(await redis.zrange(`refresh_family_sessions:${record.f}`, 0, -1)).toEqual([]);
    expect(JSON.parse((await redis.get(`refresh_family:${record.f}`))!)).toMatchObject({
      s: "revoked",
      u: auth.userId
    });
    expect(await redis.get(`session_revoked:${accessPayload.jti}`)).toBe("1");
    expect(await redis.get(`logout_receipt:${hashRefreshToken(refreshToken)}`)).toBeTruthy();
  });

  it("retries refresh-only logout through a safe receipt after Redis loses the acknowledgement", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const cookies = registered.headers["set-cookie"] as unknown as string[];
    const refreshToken = cookieValue(cookies, "refresh_token")!;
    const csrfToken = cookieValue(cookies, "csrf_token")!;
    const refreshHash = hashRefreshToken(refreshToken);
    const presentedCookies = [
      `refresh_token=${refreshToken}`,
      `csrf_token=${csrfToken}`
    ];
    const redis = getRedis()!;
    const originalEval = redis.eval.bind(redis) as (
      script: string,
      numberOfKeys: number,
      ...args: Array<string | number>
    ) => Promise<unknown>;
    const evalSpy = vi.spyOn(redis, "eval").mockImplementationOnce(async (
      script: string,
      numberOfKeys: number,
      ...args: Array<string | number>
    ) => {
      await originalEval(script, numberOfKeys, ...args);
      throw new Error("ECONNRESET after logout commit");
    });

    let uncertain;
    try {
      uncertain = await request(app)
        .post("/auth/logout")
        .set("Cookie", presentedCookies)
        .set("X-CSRF-Token", csrfToken)
        .expect(503);
    } finally {
      evalSpy.mockRestore();
    }
    const uncertainCookies =
      (uncertain.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    expect(uncertainCookies.some((cookie) => cookie.startsWith("refresh_token=;"))).toBe(false);
    expect(await redis.get(`refresh:${refreshHash}`)).toBeNull();

    const rawReceipt = await redis.get(`logout_receipt:${refreshHash}`);
    expect(rawReceipt).toBeTruthy();
    const receipt = JSON.parse(rawReceipt!) as Record<string, unknown>;
    expect(receipt).toEqual({ s: "revoked", u: auth.userId, f: refreshHash });
    expect(Object.keys(receipt).sort()).toEqual(["f", "s", "u"]);
    expect(rawReceipt).not.toContain(refreshToken);
    const receiptTtl = await redis.ttl(`logout_receipt:${refreshHash}`);
    expect(receiptTtl).toBeGreaterThan(7 * 24 * 60 * 60);
    expect(receiptTtl).toBeLessThanOrEqual(8 * 24 * 60 * 60);

    // Prove the retry resolves through the durable receipt rather than the unrelated
    // five-minute rotation-race alias created with the original session.
    await redis.del(`refresh_family_for:${refreshHash}`);

    await request(app)
      .post("/auth/logout")
      .set("Cookie", presentedCookies)
      .set("X-CSRF-Token", csrfToken)
      .expect(204);
    await request(app)
      .post("/auth/refresh")
      .set("Cookie", presentedCookies)
      .set("X-CSRF-Token", csrfToken)
      .expect(401);
  });

  it("returns 503 without clearing cookies when Redis cannot confirm revocation, then retries", async () => {
    const auth = new AuthedAgent();
    const registerResponse = await auth.register();
    const setCookie = registerResponse.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(setCookie, "access_token")!;
    const refreshToken = cookieValue(setCookie, "refresh_token")!;
    const csrfToken = cookieValue(setCookie, "csrf_token")!;
    const presentedCookies = [
      `access_token=${accessToken}`,
      `refresh_token=${refreshToken}`,
      `csrf_token=${csrfToken}`
    ];

    const redis = getRedis()!;
    const evalSpy = vi.spyOn(redis, "eval").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    let failedLogout;
    try {
      failedLogout = await request(app)
        .post("/auth/logout")
        .set("Cookie", presentedCookies)
        .set("X-CSRF-Token", csrfToken)
        .expect(503);
    } finally {
      evalSpy.mockRestore();
    }
    expect(failedLogout.body.error.code).toBe("service_unavailable");
    const failedSetCookies =
      (failedLogout.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    for (const cookieName of ["access_token", "refresh_token", "csrf_token"]) {
      expect(failedSetCookies.some((cookie) => cookie.startsWith(`${cookieName}=;`))).toBe(false);
    }

    expect(await redis.get(`refresh:${hashRefreshToken(refreshToken)}`)).toBeTruthy();
    await request(app)
      .post("/auth/logout")
      .set("Cookie", presentedCookies)
      .set("X-CSRF-Token", csrfToken)
      .expect(204);
    await request(app)
      .post("/auth/refresh")
      .set("Cookie", [`refresh_token=${refreshToken}`, `csrf_token=${csrfToken}`])
      .set("X-CSRF-Token", csrfToken)
      .expect(401);
  });

  it("returns 503 and retains cookies when the atomic Redis revocation is uncertain", async () => {
    const auth = new AuthedAgent();
    const registerResponse = await auth.register();
    const setCookie = registerResponse.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(setCookie, "access_token")!;
    const refreshToken = cookieValue(setCookie, "refresh_token")!;
    const csrfToken = cookieValue(setCookie, "csrf_token")!;
    const presentedCookies = [
      `access_token=${accessToken}`,
      `refresh_token=${refreshToken}`,
      `csrf_token=${csrfToken}`
    ];
    const redis = getRedis()!;
    const evalSpy = vi.spyOn(redis, "eval").mockResolvedValueOnce(null);

    let failedLogout;
    try {
      failedLogout = await request(app)
        .post("/auth/logout")
        .set("Cookie", presentedCookies)
        .set("X-CSRF-Token", csrfToken)
        .expect(503);
    } finally {
      evalSpy.mockRestore();
    }
    expect(failedLogout.body.error.code).toBe("service_unavailable");
    const failedSetCookies =
      (failedLogout.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    for (const cookieName of ["access_token", "refresh_token", "csrf_token"]) {
      expect(failedSetCookies.some((cookie) => cookie.startsWith(`${cookieName}=;`))).toBe(false);
    }
    expect(await redis.get(`refresh:${hashRefreshToken(refreshToken)}`)).toBeTruthy();

    await request(app)
      .post("/auth/logout")
      .set("Cookie", presentedCookies)
      .set("X-CSRF-Token", csrfToken)
      .expect(204);
  });

  it("does not let a refresh paused after lookup resurrect a session after logout", async () => {
    const auth = new AuthedAgent();
    const registerResponse = await auth.register();
    const setCookie = registerResponse.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(setCookie, "access_token")!;
    const refreshToken = cookieValue(setCookie, "refresh_token")!;
    const csrfToken = cookieValue(setCookie, "csrf_token")!;
    const refreshKey = `refresh:${hashRefreshToken(refreshToken)}`;
    const redis = getRedis()!;
    const snapshot = await redis.get(refreshKey);
    expect(snapshot).toBeTruthy();
    const lookupStarted = deferred<void>();
    const releaseLookup = deferred<void>();
    const getSpy = vi.spyOn(redis, "get").mockImplementationOnce(async () => {
      lookupStarted.resolve();
      await releaseLookup.promise;
      return snapshot;
    });
    const presentedCookies = [
      `access_token=${accessToken}`,
      `refresh_token=${refreshToken}`,
      `csrf_token=${csrfToken}`
    ];

    try {
      const refresh = request(app)
        .post("/auth/refresh")
        .set("Cookie", presentedCookies)
        .set("X-CSRF-Token", csrfToken)
        .then((response) => response);
      await lookupStarted.promise;

      await request(app)
        .post("/auth/logout")
        .set("Cookie", presentedCookies)
        .set("X-CSRF-Token", csrfToken)
        .expect(204);
      releaseLookup.resolve();

      const refreshResponse = await refresh;
      expect(refreshResponse.status).toBe(401);
      expect(refreshResponse.body.error.code).toBe("refresh_token_invalid");
      expect(await redis.smembers(`user_sessions:${auth.userId}`)).toEqual([]);
      expect(await redis.smembers(`user_refresh:${auth.userId}`)).toEqual([]);
    } finally {
      releaseLookup.resolve();
      getSpy.mockRestore();
    }
  });

  it("lets the original cookies revoke the latest session after multiple refresh rotations", async () => {
    const auth = new AuthedAgent();
    const registerResponse = await auth.register();
    const originalSetCookie = registerResponse.headers["set-cookie"] as unknown as string[];
    const originalCookies = [
      `access_token=${cookieValue(originalSetCookie, "access_token")!}`,
      `refresh_token=${cookieValue(originalSetCookie, "refresh_token")!}`,
      `csrf_token=${cookieValue(originalSetCookie, "csrf_token")!}`
    ];
    const originalCsrf = cookieValue(originalSetCookie, "csrf_token")!;

    await auth.refresh().then((response) => expect(response.status).toBe(200));
    const latestRefreshResponse = await auth.refresh();
    expect(latestRefreshResponse.status).toBe(200);
    const latestSetCookie = latestRefreshResponse.headers["set-cookie"] as unknown as string[];
    const latestAccess = cookieValue(latestSetCookie, "access_token")!;
    const latestRefresh = cookieValue(latestSetCookie, "refresh_token")!;
    const latestCsrf = cookieValue(latestSetCookie, "csrf_token")!;

    await request(app)
      .post("/auth/logout")
      .set("Cookie", originalCookies)
      .set("X-CSRF-Token", originalCsrf)
      .expect(204);

    await request(app)
      .get("/auth/me")
      .set("Cookie", [`access_token=${latestAccess}`])
      .expect(401);
    await request(app)
      .post("/auth/refresh")
      .set("Cookie", [`refresh_token=${latestRefresh}`, `csrf_token=${latestCsrf}`])
      .set("X-CSRF-Token", latestCsrf)
      .expect(401);
  });

  it("keeps credentials untouched when logout CSRF validation fails", async () => {
    const auth = new AuthedAgent();
    const registerResponse = await auth.register();
    const setCookie = registerResponse.headers["set-cookie"] as unknown as string[];
    const refreshToken = cookieValue(setCookie, "refresh_token")!;

    const response = await request(app)
      .post("/auth/logout")
      .set("Cookie", setCookie.map((cookie) => cookie.split(";", 1)[0]))
      .set("X-CSRF-Token", "wrong-token")
      .expect(403);
    expect(response.body.error.code).toBe("csrf_failed");
    expect(await getRedis()!.get(`refresh:${hashRefreshToken(refreshToken)}`)).toBeTruthy();
  });

  it("logout-all revokes every device session", async () => {
    const first = new AuthedAgent();
    await first.register();
    const second = new AuthedAgent();
    second.email = first.email;
    second.password = first.password;
    await second.login();

    await first.post("/auth/logout-all").expect(204);

    await first.get("/auth/me").expect(401);
    await second.get("/auth/me").expect(401);
    await second.refresh().then((response) => expect(response.status).toBe(401));
  });
});

describe("banned users", () => {
  it("is rejected by authenticate() immediately, even with an otherwise-valid access token", async () => {
    const auth = new AuthedAgent();
    await auth.register();
    await pool.query(`update users set is_banned = true where id = $1`, [auth.userId]);

    const response = await auth.get("/auth/me");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("account_banned");
  });

  it("cannot refresh a session once banned, and the failed refresh clears their cookies", async () => {
    const auth = new AuthedAgent();
    await auth.register();
    await pool.query(`update users set is_banned = true where id = $1`, [auth.userId]);

    const response = await auth.refresh();
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");

    const cleared = (response.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("access_token=;"));
    expect(cleared).toBeTruthy();
  });
});

describe("expired/invalid refresh tokens", () => {
  it("returns 401 and clears cookies when the refresh token is unknown to Redis", async () => {
    const auth = new AuthedAgent();
    await auth.register();

    const refreshKeys = await getRedis()!.keys("refresh:*");
    for (const key of refreshKeys) await getRedis()!.del(key);

    const response = await auth.refresh();
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("refresh_token_invalid");
  });
});

describe("password reset invalidates old sessions", () => {
  it("logs out every existing session once the password is reset via the email-link flow", async () => {
    const auth = new AuthedAgent();
    await auth.register();
    await auth.get("/auth/me").expect(200);

    const token = await createPasswordResetToken(auth.userId);
    await request(app).post("/auth/password/reset").send({ token, password: "a-brand-new-password" }).expect(200);

    await auth.get("/auth/me").expect(401);
    await auth.refresh().then((r) => expect(r.status).toBe(401));
  });

  it("keeps the current session alive when changing the password from inside an authenticated session", async () => {
    const authA = new AuthedAgent();
    await authA.register();
    const authB = new AuthedAgent();
    authB.email = authA.email;
    authB.password = authA.password;
    await authB.login();

    await authA
      .post("/users/me/password")
      .send({ currentPassword: authA.password, newPassword: "A-brand-new-password1" })
      .expect(200);

    // The session that performed the change stays logged in...
    await authA.get("/auth/me").expect(200);
    // ...but the other, older session is revoked.
    await authB.get("/auth/me").expect(401);
  });

  it("rotates the caller a full new session on password change: refresh keeps working, other devices are fully out", async () => {
    const authA = new AuthedAgent();
    await authA.register();
    const oldPassword = authA.password;
    const authB = new AuthedAgent();
    authB.email = authA.email;
    authB.password = oldPassword;
    await authB.login();

    const change = await authA
      .post("/users/me/password")
      .send({ currentPassword: oldPassword, newPassword: "A-brand-new-password1" })
      .expect(200);
    // The response carries a fresh session (access+refresh+csrf); adopt the new csrf so
    // this agent's later mutating calls stay valid.
    authA.csrfToken = cookieValue(change.headers["set-cookie"] as unknown as string[], "csrf_token")!;

    // Device A: access works now AND its refresh token still works (this used to break -
    // exceptJti kept the access session but revoked every refresh token, logging the tab
    // out as soon as the 15-minute access window ended).
    await authA.get("/auth/me").expect(200);
    await authA.refresh().then((r) => expect(r.status).toBe(200));
    await authA.get("/auth/me").expect(200);

    // Device B: both access and refresh are dead.
    await authB.get("/auth/me").expect(401);
    await authB.refresh().then((r) => expect(r.status).toBe(401));

    // Old password no longer logs in; the new one does.
    await request(app).post("/auth/login").send({ email: authA.email, password: oldPassword }).expect(400);
    await request(app).post("/auth/login").send({ email: authA.email, password: "A-brand-new-password1" }).expect(200);
  });
});

describe("Redis transient outage behavior", () => {
  it("fails authenticated access closed when revocation state cannot be checked", async () => {
    const auth = new AuthedAgent();
    const registered = await auth.register();
    const accessToken = cookieValue(
      registered.headers["set-cookie"] as unknown as string[],
      "access_token"
    )!;
    await auth.post("/auth/logout").expect(204);

    const redis = getRedis()!;
    const multiSpy = vi.spyOn(redis, "multi").mockImplementationOnce(() => {
      throw new Error("ECONNREFUSED");
    });
    try {
      const response = await request(app)
        .get("/auth/me")
        .set("Cookie", [`access_token=${accessToken}`])
        .expect(503);
      expect(response.body.error.code).toBe("service_unavailable");
    } finally {
      multiSpy.mockRestore();
    }
  });

  it("/auth/refresh responds 503 (not a logout) when Redis is unreachable, and the refresh token survives", async () => {
    const auth = new AuthedAgent();
    const response = await auth.register();
    const refreshToken = cookieValue(response.headers["set-cookie"] as unknown as string[], "refresh_token");

    const redis = getRedis()!;
    const getSpy = vi.spyOn(redis, "get").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const refreshResponse = await auth.refresh();
    expect(refreshResponse.status).toBe(503);
    expect(refreshResponse.body.error.code).toBe("service_unavailable");
    getSpy.mockRestore();

    // The outage must not have cleared or consumed the refresh token - it still works.
    const stored = await redis.get(`refresh:${hashRefreshToken(refreshToken!)}`);
    expect(stored).toBeTruthy();
    await auth.refresh().then((r) => expect(r.status).toBe(200));
  });
});
