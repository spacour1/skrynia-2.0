import type { Server } from "node:http";
import { onceAsync, settleWithin } from "./async.js";
import { beginHttpShutdown } from "./http-shutdown.js";

type WebSocketShutdown = {
  beginShutdown(): Promise<unknown>;
};

export function createApiShutdown(options: {
  server: Server;
  getWebSocket: () => WebSocketShutdown | null;
  graceMs: number;
  hardTimeoutMs: number;
  markNotReady: () => void;
  forceClose: () => void;
  cleanup: (hardDeadlineAt: number) => Promise<void>;
}) {
  return onceAsync(async () => {
    const hardDeadlineAt = Date.now() + options.hardTimeoutMs;
    options.markNotReady();
    const httpClosed = beginHttpShutdown(options.server);
    const websocketClosed =
      options.getWebSocket()?.beginShutdown() ?? Promise.resolve();
    const drained = await settleWithin(
      Promise.all([httpClosed, websocketClosed]),
      options.graceMs
    );
    if (!drained) options.forceClose();
    await options.cleanup(hardDeadlineAt);
  });
}
