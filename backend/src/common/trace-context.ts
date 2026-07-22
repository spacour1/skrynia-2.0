import { AsyncLocalStorage } from "node:async_hooks";

type TraceContext = Readonly<{ traceId: string }>;

const traceContext = new AsyncLocalStorage<TraceContext>();

/**
 * Runs work inside the current request's trace scope. AsyncLocalStorage keeps the
 * value attached to the promise/async-resource chain, so lower-level services can
 * correlate logs without threading an Express request through every call site.
 */
export function runWithTraceId<T>(traceId: string, callback: () => T): T {
  return traceContext.run({ traceId }, callback);
}

/** Returns the active HTTP trace ID, or undefined for background/startup work. */
export function currentTraceId(): string | undefined {
  return traceContext.getStore()?.traceId;
}
