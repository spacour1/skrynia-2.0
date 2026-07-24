import type { Express, Request, Response } from "express";
import { withTimeout } from "./async.js";

export type HealthServiceName = "api" | "worker" | "outbox";

export type HealthDependency = {
  name: string;
  check: () => Promise<void>;
};

export type HealthStatus = "ok" | "unavailable";

export type ReadinessResponse = {
  status: HealthStatus;
  service: HealthServiceName;
  timestamp: string;
  checks: Record<string, HealthStatus>;
};

export class ReadinessGate {
  private acceptingRequests: boolean;

  constructor(initiallyReady = false) {
    this.acceptingRequests = initiallyReady;
  }

  markReady() {
    this.acceptingRequests = true;
  }

  markNotReady() {
    this.acceptingRequests = false;
  }

  isReady() {
    return this.acceptingRequests;
  }
}

export class HealthService {
  private inFlightReadiness: Promise<ReadinessResponse> | null = null;
  private cachedReadiness:
    | { response: ReadinessResponse; expiresAtMs: number }
    | null = null;
  private readonly dependencyProbes = new Map<string, Promise<void>>();

  constructor(
    private readonly options: {
      service: HealthServiceName;
      gate: ReadinessGate;
      dependencies: HealthDependency[];
      timeoutMs: number;
      cacheTtlMs?: number;
      now?: () => Date;
      nowMs?: () => number;
    }
  ) {}

  live() {
    return {
      status: "ok" as const,
      service: this.options.service,
      timestamp: this.now().toISOString()
    };
  }

  readiness(): Promise<ReadinessResponse> {
    if (!this.options.gate.isReady()) {
      return Promise.resolve({
        status: "unavailable",
        service: this.options.service,
        timestamp: this.now().toISOString(),
        checks: { process: "unavailable" }
      });
    }

    const cached = this.cachedReadiness;
    if (cached && cached.expiresAtMs > this.monotonicNow()) {
      return Promise.resolve(cached.response);
    }

    if (!this.inFlightReadiness) {
      this.inFlightReadiness = this.runReadiness()
        .then((response) => {
          this.cachedReadiness = {
            response,
            expiresAtMs: this.monotonicNow() + this.cacheTtlMs()
          };
          return response;
        })
        .finally(() => {
          this.inFlightReadiness = null;
        });
    }
    return this.inFlightReadiness;
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }

  private monotonicNow() {
    return this.options.nowMs?.() ?? Date.now();
  }

  private cacheTtlMs() {
    return (
      this.options.cacheTtlMs ??
      Math.max(100, Math.min(this.options.timeoutMs, 1_000))
    );
  }

  private dependencyProbe(dependency: HealthDependency) {
    const existing = this.dependencyProbes.get(dependency.name);
    if (existing) return existing;

    let probe: Promise<void>;
    try {
      probe = Promise.resolve(dependency.check());
    } catch (error) {
      probe = Promise.reject(error);
    }
    this.dependencyProbes.set(dependency.name, probe);
    void probe
      .finally(() => {
        if (this.dependencyProbes.get(dependency.name) === probe) {
          this.dependencyProbes.delete(dependency.name);
        }
      })
      .catch(() => {
        // `runReadiness` observes and sanitizes the original probe rejection. This
        // catch handles only the promise returned by `finally`.
      });
    return probe;
  }

  private async runReadiness(): Promise<ReadinessResponse> {
    const checks: Record<string, HealthStatus> = { process: "ok" };
    const outcomes = await Promise.all(
      this.options.dependencies.map(async (dependency) => {
        try {
          await withTimeout(
            this.dependencyProbe(dependency),
            this.options.timeoutMs,
            `${dependency.name} health check timed out`
          );
          return [dependency.name, "ok"] as const;
        } catch {
          // Dependency details are deliberately kept out of the public response. In
          // particular, pg/ioredis errors may contain internal hostnames or addresses.
          return [dependency.name, "unavailable"] as const;
        }
      })
    );

    for (const [name, status] of outcomes) checks[name] = status;
    if (!this.options.gate.isReady()) checks.process = "unavailable";
    const ok = Object.values(checks).every((status) => status === "ok");
    return {
      status: ok ? "ok" : "unavailable",
      service: this.options.service,
      timestamp: this.now().toISOString(),
      checks
    };
  }
}

export function mountHealthRoutes(app: Pick<Express, "get">, health: HealthService) {
  const live = (_req: Request, res: Response) => res.json(health.live());
  app.get("/health/live", live);
  // Temporary compatibility alias for existing load balancers and local scripts.
  app.get("/health", live);
  app.get("/health/ready", async (_req: Request, res: Response) => {
    const readiness = await health.readiness();
    res.status(readiness.status === "ok" ? 200 : 503).json(readiness);
  });
}
