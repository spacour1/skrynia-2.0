import crypto from "node:crypto";
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";

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

function rateLimitResponse(_req: any, res: any) {
  return res.status(429).json({
    error: {
      code: "rate_limited",
      message: "Too many requests",
      traceId: _req.traceId
    }
  });
}

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `auth:${req.ip}`,
  handler: rateLimitResponse
});

export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  handler: rateLimitResponse
});

export const writeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  keyGenerator: (req) => `write:${keyByUserOrIp(req)}`,
  handler: rateLimitResponse
});
