import os from "node:os";

type HeartbeatRedis = {
  set(
    key: string,
    value: string,
    mode: "PX",
    ttlMs: number
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export function runtimeHeartbeatKey(
  service: "worker" | "outbox",
  instanceId = os.hostname()
) {
  return `skrynia:runtime:heartbeat:${service}:${instanceId}`;
}

export class RuntimeHeartbeat {
  readonly key: string;
  private timer: NodeJS.Timeout | null = null;
  private currentBeat: Promise<boolean> | null = null;
  private ready = false;
  private stopping = false;

  constructor(
    private readonly options: {
      service: "worker" | "outbox";
      redis: HeartbeatRedis;
      intervalMs: number;
      ttlMs: number;
      probe: () => Promise<boolean>;
      instanceId?: string;
      now?: () => Date;
      onError?: (error: unknown) => void;
    }
  ) {
    this.key = runtimeHeartbeatKey(options.service, options.instanceId);
  }

  async start() {
    if (this.timer) return;
    this.stopping = false;
    await this.beat();
    if (this.stopping) return;
    this.timer = setInterval(() => void this.beat(), this.options.intervalMs);
    this.timer.unref?.();
  }

  beat(): Promise<boolean> {
    if (this.stopping) return Promise.resolve(false);
    if (this.currentBeat) return this.currentBeat;
    this.currentBeat = this.writeBeat().finally(() => {
      this.currentBeat = null;
    });
    return this.currentBeat;
  }

  private async writeBeat() {
    try {
      const healthy = await this.options.probe();
      if (!healthy) {
        this.ready = false;
        await this.options.redis.del(this.key);
        return false;
      }
      if (this.stopping) {
        this.ready = false;
        await this.options.redis.del(this.key);
        return false;
      }
      const timestamp = (this.options.now?.() ?? new Date()).toISOString();
      await this.options.redis.set(
        this.key,
        JSON.stringify({
          status: "ready",
          service: this.options.service,
          pid: process.pid,
          timestamp
        }),
        "PX",
        this.options.ttlMs
      );
      if (this.stopping) {
        this.ready = false;
        await this.options.redis.del(this.key);
        return false;
      }
      this.ready = true;
      return true;
    } catch (error) {
      this.ready = false;
      this.options.onError?.(error);
      return false;
    }
  }

  async markNotReady() {
    this.ready = false;
    try {
      await this.options.redis.del(this.key);
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  beginShutdown() {
    this.stopping = true;
    this.ready = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async stop() {
    this.beginShutdown();
    await this.currentBeat;
    await this.markNotReady();
  }

  isReady() {
    return this.ready;
  }
}
