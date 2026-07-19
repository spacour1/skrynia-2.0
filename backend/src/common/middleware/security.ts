import crypto from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { ACCESS_COOKIE } from "../cookies.js";
import { rateLimitHitsTotal } from "../metrics.js";
import { getRedis } from "../redis.js";
import { requestPath as safeRequestPath } from "../request-url.js";

function timingSafeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export const metricsAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  const credentials = header?.startsWith("Basic ")
    ? Buffer.from(header.slice(6), "base64").toString("utf8")
    : "";
  const [user, password] = credentials.split(":");

  if (
    !user ||
    !password ||
    !timingSafeEqual(user, env.METRICS_USER) ||
    !timingSafeEqual(password, env.METRICS_PASSWORD)
  ) {
    res.setHeader("WWW-Authenticate", 'Basic realm="metrics"');
    return res.status(401).send("Unauthorized");
  }
  next();
};

type AccessTokenPayload = {
  sub?: unknown;
  jti?: unknown;
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEDICATED_WRITE_PATHS = new Set([
  "/auth/register",
  "/auth/login",
  "/auth/2fa/verify",
  "/auth/telegram",
  "/auth/verify-email/request",
  "/auth/verify-email/confirm",
  "/auth/password/forgot",
  "/auth/password/reset",
  "/auth/ws-ticket",
  "/users/me/password",
  "/users/me/phone/request",
  "/users/me/phone/confirm",
  "/users/me/2fa/setup",
  "/users/me/2fa/enable",
  "/users/me/2fa/disable",
  "/users/me/2fa/backup-codes/regenerate",
  "/users/me/telegram/connect",
  "/payments/liqpay/callback",
  "/payments/monobank/callback",
  "/payments/wayforpay/callback",
  "/telegram/webhook"
]);

function requestPath(req: Request) {
  const path = safeRequestPath(req).replace(/\/+$/, "");
  return path || "/";
}

function hasDedicatedWriteLimiter(req: Request) {
  return DEDICATED_WRITE_PATHS.has(requestPath(req));
}

function requestIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function requestUserId(req: Request) {
  return req.user?.id ?? req.rateLimitUserId;
}

function requestSessionId(req: Request) {
  return req.sessionId ?? req.rateLimitSessionId;
}

function hashIdentity(kind: string, value: string) {
  return crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${kind}:${value}`)
    .digest("hex");
}

function bodyString(req: Request, key: string) {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function credentialIdentity(req: Request) {
  const email = bodyString(req, "email") ?? req.user?.email;
  if (email) return `email:${hashIdentity("email", email.trim().toLowerCase())}`;

  const twoFactorToken = bodyString(req, "twoFactorToken");
  if (twoFactorToken) {
    return `two-factor:${hashIdentity("two-factor", twoFactorToken)}`;
  }

  const telegramId = (req.body as Record<string, unknown> | undefined)?.id;
  if (typeof telegramId === "string" || typeof telegramId === "number") {
    return `telegram:${hashIdentity("telegram", String(telegramId))}`;
  }
  return undefined;
}

function emailVerificationIdentity(req: Request) {
  if (req.user?.email) {
    return `email:${hashIdentity("email", req.user.email.trim().toLowerCase())}`;
  }
  const token = bodyString(req, "token");
  return token
    ? `token:${hashIdentity("email-verification-token", token)}`
    : undefined;
}

function passwordResetIdentity(req: Request) {
  const email = bodyString(req, "email");
  if (email) return `email:${hashIdentity("email", email.trim().toLowerCase())}`;
  const token = bodyString(req, "token");
  return token
    ? `token:${hashIdentity("password-reset-token", token)}`
    : undefined;
}

// This verifies only the signed token envelope. It does not authorize, check revocation,
// query a user, or reject invalid input. Route-level authenticate remains the security
// decision; this identity exists only to select a stable global rate-limit bucket.
export const identifyRateLimitSubject: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (typeof token === "string" && token.length > 0) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
      if (typeof payload.sub === "string" && typeof payload.jti === "string") {
        req.rateLimitUserId = payload.sub;
        req.rateLimitSessionId = payload.jti;
      }
    } catch {
      // Invalid and expired cookies continue in the anonymous IP bucket.
    }
  }
  next();
};

// Redis makes limits shared by every API replica. Without REDIS_URL, express-rate-limit
// falls back to its per-process memory store.
function makeStore(prefix: string) {
  const client = getRedis();
  if (!client) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      (client as any).call(args[0], ...args.slice(1)) as Promise<any>
  });
}

function retryAfterSeconds(req: Request) {
  const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit
    ?.resetTime;
  if (!resetTime) return 1;
  return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
}

function rateLimitResponse(req: Request, res: Response) {
  rateLimitHitsTotal.inc();
  const retryAfter = retryAfterSeconds(req);
  res.setHeader("Retry-After", String(retryAfter));
  return res.status(429).json({
    error: {
      code: "rate_limited",
      message: "Too many requests",
      traceId: req.traceId,
      retryAfterSeconds: retryAfter
    }
  });
}

function composeMiddleware(...handlers: RequestHandler[]): RequestHandler {
  const router = Router();
  router.use(...handlers);
  return router;
}

function commonOptions(prefix: string) {
  return {
    standardHeaders: "draft-7" as const,
    legacyHeaders: false,
    store: makeStore(prefix),
    handler: rateLimitResponse
  };
}

function ipLimiter(
  prefix: string,
  windowMs: number,
  limit: number,
  skip?: (req: Request) => boolean
) {
  return rateLimit({
    ...commonOptions(prefix),
    windowMs,
    limit,
    skip,
    keyGenerator: (req) => `ip:${requestIp(req)}`
  });
}

function subjectLimiter(
  prefix: string,
  windowMs: number,
  limit: number,
  identity: (req: Request) => string | undefined,
  skip?: (req: Request) => boolean
) {
  return rateLimit({
    ...commonOptions(prefix),
    windowMs,
    limit,
    skip: (req) => Boolean(skip?.(req)) || !identity(req),
    keyGenerator: (req) => identity(req) ?? "missing"
  });
}

// Mounted only on public marketplace GET routes.
export const publicReadRateLimit = rateLimit({
  ...commonOptions("rl:public-read:"),
  windowMs: 60 * 1000,
  limit: env.PUBLIC_READ_RATE_LIMIT_PER_MIN,
  skip: (req) => req.method !== "GET",
  keyGenerator: (req) => `ip:${requestIp(req)}`
});

const skipGeneralAnonymousWrite = (req: Request) =>
  !MUTATING_METHODS.has(req.method) ||
  Boolean(requestUserId(req)) ||
  hasDedicatedWriteLimiter(req);

export const anonymousWriteRateLimit = ipLimiter(
  "rl:anonymous-write:",
  60 * 1000,
  env.ANONYMOUS_WRITE_RATE_LIMIT_PER_MIN,
  skipGeneralAnonymousWrite
);

const skipGeneralAuthenticatedWrite = (req: Request) =>
  !MUTATING_METHODS.has(req.method) ||
  !requestUserId(req) ||
  hasDedicatedWriteLimiter(req);

export const authenticatedWriteRateLimit = composeMiddleware(
  subjectLimiter(
    "rl:authenticated-write:user:",
    60 * 1000,
    env.AUTHENTICATED_WRITE_RATE_LIMIT_PER_MIN,
    (req) => {
      const userId = requestUserId(req);
      return userId ? `user:${userId}` : undefined;
    },
    skipGeneralAuthenticatedWrite
  ),
  ipLimiter(
    "rl:authenticated-write:ip:",
    60 * 1000,
    env.AUTHENTICATED_WRITE_RATE_LIMIT_PER_IP,
    skipGeneralAuthenticatedWrite
  )
);

export const credentialRateLimit = composeMiddleware(
  subjectLimiter(
    "rl:credential:identity:",
    15 * 60 * 1000,
    env.CREDENTIAL_RATE_LIMIT_PER_IDENTITY_15MIN,
    credentialIdentity
  ),
  ipLimiter(
    "rl:credential:ip:",
    15 * 60 * 1000,
    env.CREDENTIAL_RATE_LIMIT_PER_15MIN
  )
);

export const wsTicketRateLimit = composeMiddleware(
  subjectLimiter(
    "rl:ws-ticket:session:",
    60 * 1000,
    env.WS_TICKET_RATE_LIMIT_PER_MIN,
    (req) => {
      const sessionId = requestSessionId(req);
      if (sessionId) return `session:${sessionId}`;
      const userId = requestUserId(req);
      return userId ? `user:${userId}` : undefined;
    }
  ),
  ipLimiter("rl:ws-ticket:ip:", 60 * 1000, env.WS_TICKET_RATE_LIMIT_PER_IP)
);

const preparePhoneRateLimitIdentity: RequestHandler = async (req, _res, next) => {
  try {
    let phone = bodyString(req, "phone");
    if (!phone && req.user?.id) {
      const result = await pool.query<{ phone: string | null }>(
        `select phone from users where id = $1`,
        [req.user.id]
      );
      phone = result.rows[0]?.phone ?? undefined;
    }
    req.rateLimitPhoneHash = phone
      ? hashIdentity("phone", phone.trim())
      : undefined;
    next();
  } catch (error) {
    next(error);
  }
};

export const phoneOtpRateLimit = composeMiddleware(
  preparePhoneRateLimitIdentity,
  subjectLimiter(
    "rl:phone-otp:user:",
    15 * 60 * 1000,
    env.PHONE_OTP_RATE_LIMIT_PER_15MIN,
    (req) => {
      const userId = requestUserId(req);
      return userId ? `user:${userId}` : undefined;
    }
  ),
  subjectLimiter(
    "rl:phone-otp:phone:",
    15 * 60 * 1000,
    env.PHONE_OTP_RATE_LIMIT_PER_15MIN,
    (req) =>
      req.rateLimitPhoneHash ? `phone:${req.rateLimitPhoneHash}` : undefined
  ),
  ipLimiter(
    "rl:phone-otp:ip:",
    15 * 60 * 1000,
    env.PHONE_OTP_RATE_LIMIT_PER_IP_15MIN
  )
);

export const emailVerificationRateLimit = composeMiddleware(
  subjectLimiter(
    "rl:email-verification:identity:",
    15 * 60 * 1000,
    env.EMAIL_VERIFICATION_RATE_LIMIT_PER_15MIN,
    emailVerificationIdentity
  ),
  ipLimiter(
    "rl:email-verification:ip:",
    15 * 60 * 1000,
    env.EMAIL_VERIFICATION_RATE_LIMIT_PER_IP_15MIN
  )
);

export const passwordResetRateLimit = composeMiddleware(
  subjectLimiter(
    "rl:password-reset:identity:",
    15 * 60 * 1000,
    env.PASSWORD_RESET_RATE_LIMIT_PER_15MIN,
    passwordResetIdentity
  ),
  ipLimiter(
    "rl:password-reset:ip:",
    15 * 60 * 1000,
    env.PASSWORD_RESET_RATE_LIMIT_PER_IP_15MIN
  )
);

export const webhookRateLimit = rateLimit({
  ...commonOptions("rl:webhook:"),
  windowMs: 60 * 1000,
  limit: env.WEBHOOK_RATE_LIMIT_PER_MIN,
  keyGenerator: (req) => `ip:${requestIp(req)}`
});
