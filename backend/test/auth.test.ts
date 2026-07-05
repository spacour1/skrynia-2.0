import { randomUUID } from "node:crypto";
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
});

describe("Redis transient outages do not force a logout", () => {
  it("authenticate() falls back to trusting the JWT when the revocation check itself errors", async () => {
    const auth = new AuthedAgent();
    await auth.register();

    const redis = getRedis()!;
    const existsSpy = vi.spyOn(redis, "exists").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await auth.get("/auth/me").expect(200);
    existsSpy.mockRestore();
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
