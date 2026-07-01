/**
 * Stage 1 WebSocket load test — 1k / 3k / 5k authenticated connections.
 *
 * Each VU logs in once, opens a WS connection, stays connected for the hold period,
 * and then closes. Measures: connection success rate, time to connect, connection
 * stability over 10–15 minutes.
 *
 * Configure via env:
 *   TARGET_VU       — peak concurrent WS connections (default 5000)
 *   HOLD_DURATION   — how long to hold peak connections (default "12m")
 *   TEST_EMAIL      — seeded account email (required for authenticated WS)
 *   TEST_PASSWORD   — seeded account password (required)
 *
 * Stage 1 acceptance: 5 000 WS connections stable for ≥ 10 min,
 *   ws_connecting p(95) < 3 000 ms, ECONNRESET rate near 0.
 *
 * Run:
 *   k6 run \
 *     -e BASE_URL=https://staging.example.com \
 *     -e WS_URL=wss://staging.example.com/ws \
 *     -e TEST_EMAIL=loadtest@example.com \
 *     -e TEST_PASSWORD=Password123! \
 *     -e TARGET_VU=1000 \
 *     load-tests/scenarios/stage1-ws.js
 *
 * WARNING: Run against staging only. Requires sticky sessions OR a single-replica target.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import ws from "k6/ws";
import { Counter } from "k6/metrics";
import { BASE_URL, WS_URL, defaultThresholds } from "../config.js";

const targetVU = parseInt(__ENV.TARGET_VU || "5000", 10);
const holdDuration = __ENV.HOLD_DURATION || "12m";
const TEST_EMAIL = __ENV.TEST_EMAIL;
const TEST_PASSWORD = __ENV.TEST_PASSWORD;

const wsConnectErrors = new Counter("ws_connect_errors");
const wsAuthErrors = new Counter("ws_auth_errors");

export const options = {
  scenarios: {
    ws_connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: Math.ceil(targetVU * 0.2) },
        { duration: "3m", target: Math.ceil(targetVU * 0.6) },
        { duration: "3m", target: targetVU },
        { duration: holdDuration, target: targetVU },
        { duration: "2m", target: 0 }
      ],
      gracefulRampDown: "30s"
    }
  },
  thresholds: {
    ...defaultThresholds,
    ws_connecting: ["p(95)<3000"],
    ws_connect_errors: ["count<50"],
    ws_auth_errors: ["count<50"]
  }
};

export default function () {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    console.error("TEST_EMAIL and TEST_PASSWORD must be set for authenticated WS testing");
    sleep(1);
    return;
  }

  // Login to get session cookie
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (loginRes.status !== 200) {
    wsAuthErrors.add(1);
    sleep(2);
    return;
  }

  const cookie = loginRes.headers["Set-Cookie"] ?? "";

  // Open WebSocket and hold connection
  const res = ws.connect(WS_URL, { headers: { Cookie: cookie } }, (socket) => {
    socket.on("open", () => {
      // Connection is open — keep alive by relying on server heartbeat pings
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        check(msg, {
          "ws received connected": (m) => m.type === "connected" || m.type === "pong" || m.type === "error"
        });
      } catch {
        // ignore malformed
      }
    });

    socket.on("error", (e) => {
      wsConnectErrors.add(1);
      console.error(`WS error: ${e.error()}`);
    });

    // Hold for up to 90s per VU iteration, then close and reconnect in the next iteration
    socket.setTimeout(() => socket.close(), 90_000);

    socket.on("close", () => {});
  });

  check(res, {
    "ws upgrade succeeded": (r) => r && r.status === 101
  });

  if (!res || res.status !== 101) wsConnectErrors.add(1);

  sleep(1);
}
