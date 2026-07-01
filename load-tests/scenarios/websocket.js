/**
 * WebSocket connection smoke test.
 *
 * Connects a number of VUs as anonymous users (unauthenticated WS connections
 * are rejected with 1008 — this test verifies that the server handles the
 * close gracefully and does not crash).
 *
 * For authenticated WS testing, set TEST_EMAIL/TEST_PASSWORD; the script
 * will first log in to obtain a session cookie and then open a WS connection.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:4000 -e WS_URL=ws://localhost:4000/ws \
 *     load-tests/scenarios/websocket.js
 *
 * WARNING: Authenticated WS tests require TEST_EMAIL + TEST_PASSWORD against staging only.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import ws from "k6/ws";
import { BASE_URL, WS_URL, defaultThresholds } from "../config.js";

export const options = {
  scenarios: {
    ws_connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "1m", target: 500 },
        { duration: "30s", target: 0 }
      ]
    }
  },
  thresholds: {
    ...defaultThresholds,
    // WS sessions closing quickly (unauthenticated) is expected
    ws_connecting: ["p(95)<2000"]
  }
};

export default function () {
  const TEST_EMAIL = __ENV.TEST_EMAIL;
  const TEST_PASSWORD = __ENV.TEST_PASSWORD;

  let cookie = "";

  // Optionally authenticate first
  if (TEST_EMAIL && TEST_PASSWORD) {
    const loginRes = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      { headers: { "Content-Type": "application/json" } }
    );
    if (loginRes.status === 200) {
      cookie = loginRes.headers["Set-Cookie"] ?? "";
    }
  }

  const params = cookie ? { headers: { Cookie: cookie } } : {};

  const response = ws.connect(WS_URL, params, (socket) => {
    socket.on("open", () => {
      socket.setTimeout(() => socket.close(), 5000);
    });

    socket.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      check(msg, {
        "received connected or error": (m) =>
          m.type === "connected" || m.type === "error"
      });

      // If connected, wait a bit then close cleanly
      if (msg.type === "connected") {
        socket.setTimeout(() => socket.close(), 3000);
      }
    });

    socket.on("close", () => {});
    socket.on("error", () => {});
  });

  check(response, {
    "ws connected or rejected cleanly": (r) => r && (r.status === 101 || r.status === 403)
  });

  sleep(1);
}
