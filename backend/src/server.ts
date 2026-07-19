import dns from "node:dns";
import http from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { attachWebSocketServer } from "./modules/chat/ws.service.js";
import { startJobWorker } from "./modules/jobs/queue.js";
import { initErrorTracking } from "./common/middleware/request-context.js";
import { logger } from "./common/logger.js";
import { migrateLegacyTwoFactorSecrets } from "./modules/auth/twofa.service.js";

// Railway containers have no outbound IPv6 route, but Node's default DNS order
// returns IPv6 addresses first - that made every SMTP connection to smtp.gmail.com
// fail with ENETUNREACH on its IPv6 address before falling back. Forcing IPv4 first
// avoids that dead end for nodemailer (and any other outbound connection).
dns.setDefaultResultOrder("ipv4first");

initErrorTracking();
const app = createApp();
const server = http.createServer(app);

async function startServer() {
  const migratedTwoFactorSecrets = await migrateLegacyTwoFactorSecrets();
  if (migratedTwoFactorSecrets > 0) {
    logger.info({ count: migratedTwoFactorSecrets }, "legacy_two_factor_secrets_encrypted");
  }

  attachWebSocketServer(server);
  startJobWorker();
  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "api_listening");
  });
}

startServer().catch((error) => {
  logger.fatal({ error }, "api_start_failed");
  process.exitCode = 1;
});
