/**
 * Stage 1 mixed scenario — realistic traffic blend:
 *   70% anonymous marketplace browsing
 *   20% authenticated user actions (login → me → product detail)
 *   10% light checkout (view product → attempt buy — does NOT place a real order)
 *
 * Configure via env:
 *   TARGET_VU       — peak VUs across all groups (default 500)
 *   RAMP_DURATION   — ramp-up time (default "3m")
 *   HOLD_DURATION   — sustained load time (default "10m")
 *   TEST_EMAIL / TEST_PASSWORD — seeded account for authenticated segments
 *
 * Run:
 *   k6 run \
 *     -e BASE_URL=https://staging.example.com \
 *     -e TEST_EMAIL=buyer@example.com \
 *     -e TEST_PASSWORD=Password123! \
 *     -e TARGET_VU=200 \
 *     load-tests/scenarios/stage1-mixed.js
 *
 * WARNING: checkout segment reads product details but does NOT submit orders.
 * For full order flow tests use order-flow.js against staging with ENABLE_TEST_PAYMENTS=true.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { BASE_URL, defaultThresholds } from "../config.js";

const targetVU = parseInt(__ENV.TARGET_VU || "500", 10);
const rampDuration = __ENV.RAMP_DURATION || "3m";
const holdDuration = __ENV.HOLD_DURATION || "10m";
const TEST_EMAIL = __ENV.TEST_EMAIL;
const TEST_PASSWORD = __ENV.TEST_PASSWORD;

const rateLimitedTotal = new Counter("rate_limited_responses");
const authDuration = new Trend("auth_login_duration", true);
const productDetailDuration = new Trend("product_detail_duration", true);

const browseVU = Math.ceil(targetVU * 0.7);
const authVU = Math.ceil(targetVU * 0.2);
const checkoutVU = Math.ceil(targetVU * 0.1);

const stages = [
  { duration: rampDuration, target: targetVU },
  { duration: holdDuration, target: targetVU },
  { duration: "1m", target: 0 }
];

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: stages.map((s) => ({ ...s, target: Math.ceil(s.target * 0.7) })),
      exec: "browseFn",
      gracefulRampDown: "30s"
    },
    authenticated: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: stages.map((s) => ({ ...s, target: Math.ceil(s.target * 0.2) })),
      exec: "authenticatedFn",
      gracefulRampDown: "30s"
    },
    checkout_read: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: stages.map((s) => ({ ...s, target: Math.ceil(s.target * 0.1) })),
      exec: "checkoutReadFn",
      gracefulRampDown: "30s"
    }
  },
  thresholds: {
    ...defaultThresholds,
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    http_req_failed: ["rate<0.05"],
    rate_limited_responses: ["count<200"],
    product_detail_duration: ["p(95)<1500"],
    auth_login_duration: ["p(95)<3000"]
  }
};

export function browseFn() {
  const listRes = http.get(`${BASE_URL}/marketplace/products?sort=newest&limit=20&page=1`);
  if (listRes.status === 429) rateLimitedTotal.add(1);
  check(listRes, { "products 2xx": (r) => r.status < 400 });

  sleep(0.5);

  http.get(`${BASE_URL}/marketplace/games`);

  sleep(0.3);

  let products = [];
  try { products = JSON.parse(listRes.body).products ?? []; } catch { }

  if (products.length > 0) {
    const id = products[Math.floor(Math.random() * Math.min(products.length, 5))].id;
    const start = Date.now();
    const detailRes = http.get(`${BASE_URL}/marketplace/products/${id}`);
    productDetailDuration.add(Date.now() - start);
    if (detailRes.status === 429) rateLimitedTotal.add(1);
    check(detailRes, { "detail 2xx": (r) => r.status < 400 });
  }

  sleep(1);
}

export function authenticatedFn() {
  if (!TEST_EMAIL || !TEST_PASSWORD) { sleep(3); return; }

  const start = Date.now();
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  authDuration.add(Date.now() - start);

  check(loginRes, { "login 200": (r) => r.status === 200 });
  if (loginRes.status !== 200) { sleep(2); return; }

  const cookie = loginRes.headers["Set-Cookie"] ?? "";
  const meRes = http.get(`${BASE_URL}/auth/me`, { headers: { Cookie: cookie } });
  check(meRes, { "me 200": (r) => r.status === 200 });

  sleep(2);
}

export function checkoutReadFn() {
  const listRes = http.get(`${BASE_URL}/marketplace/products?sort=newest&limit=20&page=1`);
  if (listRes.status === 429) rateLimitedTotal.add(1);

  let products = [];
  try { products = JSON.parse(listRes.body).products ?? []; } catch { }

  if (products.length > 0) {
    const id = products[Math.floor(Math.random() * Math.min(products.length, 5))].id;
    const detailRes = http.get(`${BASE_URL}/marketplace/products/${id}`);
    check(detailRes, { "checkout detail 2xx": (r) => r.status < 400 });
    // Intentionally not placing an order — checkout read only.
    // For full order flow: use order-flow.js with ENABLE_TEST_PAYMENTS=true on staging.
  }

  sleep(1.5);
}
