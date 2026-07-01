/**
 * Order flow smoke test using mock (test) payments.
 *
 * IMPORTANT: This test MUST only run against staging with ENABLE_TEST_PAYMENTS=true.
 *            NEVER run against production — it creates real orders.
 *
 * Prerequisites:
 *   - Backend must have ENABLE_TEST_PAYMENTS=true
 *   - TEST_BUYER_EMAIL / TEST_BUYER_PASSWORD — a buyer account
 *   - TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD — a seller with an active product
 *   - TEST_PRODUCT_ID — UUID of an active product owned by the seller
 *
 * Run:
 *   k6 run \
 *     -e BASE_URL=https://staging.example.com \
 *     -e TEST_BUYER_EMAIL=buyer@example.com \
 *     -e TEST_BUYER_PASSWORD=buyerpassword \
 *     -e TEST_PRODUCT_ID=<uuid> \
 *     load-tests/scenarios/order-flow.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "../config.js";

const BUYER_EMAIL = __ENV.TEST_BUYER_EMAIL;
const BUYER_PASSWORD = __ENV.TEST_BUYER_PASSWORD;
const PRODUCT_ID = __ENV.TEST_PRODUCT_ID;

export const options = {
  // Low VU count — order flow is database-heavy
  scenarios: {
    order_smoke: {
      executor: "constant-vus",
      vus: 5,
      duration: "2m"
    }
  },
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    http_req_failed: ["rate<0.1"]
  }
};

export default function () {
  if (!BUYER_EMAIL || !BUYER_PASSWORD || !PRODUCT_ID) {
    console.error("TEST_BUYER_EMAIL, TEST_BUYER_PASSWORD, TEST_PRODUCT_ID are all required");
    return;
  }

  // 1. Login as buyer
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: BUYER_EMAIL, password: BUYER_PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(loginRes, { "buyer login 200": (r) => r.status === 200 });
  if (loginRes.status !== 200) {
    sleep(2);
    return;
  }

  const cookie = loginRes.headers["Set-Cookie"] ?? "";
  const authedHeaders = {
    "Content-Type": "application/json",
    Cookie: cookie
  };

  sleep(0.5);

  // 2. Create an order
  const orderRes = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }),
    { headers: authedHeaders }
  );
  check(orderRes, { "create order 201": (r) => r.status === 201 });
  if (orderRes.status !== 201) {
    sleep(2);
    return;
  }

  let orderId;
  try {
    orderId = JSON.parse(orderRes.body).order.id;
  } catch {
    sleep(2);
    return;
  }

  sleep(0.5);

  // 3. Trigger test payment success (requires ENABLE_TEST_PAYMENTS=true on backend)
  const payRes = http.post(
    `${BASE_URL}/payments/test/orders/${orderId}/success`,
    null,
    { headers: authedHeaders }
  );
  check(payRes, { "test payment success 200": (r) => r.status === 200 });

  sleep(0.5);

  // 4. Verify order status is now "paid" or "in_progress"
  const statusRes = http.get(`${BASE_URL}/orders/${orderId}`, { headers: authedHeaders });
  check(statusRes, {
    "order status 200": (r) => r.status === 200,
    "order is paid or in_progress": (r) => {
      try {
        const status = JSON.parse(r.body).order?.status;
        return status === "paid" || status === "in_progress";
      } catch {
        return false;
      }
    }
  });

  sleep(2);
}
