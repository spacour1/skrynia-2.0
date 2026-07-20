import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";
import { logger } from "../../common/logger.js";

const realtimeEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().trim().min(1).max(100),
  scope: z.enum(["user", "conversation", "session"]),
  targetId: z.string().trim().min(1).max(200),
  payload: z.unknown(),
  sourceInstanceId: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime()
}).refine((event) => Object.prototype.hasOwnProperty.call(event, "payload"), {
  message: "payload is required",
  path: ["payload"]
});

export type RealtimeEvent = {
  id: string;
  type: string;
  scope: "user" | "conversation" | "session";
  targetId: string;
  payload: unknown;
  sourceInstanceId: string;
  createdAt: string;
};
export type RealtimeEventHandler = (
  event: RealtimeEvent
) => void | Promise<void>;

export type RealtimeBusStatus = {
  configured: boolean;
  started: boolean;
  subscriberReady: boolean;
  publisherReady: boolean;
  lastError: string | null;
};

type PublishInput = Pick<
  RealtimeEvent,
  "type" | "scope" | "targetId" | "payload"
> & {
  id?: string;
  createdAt?: string;
};

export class RealtimeEventBus {
  private readonly handlers = new Set<RealtimeEventHandler>();
  private subscriber: Redis | null = null;
  private subscribePromise: Promise<void> | null = null;
  private started = false;
  private subscriberReady = false;
  private publisherReady = false;
  private lastError: string | null = null;

  constructor(
    private readonly options: {
      publisher: Redis | null;
      instanceId: string;
      channel: string;
      onStatusChange?: () => void;
    }
  ) {}

  get instanceId() {
    return this.options.instanceId;
  }

  getStatus(): RealtimeBusStatus {
    return {
      configured: Boolean(this.options.publisher),
      started: this.started,
      subscriberReady: this.subscriberReady,
      publisherReady: this.publisherReady,
      lastError: this.lastError
    };
  }

  onEvent(handler: RealtimeEventHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private setStatus(
    patch: Partial<
      Pick<
        RealtimeBusStatus,
        "subscriberReady" | "publisherReady" | "lastError"
      >
    >
  ) {
    if (patch.subscriberReady !== undefined) {
      this.subscriberReady = patch.subscriberReady;
    }
    if (patch.publisherReady !== undefined) {
      this.publisherReady = patch.publisherReady;
    }
    if (patch.lastError !== undefined) this.lastError = patch.lastError;
    this.options.onStatusChange?.();
  }

  private async dispatchLocal(event: RealtimeEvent) {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (error) {
        logger.error(
          { error, realtimeEventId: event.id, realtimeEventType: event.type },
          "realtime_event_handler_failed"
        );
      }
    }
  }

  private consume(raw: string) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      logger.warn("realtime_event_malformed_json_ignored");
      return;
    }

    const parsed = realtimeEventSchema.safeParse(candidate);
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues.length },
        "realtime_event_malformed_ignored"
      );
      return;
    }
    const event = parsed.data as RealtimeEvent;
    if (event.sourceInstanceId === this.options.instanceId) return;
    void this.dispatchLocal(event);
  }

  private ensureSubscribed() {
    if (!this.subscriber || this.subscribePromise) {
      return this.subscribePromise ?? Promise.resolve();
    }

    this.subscribePromise = this.subscriber
      .subscribe(this.options.channel)
      .then(() => {
        this.setStatus({ subscriberReady: true, lastError: null });
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Redis subscribe failed";
        this.setStatus({ subscriberReady: false, lastError: message });
        logger.warn({ error }, "realtime_subscribe_failed");
      })
      .finally(() => {
        this.subscribePromise = null;
      });
    return this.subscribePromise;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    if (!this.options.publisher) {
      this.setStatus({
        subscriberReady: false,
        publisherReady: false,
        lastError: "Redis is not configured"
      });
      return;
    }

    this.subscriber = this.options.publisher.duplicate({
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
    this.subscriber.on("message", (channel, raw) => {
      if (channel === this.options.channel) this.consume(raw);
    });
    this.subscriber.on("ready", () => {
      void this.ensureSubscribed();
    });
    this.subscriber.on("close", () => {
      this.setStatus({ subscriberReady: false });
    });
    this.subscriber.on("error", (error) => {
      this.setStatus({
        subscriberReady: false,
        lastError: error.message
      });
    });

    await this.ensureSubscribed();
    try {
      await this.options.publisher.ping();
      this.setStatus({ publisherReady: true, lastError: null });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Redis ping failed";
      this.setStatus({ publisherReady: false, lastError: message });
      logger.warn({ error }, "realtime_publisher_unavailable");
    }
  }

  async publish(
    input: PublishInput,
    options: { strict?: boolean } = {}
  ): Promise<{ event: RealtimeEvent; published: boolean }> {
    const event = realtimeEventSchema.parse({
      ...input,
      id: input.id ?? randomUUID(),
      sourceInstanceId: this.options.instanceId,
      createdAt: input.createdAt ?? new Date().toISOString()
    }) as RealtimeEvent;

    await this.dispatchLocal(event);
    if (!this.options.publisher) {
      const error = new Error("Redis is not configured");
      this.setStatus({
        publisherReady: false,
        lastError: error.message
      });
      if (options.strict) throw error;
      return { event, published: false };
    }

    try {
      await this.options.publisher.publish(
        this.options.channel,
        JSON.stringify(event)
      );
      this.setStatus({ publisherReady: true, lastError: null });
      return { event, published: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Redis publish failed";
      this.setStatus({ publisherReady: false, lastError: message });
      logger.warn(
        { error, realtimeEventId: event.id },
        "realtime_publish_failed_local_delivery_only"
      );
      if (options.strict) throw error;
      return { event, published: false };
    }
  }

  async stop() {
    this.started = false;
    this.subscriberReady = false;
    this.publisherReady = false;
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (subscriber && subscriber.status !== "end") {
      await subscriber.quit().catch(() => subscriber.disconnect());
    }
    this.options.onStatusChange?.();
  }
}
