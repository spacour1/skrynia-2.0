import type { Redis } from "ioredis";
import { logger } from "../../common/logger.js";

export type PresenceState = boolean | null;

type PresenceRecord = {
  userId: string;
  connectionId: string;
  instanceId: string;
  lastHeartbeat: string;
  expiresAt: string;
};

export class PresenceService {
  private readonly connections = new Map<string, string>();
  private readonly localUserConnections = new Map<string, number>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      redis: Redis | null;
      instanceId: string;
      ttlMs: number;
      heartbeatMs: number;
    }
  ) {}

  private connectionKey(connectionId: string) {
    return `realtime:presence:connection:${connectionId}`;
  }

  private userKey(userId: string) {
    return `realtime:presence:user:${userId}`;
  }

  private async writePresence(userId: string, connectionId: string) {
    const now = Date.now();
    const expiresAt = now + this.options.ttlMs;
    const record: PresenceRecord = {
      userId,
      connectionId,
      instanceId: this.options.instanceId,
      lastHeartbeat: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString()
    };
    if (!this.options.redis) return false;

    try {
      await this.options.redis
        .multi()
        .set(
          this.connectionKey(connectionId),
          JSON.stringify(record),
          "PX",
          this.options.ttlMs
        )
        .zadd(this.userKey(userId), expiresAt, connectionId)
        .pexpire(this.userKey(userId), this.options.ttlMs * 2)
        .exec();
      return true;
    } catch (error) {
      logger.warn(
        { error, userId, connectionId },
        "presence_heartbeat_failed"
      );
      return false;
    }
  }

  start() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void Promise.all(
        Array.from(this.connections, ([connectionId, userId]) =>
          this.writePresence(userId, connectionId)
        )
      );
    }, this.options.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  async register(userId: string, connectionId: string) {
    const previousUserId = this.connections.get(connectionId);
    if (previousUserId && previousUserId !== userId) {
      const previousCount =
        (this.localUserConnections.get(previousUserId) ?? 1) - 1;
      if (previousCount > 0) {
        this.localUserConnections.set(previousUserId, previousCount);
      } else {
        this.localUserConnections.delete(previousUserId);
      }
    }
    if (!previousUserId || previousUserId !== userId) {
      this.localUserConnections.set(
        userId,
        (this.localUserConnections.get(userId) ?? 0) + 1
      );
    }
    this.connections.set(connectionId, userId);
    return this.writePresence(userId, connectionId);
  }

  async heartbeat(connectionId: string) {
    const userId = this.connections.get(connectionId);
    if (!userId) return false;
    return this.writePresence(userId, connectionId);
  }

  async unregister(connectionId: string) {
    const userId = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    if (userId) {
      const count = (this.localUserConnections.get(userId) ?? 1) - 1;
      if (count > 0) this.localUserConnections.set(userId, count);
      else this.localUserConnections.delete(userId);
    }
    if (!userId || !this.options.redis) return;
    try {
      await this.options.redis
        .multi()
        .del(this.connectionKey(connectionId))
        .zrem(this.userKey(userId), connectionId)
        .exec();
    } catch (error) {
      logger.warn(
        { error, userId, connectionId },
        "presence_unregister_failed"
      );
    }
  }

  async isUserOnline(userId: string): Promise<PresenceState> {
    if ((this.localUserConnections.get(userId) ?? 0) > 0) return true;
    if (!this.options.redis) return null;

    try {
      const now = Date.now();
      await this.options.redis.zremrangebyscore(
        this.userKey(userId),
        "-inf",
        now
      );
      const count = await this.options.redis.zcount(
        this.userKey(userId),
        `(${now}`,
        "+inf"
      );
      return count > 0;
    } catch (error) {
      logger.warn({ error, userId }, "presence_lookup_failed");
      return null;
    }
  }

  async stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    await Promise.all(
      Array.from(this.connections.keys(), (connectionId) =>
        this.unregister(connectionId)
      )
    );
  }
}
