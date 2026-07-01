// Base configuration shared across all k6 scenarios.
// Override BASE_URL via environment: k6 run -e BASE_URL=https://staging.example.com script.js

export const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
export const WS_URL = __ENV.WS_URL || "ws://localhost:4000/ws";

// Default thresholds that apply to every scenario.
export const defaultThresholds = {
  http_req_duration: ["p(95)<2000", "p(99)<5000"],
  http_req_failed: ["rate<0.05"]
};
