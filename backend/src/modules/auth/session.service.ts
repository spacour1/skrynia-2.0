import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Secret, SignOptions } from "jsonwebtoken";
import { nanoid } from "nanoid";
import { env } from "../../config/env.js";
import { pool, type DbClient } from "../../db/pool.js";
import { serviceUnavailable, unauthorized } from "../../common/errors.js";
import { getRedis } from "../../common/redis.js";
import { logger } from "../../common/logger.js";
import type { Role } from "../../common/types.js";
import { publishSessionSecurityEvent } from "./session-events.service.js";

export function hashRefreshToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function userSessionsKey(userId: string) {
  return `user_sessions:${userId}`;
}

function userRefreshKey(userId: string) {
  return `user_refresh:${userId}`;
}

function userRefreshFamiliesKey(userId: string) {
  return `user_refresh_families:${userId}`;
}

function refreshFamilyKey(familyId: string) {
  return `refresh_family:${familyId}`;
}

function refreshFamilyForKey(refreshHash: string) {
  return `refresh_family_for:${refreshHash}`;
}

function refreshFamilySessionsKey(familyId: string) {
  return `refresh_family_sessions:${familyId}`;
}

function refreshFamilyTokensKey(familyId: string) {
  return `refresh_family_tokens:${familyId}`;
}

function sessionRevokedKey(sessionId: string) {
  return `session_revoked:${sessionId}`;
}

const REFRESH_FAMILY_ALIAS_TTL_SECONDS = 5 * 60;
const REFRESH_ROTATION_RECEIPT_TTL_SECONDS = 5 * 60;
const LOGOUT_RECEIPT_TTL_SECONDS = 8 * 24 * 60 * 60;
const MAX_REFRESH_FAMILY_SESSIONS = 512;

/**
 * Increments the user's session invalidation epoch. Must run on the same client (and
 * therefore in the same transaction) as the security-state change it protects -
 * password change/reset, 2FA disable/replacement, ban, logout-all - so old sessions
 * become invalid exactly when the change commits, whether or not Redis is reachable.
 */
export async function bumpSessionVersion(client: DbClient, userId: string): Promise<number> {
  const result = await client.query<{ sessionVersion: number }>(
    `update users set session_version = session_version + 1, updated_at = now()
     where id = $1
     returning session_version as "sessionVersion"`,
    [userId]
  );
  if (!result.rows[0]) throw unauthorized("Account is unavailable");
  return result.rows[0].sessionVersion;
}

type RefreshRecord = { userId: string; sessionVersion: number; familyId?: string };
type LogoutAccessIdentity = {
  userId: string;
  sessionId: string;
  familyId?: string;
  mayRevokeFamily: boolean;
};

type SessionCredentials = {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  jti: string;
  sessionVersion: number;
  familyId: string;
  refreshHash: string;
};

/**
 * Refresh records are JSON `{"u":...,"v":...}`. Records written before the
 * session-version rollout hold a plain user id; they are treated as version 1 - the
 * migration default every existing user starts at - so they stay valid exactly until
 * the user's first security-sensitive change bumps the version.
 */
export function parseRefreshRecord(value: string): RefreshRecord | null {
  try {
    const parsed = JSON.parse(value) as { u?: unknown; v?: unknown; f?: unknown };
    if (typeof parsed === "object" && parsed !== null && typeof parsed.u === "string") {
      return {
        userId: parsed.u,
        sessionVersion: typeof parsed.v === "number" ? parsed.v : 1,
        familyId: typeof parsed.f === "string" && parsed.f ? parsed.f : undefined
      };
    }
    return null;
  } catch {
    // Legacy plain-string record.
  }
  return value ? { userId: value, sessionVersion: 1 } : null;
}

/**
 * Verifies a presented access cookie only far enough to identify the session that must
 * be revoked. Expiry is intentionally ignored: an expired access token grants no access,
 * but its signed jti is still the exact server record logout needs to delete.
 */
export function parseAccessSessionForLogout(token: string | undefined): LogoutAccessIdentity | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET as Secret, {
      ignoreExpiration: true
    }) as { sub?: unknown; jti?: unknown; fid?: unknown; exp?: unknown; purpose?: unknown };
    if (
      typeof payload.sub !== "string" ||
      typeof payload.jti !== "string" ||
      payload.purpose !== undefined
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      sessionId: payload.jti,
      familyId: typeof payload.fid === "string" && payload.fid ? payload.fid : undefined,
      // An expired access token still identifies its exact jti, but it must not remain a
      // long-lived kill switch for every newer credential in the same refresh family.
      mayRevokeFamily: typeof payload.exp === "number" && payload.exp > Date.now() / 1000
    };
  } catch {
    return null;
  }
}

const ROTATE_REFRESH_SESSION_SCRIPT = `
local oldRecord = redis.call("GET", KEYS[1])
if oldRecord ~= ARGV[1] then
  if redis.call("GET", KEYS[11]) ~= ARGV[14] then return 0 end
  local familyRecord = redis.call("GET", KEYS[2])
  if not familyRecord then return 0 end
  local familyOk, family = pcall(cjson.decode, familyRecord)
  if not familyOk or type(family) ~= "table" or family.s ~= "active" or family.u ~= ARGV[2] then
    return 0
  end
  if redis.call("GET", KEYS[6]) ~= ARGV[4] then return 0 end
  if redis.call("GET", KEYS[5]) ~= ARGV[2] then return 0 end
  return 1
end

local familyRecord = redis.call("GET", KEYS[2])
if familyRecord then
  local ok, family = pcall(cjson.decode, familyRecord)
  if not ok or type(family) ~= "table" or family.s ~= "active" or family.u ~= ARGV[2] then
    return 0
  end
end

local expiredSessions = redis.call("ZRANGEBYSCORE", KEYS[3], "-inf", ARGV[10])
for _, sessionId in ipairs(expiredSessions) do
  redis.call("SREM", KEYS[8], sessionId)
end
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", ARGV[10])

-- Never silently evict a still-live access JTI from the family fence. A legacy token
-- without fid would otherwise survive family logout until its own expiry. Reject the
-- rotation before consuming the presented refresh token and let the client retry after
-- older access sessions expire.
local projectedSessionCount = redis.call("ZCARD", KEYS[3])
if not redis.call("ZSCORE", KEYS[3], ARGV[6]) then
  projectedSessionCount = projectedSessionCount + 1
end
if ARGV[16] ~= "" and not redis.call("ZSCORE", KEYS[3], ARGV[16]) then
  projectedSessionCount = projectedSessionCount + 1
end
if projectedSessionCount > tonumber(ARGV[18]) then return 2 end

redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[9])
redis.call("SET", KEYS[5], ARGV[2], "EX", ARGV[8])
redis.call("SET", KEYS[6], ARGV[4], "EX", ARGV[9])
redis.call("SET", KEYS[7], ARGV[5], "EX", ARGV[17])
redis.call("ZADD", KEYS[3], ARGV[11], ARGV[6])
redis.call("SADD", KEYS[8], ARGV[6])
if ARGV[16] ~= "" then
  redis.call("ZADD", KEYS[3], ARGV[11], ARGV[16])
  redis.call("SADD", KEYS[8], ARGV[16])
  redis.call("SET", "session_family:" .. ARGV[16], ARGV[5], "EX", ARGV[8])
end
redis.call("EXPIRE", KEYS[3], ARGV[9])
redis.call("SADD", KEYS[4], ARGV[7])
redis.call("EXPIRE", KEYS[4], ARGV[9])
redis.call("EXPIRE", KEYS[8], ARGV[9])
redis.call("SADD", KEYS[9], ARGV[7])
redis.call("EXPIRE", KEYS[9], ARGV[9])
redis.call("SADD", KEYS[10], ARGV[5])
redis.call("EXPIRE", KEYS[10], ARGV[9])

if ARGV[12] == "1" then
  redis.call("DEL", KEYS[1])
  redis.call("SREM", KEYS[4], ARGV[13])
  redis.call("SREM", KEYS[9], ARGV[13])
end

redis.call("SET", KEYS[11], ARGV[14], "EX", ARGV[15])

return 1
`;

const REVOKE_PRESENTED_SESSION_SCRIPT = `
local accessSessionId = ARGV[1]
local accessUserId = ARGV[2]
local accessFamilyId = ARGV[3]
local refreshHash = ARGV[4]
local refreshTtl = ARGV[5]
local now = ARGV[6]
local logoutReceiptTtl = ARGV[7]
local revokedSessions = {}
local revokedFamilyIds = {}
local returnedSessions = {}
local revokedFamilies = {}

local function decodeObject(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if ok and type(value) == "table" then return value end
  return nil
end

local function decodeRefresh(raw)
  if not raw then return nil, nil end
  local record = decodeObject(raw)
  if record and type(record.u) == "string" then
    local familyId = nil
    if type(record.f) == "string" and record.f ~= "" then familyId = record.f end
    return record.u, familyId
  end
  if not record and raw ~= "" then return raw, nil end
  return nil, nil
end

local function rememberSession(sessionId)
  if sessionId ~= "" and not returnedSessions[sessionId] then
    returnedSessions[sessionId] = true
    redis.call("SET", "session_revoked:" .. sessionId, "1", "EX", refreshTtl)
    table.insert(revokedSessions, sessionId)
  end
end

local function revokeFamily(familyId, fallbackUserId)
  if familyId == "" then return nil end
  if revokedFamilies[familyId] then
    local repeatedFamily = decodeObject(redis.call("GET", "refresh_family:" .. familyId))
    if repeatedFamily and type(repeatedFamily.u) == "string" then return repeatedFamily.u end
    return fallbackUserId
  end
  revokedFamilies[familyId] = true
  table.insert(revokedFamilyIds, familyId)

  local familyKey = "refresh_family:" .. familyId
  local family = decodeObject(redis.call("GET", familyKey))
  local userId = fallbackUserId
  if family and type(family.u) == "string" then userId = family.u end
  if not userId or userId == "" then return nil end

  redis.call("SET", familyKey, cjson.encode({s = "revoked", u = userId}), "EX", refreshTtl)

  local sessionsKey = "refresh_family_sessions:" .. familyId
  local sessionIds = redis.call("ZRANGEBYSCORE", sessionsKey, now, "+inf")
  for _, sessionId in ipairs(sessionIds) do
    redis.call("DEL", "session:" .. sessionId)
    redis.call("SREM", "user_sessions:" .. userId, sessionId)
    rememberSession(sessionId)
  end
  redis.call("DEL", sessionsKey)

  local tokensKey = "refresh_family_tokens:" .. familyId
  local tokenHashes = redis.call("SMEMBERS", tokensKey)
  for _, tokenHash in ipairs(tokenHashes) do
    redis.call(
      "SET",
      "logout_receipt:" .. tokenHash,
      cjson.encode({s = "revoked", u = userId, f = familyId}),
      "EX",
      logoutReceiptTtl
    )
    redis.call("DEL", "refresh:" .. tokenHash)
    redis.call("SREM", "user_refresh:" .. userId, tokenHash)
  end

  redis.call("DEL", tokensKey)
  redis.call("SREM", "user_refresh_families:" .. userId, familyId)
  return userId
end

if accessFamilyId ~= "" then
  revokeFamily(accessFamilyId, accessUserId)
end

if refreshHash ~= "" then
  local refreshKey = "refresh:" .. refreshHash
  local refreshUserId, recordFamilyId = decodeRefresh(redis.call("GET", refreshKey))
  local receipt = decodeObject(redis.call("GET", "logout_receipt:" .. refreshHash))
  if not refreshUserId and receipt and type(receipt.u) == "string" then
    refreshUserId = receipt.u
  end
  local aliasedFamilyId = redis.call("GET", "refresh_family_for:" .. refreshHash)
  local receiptFamilyId = nil
  if receipt and receipt.s == "revoked" and type(receipt.f) == "string" then
    receiptFamilyId = receipt.f
  end
  local refreshFamilyId = aliasedFamilyId or recordFamilyId or receiptFamilyId
  if not refreshFamilyId and refreshUserId then refreshFamilyId = refreshHash end
  local resolvedUserId = nil
  if refreshFamilyId then resolvedUserId = revokeFamily(refreshFamilyId, refreshUserId) end
  if refreshFamilyId and resolvedUserId then
    redis.call(
      "SET",
      "logout_receipt:" .. refreshHash,
      cjson.encode({s = "revoked", u = resolvedUserId, f = refreshFamilyId}),
      "EX",
      logoutReceiptTtl
    )
  end
  redis.call("DEL", refreshKey)
  if refreshUserId then redis.call("SREM", "user_refresh:" .. refreshUserId, refreshHash) end
end

if accessSessionId ~= "" then
  redis.call("DEL", "session:" .. accessSessionId)
  if accessUserId ~= "" then
    redis.call("SREM", "user_sessions:" .. accessUserId, accessSessionId)
  end
  rememberSession(accessSessionId)
end

table.insert(revokedSessions, "__refresh_families__")
for _, familyId in ipairs(revokedFamilyIds) do
  table.insert(revokedSessions, familyId)
end
return revokedSessions
`;

const REVOKE_ALL_USER_SESSIONS_SCRIPT = `
local userId = ARGV[1]
local exceptJti = ARGV[2]
local refreshTtl = ARGV[3]
local sessionsKey = KEYS[1]
local refreshKey = KEYS[2]
local familiesKey = KEYS[3]

local sessionIds = redis.call("SMEMBERS", sessionsKey)
for _, sessionId in ipairs(sessionIds) do
  if sessionId ~= exceptJti then redis.call("DEL", "session:" .. sessionId) end
end

local tokenHashes = redis.call("SMEMBERS", refreshKey)
for _, tokenHash in ipairs(tokenHashes) do
  redis.call("DEL", "refresh:" .. tokenHash)
end

if exceptJti == "" then
  local familyIds = redis.call("SMEMBERS", familiesKey)
  for _, familyId in ipairs(familyIds) do
    redis.call(
      "SET",
      "refresh_family:" .. familyId,
      cjson.encode({s = "revoked", u = userId}),
      "EX",
      refreshTtl
    )
    redis.call(
      "DEL",
      "refresh_family_sessions:" .. familyId,
      "refresh_family_tokens:" .. familyId
    )
  end
  redis.call("DEL", sessionsKey, refreshKey, familiesKey)
else
  redis.call("DEL", sessionsKey, refreshKey)
  redis.call("SADD", sessionsKey, exceptJti)
end

return 1
`;

/**
 * Atomically removes every verifiable credential presented by one browser. A 204 from
 * /auth/logout is emitted only after Redis confirms this transaction; an unavailable or
 * uncertain Redis result becomes 503 and leaves cookies intact for a later retry.
 */
export async function revokePresentedSessionCredentials(input: {
  accessToken?: string;
  refreshToken?: string;
}): Promise<void> {
  const accessIdentity = parseAccessSessionForLogout(input.accessToken);
  if (!accessIdentity && !input.refreshToken) return;

  const redis = getRedis();
  if (!redis) {
    throw serviceUnavailable("Logout could not be confirmed, try again shortly");
  }

  const refreshHash = input.refreshToken ? hashRefreshToken(input.refreshToken) : "";

  try {
    const result = await redis.eval(
      REVOKE_PRESENTED_SESSION_SCRIPT,
      0,
      accessIdentity?.sessionId ?? "",
      accessIdentity?.userId ?? "",
      accessIdentity?.mayRevokeFamily ? accessIdentity.familyId ?? "" : "",
      refreshHash,
      String(env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60),
      String(Math.floor(Date.now() / 1000)),
      String(LOGOUT_RECEIPT_TTL_SECONDS)
    );
    if (!Array.isArray(result) || result.some((value) => typeof value !== "string")) {
      throw new Error("Redis logout script returned an invalid result");
    }
    const separatorIndex = result.indexOf("__refresh_families__");
    if (separatorIndex < 0) throw new Error("Redis logout script omitted its result separator");
    const sessionIds = result.slice(0, separatorIndex) as string[];
    const familyIds = result.slice(separatorIndex + 1) as string[];

    const events = [
      ...[...new Set(sessionIds)].map((sessionId) => ({
        type: "session.revoked" as const,
        sessionId
      })),
      ...[...new Set(familyIds)].map((familyId) => ({
        type: "session.family.revoked" as const,
        familyId
      }))
    ];
    const publishResults = await Promise.allSettled(
      events.map((event) => publishSessionSecurityEvent(event))
    );
    if (publishResults.some((result) => result.status === "rejected")) {
      logger.warn("logout_realtime_publish_failed_durable_tombstone_retained");
    }
  } catch (error) {
    logger.warn({ error }, "logout_revocation_failed_redis_unavailable");
    throw serviceUnavailable("Logout could not be confirmed, try again shortly");
  }
}

async function prepareSessionCredentials(
  userId: string,
  role: Role,
  options: { expectedSessionVersion?: number; familyId?: string } = {}
): Promise<SessionCredentials> {
  const versionResult = await pool.query<{ sessionVersion: number }>(
    `select session_version as "sessionVersion" from users where id = $1`,
    [userId]
  );
  const sessionVersion = versionResult.rows[0]?.sessionVersion;
  if (sessionVersion === undefined) throw unauthorized("Account is unavailable");
  if (
    options.expectedSessionVersion !== undefined &&
    options.expectedSessionVersion !== sessionVersion
  ) {
    throw unauthorized("Authentication state changed, log in again");
  }

  const jti = nanoid();
  const csrfToken = nanoid(32);
  const accessOptions: SignOptions = { expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m` as SignOptions["expiresIn"] };
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const refreshHash = hashRefreshToken(refreshToken);
  const familyId = options.familyId ?? refreshHash;
  const accessToken = jwt.sign(
    { sub: userId, role, jti, sv: sessionVersion, fid: familyId },
    env.JWT_SECRET as Secret,
    accessOptions
  );

  return {
    accessToken,
    refreshToken,
    csrfToken,
    jti,
    sessionVersion,
    familyId,
    refreshHash
  };
}

export async function issueSession(
  userId: string,
  role: Role,
  options: { expectedSessionVersion?: number } = {}
) {
  const session = await prepareSessionCredentials(userId, role, options);
  const refreshTtlSeconds = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
  const sessionExpiresAt = Math.floor(Date.now() / 1000) + env.ACCESS_TOKEN_TTL_MIN * 60;

  const redis = getRedis();
  if (!redis) throw serviceUnavailable("Sessions are unavailable right now, try again shortly");

  // One MULTI so a connection failure mid-issue cannot leave a partially created
  // session (e.g. a live refresh record whose jti is untracked and unenumerable).
  // The per-user sets exist purely so revokeAllUserSessions can find every
  // outstanding session - the keys addressed by jti/hash cannot be listed by user.
  const results = await redis
    .multi()
    .set(`session:${session.jti}`, userId, "EX", env.ACCESS_TOKEN_TTL_MIN * 60)
    .set(
      `refresh:${session.refreshHash}`,
      JSON.stringify({ u: userId, v: session.sessionVersion, f: session.familyId }),
      "EX",
      refreshTtlSeconds
    )
    .set(
      refreshFamilyKey(session.familyId),
      JSON.stringify({ s: "active", u: userId }),
      "EX",
      refreshTtlSeconds
    )
    .set(
      refreshFamilyForKey(session.refreshHash),
      session.familyId,
      "EX",
      REFRESH_FAMILY_ALIAS_TTL_SECONDS
    )
    .zadd(refreshFamilySessionsKey(session.familyId), sessionExpiresAt, session.jti)
    .expire(refreshFamilySessionsKey(session.familyId), refreshTtlSeconds)
    .sadd(refreshFamilyTokensKey(session.familyId), session.refreshHash)
    .expire(refreshFamilyTokensKey(session.familyId), refreshTtlSeconds)
    .sadd(userSessionsKey(userId), session.jti)
    .expire(userSessionsKey(userId), refreshTtlSeconds)
    .sadd(userRefreshKey(userId), session.refreshHash)
    .expire(userRefreshKey(userId), refreshTtlSeconds)
    .sadd(userRefreshFamiliesKey(userId), session.familyId)
    .expire(userRefreshFamiliesKey(userId), refreshTtlSeconds)
    .exec();
  if (!results || results.some(([error]) => error)) {
    throw serviceUnavailable("Sessions are unavailable right now, try again shortly");
  }

  return session;
}

/**
 * Commits refresh rotation only while the exact presented token is still live and its
 * token family has not been fenced by logout. The Redis script is the linearization
 * point shared with logout: whichever operation reaches Redis first determines whether
 * the replacement credentials exist, so a late refresh can never resurrect a session.
 */
export async function rotateRefreshSession(input: {
  userId: string;
  role: Role;
  sessionVersion: number;
  familyId: string;
  oldRefreshHash: string;
  expectedRefreshRecord: string;
  previousAccessToken?: string;
}): Promise<SessionCredentials | null> {
  const redis = getRedis();
  if (!redis) throw serviceUnavailable("Sessions are unavailable right now, try again shortly");

  const session = await prepareSessionCredentials(input.userId, input.role, {
    expectedSessionVersion: input.sessionVersion,
    familyId: input.familyId
  });
  const refreshTtlSeconds = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const previousAccessIdentity = parseAccessSessionForLogout(input.previousAccessToken);
  // Family-aware credentials already carry fid and were indexed when issued. Only a
  // genuinely pre-family access token needs a short-lived JTI -> family bridge.
  const previousSessionId = previousAccessIdentity?.userId === input.userId &&
    !previousAccessIdentity.familyId
    ? previousAccessIdentity.sessionId
    : "";

  const evalArguments: [string, number, ...Array<string | number>] = [
    ROTATE_REFRESH_SESSION_SCRIPT,
    11,
    `refresh:${input.oldRefreshHash}`,
    refreshFamilyKey(input.familyId),
    refreshFamilySessionsKey(input.familyId),
    refreshFamilyTokensKey(input.familyId),
    `session:${session.jti}`,
    `refresh:${session.refreshHash}`,
    refreshFamilyForKey(input.oldRefreshHash),
    userSessionsKey(input.userId),
    userRefreshKey(input.userId),
    userRefreshFamiliesKey(input.userId),
    `refresh_rotation_receipt:${input.oldRefreshHash}`,
    input.expectedRefreshRecord,
    input.userId,
    JSON.stringify({ s: "active", u: input.userId }),
    JSON.stringify({ u: input.userId, v: session.sessionVersion, f: input.familyId }),
    input.familyId,
    session.jti,
    session.refreshHash,
    String(env.ACCESS_TOKEN_TTL_MIN * 60),
    String(refreshTtlSeconds),
    String(now),
    String(now + env.ACCESS_TOKEN_TTL_MIN * 60),
    env.REFRESH_ROTATION_ENABLED ? "1" : "0",
    input.oldRefreshHash,
    session.refreshHash,
    String(REFRESH_ROTATION_RECEIPT_TTL_SECONDS),
    previousSessionId,
    String(REFRESH_FAMILY_ALIAS_TTL_SECONDS),
    String(MAX_REFRESH_FAMILY_SESSIONS)
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const committed = await redis.eval(...evalArguments);
      if (committed === 1 || committed === "1") return session;
      if (committed === 0 || committed === "0") return null;
      if (committed === 2 || committed === "2") {
        lastError = new Error("Refresh family active-session capacity exceeded");
        break;
      }
      lastError = new Error("Redis refresh rotation returned an invalid result");
    } catch (error) {
      lastError = error;
    }
  }
  logger.warn({ error: lastError }, "refresh_rotation_failed_redis_unavailable");
  throw serviceUnavailable("Sessions are unavailable right now, try again shortly");
}

const TWO_FACTOR_PENDING_TTL_MIN = 5;

/**
 * A short-lived bridge token between "password verified" and "session issued" for 2FA
 * accounts. It is not a real session and cannot authenticate any other endpoint. The
 * nonce is tracked in Redis so a successfully verified bridge cannot be replayed, while
 * the session version prevents a bridge issued before logout-all/password reset from
 * minting a fresh session afterwards.
 */
export async function issueTwoFactorPendingToken(
  userId: string,
  sessionVersion: number
): Promise<string> {
  const redis = getRedis();
  if (!redis) throw serviceUnavailable("Authentication is unavailable right now, try again shortly");
  const jti = nanoid();
  await redis.set(`2fa_pending:${jti}`, "1", "EX", TWO_FACTOR_PENDING_TTL_MIN * 60);
  return jwt.sign(
    { sub: userId, purpose: "2fa_pending", sv: sessionVersion, jti },
    env.JWT_SECRET as Secret,
    {
    expiresIn: `${TWO_FACTOR_PENDING_TTL_MIN}m` as SignOptions["expiresIn"]
    }
  );
}

export type TwoFactorPendingIdentity = {
  userId: string;
  sessionVersion: number;
  jti: string;
};

export function verifyTwoFactorPendingToken(token: string): TwoFactorPendingIdentity {
  const payload = jwt.verify(token, env.JWT_SECRET as Secret) as {
    sub?: unknown;
    purpose?: unknown;
    sv?: unknown;
    jti?: unknown;
  };
  if (
    payload.purpose !== "2fa_pending" ||
    typeof payload.sub !== "string" ||
    typeof payload.sv !== "number" ||
    typeof payload.jti !== "string"
  ) {
    throw new Error("Invalid two-factor token");
  }
  return {
    userId: payload.sub,
    sessionVersion: payload.sv,
    jti: payload.jti
  };
}

export async function consumeTwoFactorPendingToken(jti: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) throw serviceUnavailable("Authentication is unavailable right now, try again shortly");
  return (await redis.getdel(`2fa_pending:${jti}`)) !== null;
}

export async function revokeRefreshToken(token: string | undefined, userId?: string) {
  if (!token) return;
  const redis = getRedis();
  if (!redis) return;
  const hash = hashRefreshToken(token);
  await redis.del(`refresh:${hash}`);
  if (userId) await redis.srem(userRefreshKey(userId), hash);
}

export async function revokeSession(jti: string | undefined, userId?: string) {
  if (!jti) return;
  const redis = getRedis();
  try {
    if (redis) {
      const transaction = redis
        .multi()
        .del(`session:${jti}`)
        .set(
          sessionRevokedKey(jti),
          "1",
          "EX",
          env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60
        );
      if (userId) transaction.srem(userSessionsKey(userId), jti);
      await transaction.exec();
    }
  } finally {
    await publishSessionSecurityEvent({
      type: "session.revoked",
      sessionId: jti
    });
  }
}

/**
 * Revokes every session a user currently has (used for logout-everywhere, security
 * changes, password reset, and admin bans). A workflow that uses `exceptJti` must also
 * preserve a usable refresh token for that session.
 */
export async function revokeAllUserSessions(
  userId: string,
  options: {
    exceptJti?: string;
    strict?: boolean;
    publishEvent?: boolean;
  } = {}
) {
  const redis = getRedis();
  let redisError: unknown;
  if (redis) {
    try {
      const result = await redis.eval(
        REVOKE_ALL_USER_SESSIONS_SCRIPT,
        3,
        userSessionsKey(userId),
        userRefreshKey(userId),
        userRefreshFamiliesKey(userId),
        userId,
        options.exceptJti ?? "",
        String(env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60)
      );
      if (result !== 1 && result !== "1") {
        throw new Error("Redis user-session revocation script returned an invalid result");
      }
    } catch (error) {
      redisError = error;
      logger.error({ error, userId }, "revoke_all_user_sessions_failed");
    }
  }

  let realtimeError: unknown;
  if (options.publishEvent !== false) {
    try {
      await publishSessionSecurityEvent(
        {
          type: "user.sessions.revoked",
          userId,
          exceptSessionId: options.exceptJti
        },
        { strict: options.strict }
      );
    } catch (error) {
      realtimeError = error;
    }
  }
  if (options.strict && redisError) throw redisError;
  if (options.strict && realtimeError) throw realtimeError;
}
