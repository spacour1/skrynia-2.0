import type { Server } from "node:http";

/** Stops new connections and resolves after every active HTTP request finishes. */
export function beginHttpShutdown(server: Server) {
  const closed = new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
  server.closeIdleConnections?.();
  return closed;
}
