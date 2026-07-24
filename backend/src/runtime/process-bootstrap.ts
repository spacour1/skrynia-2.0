import dns from "node:dns";
import { initErrorTracking } from "../common/middleware/request-context.js";

export function initializeRuntimeProcess() {
  // Several deployment platforms have no outbound IPv6 route. This applies to API,
  // worker and outbox processes because each role can perform outbound delivery.
  dns.setDefaultResultOrder("ipv4first");
  initErrorTracking();
}
