import { createHash, randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";
import { logger } from "../../common/logger.js";
import { safeErrorCode } from "../../common/safe-error-code.js";

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

const REMOTE_EVENT_DEDUP_TTL_MS = 5 * 60 * 1_000;
const REMOTE_EVENT_DEDUP_MAX_ENTRIES = 10_000;
function createSubscriberConnectionName(instanceId: string, channel: string) {
  const digest = createHash("sha256")
    .update(instanceId)
    .update("\0")
    .update(channel)
    .digest("hex")
    .slice(0, 24);
  return `keepgame-realtime-sub-${digest}`;
}

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
  private readonly seenRemoteEventIds = new Map<string, number>();
  private readonly subscriberConnectionName: string;
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
  ) {
    this.subscriberConnectionName = createSubscriberConnectionName(
      options.instanceId,
      options.channel
    );
  }

  get instanceId() {
    return this.options.instanceId;
  }

  getSubscriberConnectionName() {
    return this.subscriberConnectionName;
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
          {
            errorCode: safeErrorCode(error),
            realtimeEventId: event.id,
            realtimeEventType: event.type
          },
          "realtime_event_handler_failed"
        );
      }
    }
  }

  private rememberRemoteEvent(eventId: string) {
    const now = Date.now();
    for (const [seenId, expiresAt] of this.seenRemoteEventIds) {
      if (expiresAt > now) break;
      this.seenRemoteEventIds.delete(seenId);
    }

    const existingExpiry = this.seenRemoteEventIds.get(eventId);
    if (existingExpiry !== undefined && existingExpiry > now) return false;
    if (existingExpiry !== undefined) this.seenRemoteEventIds.delete(eventId);

    while (this.seenRemoteEventIds.size >= REMOTE_EVENT_DEDUP_MAX_ENTRIES) {
      const oldestId = this.seenRemoteEventIds.keys().next().value;
      if (oldestId === undefined) break;
      this.seenRemoteEventIds.delete(oldestId);
    }
    this.seenRemoteEventIds.set(eventId, now + REMOTE_EVENT_DEDUP_TTL_MS);
    return true;
  }

  private consume(raw: string) {
    if (!this.started) return;
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
    if (!this.rememberRemoteEvent(event.id)) return;
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
        this.setStatus({
          subscriberReady: false,
          lastError: "Redis subscribe failed"
        });
        logger.warn(
          { errorCode: safeErrorCode(error) },
          "realtime_subscribe_failed"
        );
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
      connectionName: this.subscriberConnectionName,
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
        lastError: "Redis subscriber unavailable"
      });
      logger.warn(
        { errorCode: safeErrorCode(error) },
        "realtime_subscriber_unavailable"
      );
    });

    await this.ensureSubscribed();
    try {
      await this.options.publisher.ping();
      this.setStatus({ publisherReady: true, lastError: null });
    } catch (error) {
      this.setStatus({
        publisherReady: false,
        lastError: "Redis ping failed"
      });
      logger.warn(
        { errorCode: safeErrorCode(error) },
        "realtime_publisher_unavailable"
      );
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
      this.setStatus({
        publisherReady: false,
        lastError: "Redis publish failed"
      });
      logger.warn(
        {
          errorCode: safeErrorCode(error),
          realtimeEventId: event.id
        },
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
    this.seenRemoteEventIds.clear();
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (subscriber && subscriber.status !== "end") {
      await subscriber.quit().catch(() => subscriber.disconnect());
    }
    this.options.onStatusChange?.();
  }
}
