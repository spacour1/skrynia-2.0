/**
 * Stage 1 HTTP load test — public marketplace browsing at 500–1500 RPS.
 *
 * Uses constant-arrival-rate executor so throughput is RPS-driven, not VU-driven.
 * Target: error rate < 5%, p95 < 1500 ms, 429 rate < 1% at 1500 RPS.
 *
 * Configure via env:
 *   TARGET_RPS     — peak RPS (default 1500)
 *   RAMP_DURATION  — ramp-up time (default "3m")
 *   HOLD_DURATION  — sustained load time (default "10m")
 *
 * Run:
 *   k6 run -e BASE_URL=https://staging.example.com \
 *          -e TARGET_RPS=1000 \
 *          load-tests/scenarios/stage1-http.js
 *
 * WARNING: Run against staging only. Do NOT target production.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { BASE_URL, defaultThresholds } from "../config.js";

const targetRps = parseInt(__ENV.TARGET_RPS || "1500", 10);
const rampDuration = __ENV.RAMP_DURATION || "3m";
const holdDuration = __ENV.HOLD_DURATION || "10m";

const rateLimitedTotal = new Counter("rate_limited_responses");

export const options = {
  scenarios: {
    public_browse: {
      executor: "ramping-arrival-rate",
      startRate: 100,
      timeUnit: "1s",
      preAllocatedVUs: Math.ceil(targetRps * 2),
      maxVUs: Math.ceil(targetRps * 4),
      stages: [
        { duration: rampDuration, target: targetRps },
        { duration: holdDuration, target: targetRps },
        { duration: "1m", target: 0 }
      ]
    }
  },
  thresholds: {
    ...defaultThresholds,
    http_req_duration: ["p(95)<1500", "p(99)<3000"],
    http_req_failed: ["rate<0.05"],
    rate_limited_responses: ["count<100"]
  }
};

const ENDPOINTS = [
  () => http.get(`${BASE_URL}/marketplace/products?sort=newest&limit=20&page=1`),
  () => http.get(`${BASE_URL}/marketplace/products?sort=price_asc&limit=20&page=1`),
  () => http.get(`${BASE_URL}/marketplace/products?sort=popularity&limit=20&page=1`),
  () => http.get(`${BASE_URL}/marketplace/games`),
  () => http.get(`${BASE_URL}/marketplace/categories`)
];

export default function () {
  const fn = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  const res = fn();

  if (res.status === 429) rateLimitedTotal.add(1);

  check(res, {
    "2xx or 304": (r) => r.status < 400,
    "not rate limited": (r) => r.status !== 429
  });

  sleep(Math.random() * 0.2);
}
