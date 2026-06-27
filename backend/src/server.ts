import http from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { attachWebSocketServer } from "./modules/chat/ws.service.js";
import { startJobWorker } from "./modules/jobs/queue.js";
import { initErrorTracking } from "./common/middleware/request-context.js";
import { logger } from "./common/logger.js";

initErrorTracking();
const app = createApp();
const server = http.createServer(app);
attachWebSocketServer(server);
startJobWorker();

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "api_listening");
});
