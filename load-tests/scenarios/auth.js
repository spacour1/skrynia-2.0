/**
 * Auth smoke load test — login with a pre-existing test account.
 *
 * Prerequisites:
 *   - TEST_EMAIL and TEST_PASSWORD env vars must be set to a real seeded account.
 *   - Run against staging/dev only. NEVER run against production.
 *
 * Run:
 *   k6 run \
 *     -e BASE_URL=https://staging.example.com \
 *     -e TEST_EMAIL=loadtest@example.com \
 *     -e TEST_PASSWORD=loadtest123 \
 *     load-tests/scenarios/auth.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, defaultThresholds } from "../config.js";

const TEST_EMAIL = __ENV.TEST_EMAIL;
const TEST_PASSWORD = __ENV.TEST_PASSWORD;

export const options = {
  scenarios: {
    auth_smoke: {
      executor: "constant-vus",
      vus: 10,
      duration: "1m"
    }
  },
  thresholds: {
    ...defaultThresholds,
    http_req_duration: ["p(95)<3000"]
  }
};

export default function () {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    console.error("TEST_EMAIL and TEST_PASSWORD must be set");
    return;
  }

  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );

  check(loginRes, {
    "login 200": (r) => r.status === 200,
    "login sets cookie": (r) => Boolean(r.headers["Set-Cookie"])
  });

  sleep(1);

  // Verify the session works — /users/me requires a valid cookie
  if (loginRes.status === 200) {
    const meRes = http.get(`${BASE_URL}/users/me`, {
      headers: { Cookie: loginRes.headers["Set-Cookie"] ?? "" }
    });
    check(meRes, { "me 200 after login": (r) => r.status === 200 });
  }

  sleep(2);
}
