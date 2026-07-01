import crypto from "node:crypto";
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../../config/env.js";
import { getRedis } from "../redis.js";
import { rateLimitHitsTotal } from "../metrics.js";

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
  const credentials = header?.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString("utf8") : "";
  const [user, password] = credentials.split(":");

  if (!user || !password || !timingSafeEqual(user, env.METRICS_USER) || !timingSafeEqual(password, env.METRICS_PASSWORD)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="metrics"');
    return res.status(401).send("Unauthorized");
  }
  next();
};

function keyByUserOrIp(req: any) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
}

// Returns a Redis-backed store when REDIS_URL is configured; undefined falls back to
// the default in-memory store (per-replica, not globally shared across API instances).
function makeStore(prefix: string) {
  const client = getRedis();
  if (!client) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => (client as any).call(args[0], ...args.slice(1)) as Promise<any>,
  });
}

function rateLimitResponse(_req: any, res: any) {
  rateLimitHitsTotal.inc();
  return res.status(429).json({
    error: {
      code: "rate_limited",
      message: "Too many requests",
      traceId: _req.traceId
    }
  });
}

// Auth: strict per-IP limit over a 15-minute window to slow credential stuffing.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_PER_15MIN,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("rl:auth:"),
  keyGenerator: (req) => `auth:${req.ip}`,
  handler: rateLimitResponse
});

// General API: moderate per-user/IP limit. Skips public marketplace GETs — those are
// handled by publicReadRateLimit which carries a higher bucket for anonymous browsing.
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: env.API_RATE_LIMIT_PER_MIN,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("rl:api:"),
  keyGenerator: keyByUserOrIp,
  skip: (req) => req.method === "GET" && req.path.startsWith("/marketplace"),
  handler: rateLimitResponse
});

// Public read marketplace: high limit for anonymous browsing bursts.
// Applied only to GET requests on /marketplace/* in app.ts.
export const publicReadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: env.PUBLIC_READ_RATE_LIMIT_PER_MIN,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("rl:pub:"),
  skip: (req) => req.method !== "GET",
  keyGenerator: (req) => `pub:${req.ip}`,
  handler: rateLimitResponse
});

export const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("rl:webhook:"),
  keyGenerator: (req) => `webhook:${req.ip}`,
  handler: rateLimitResponse
});

export const writeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("rl:write:"),
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  keyGenerator: (req) => `write:${keyByUserOrIp(req)}`,
  handler: rateLimitResponse
});
