import os from "node:os";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { logger } from "../../common/logger.js";
import {
  outboxEventsTotal,
  outboxOldestPendingAgeSeconds,
  outboxPendingEvents
} from "../../common/metrics.js";
import { inTx, pool } from "../../db/pool.js";
import { handleDomainEvent } from "./domain-event.handlers.js";
import {
  outboxReturningColumns,
  type DomainOutboxEvent
} from "./outbox.service.js";

export type DomainEventHandler = (event: DomainOutboxEvent) => Promise<void>;

type ProcessOutboxOptions = {
  workerId?: string;
  batchSize?: number;
  concurrency?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  lockTimeoutMs?: number;
  handler?: DomainEventHandler;
};

type ProcessOutboxResult = {
  claimed: number;
  processed: number;
  failed: number;
};

const LAST_ERROR_MAX_LENGTH = 2_000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1_000;

let timer: NodeJS.Timeout | null = null;
let tickRunning = false;
const instanceWorkerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, LAST_ERROR_MAX_LENGTH);
}

function backoffMs(attempts: number, baseBackoffMs: number) {
  return Math.min(
    baseBackoffMs * 2 ** Math.max(0, attempts - 1),
    MAX_BACKOFF_MS
  );
}

export async function claimOutboxBatch(input: {
  workerId: string;
  batchSize: number;
  maxAttempts: number;
  lockTimeoutMs: number;
}): Promise<DomainOutboxEvent[]> {
  return inTx(async (client) => {
    await client.query(
      `update domain_outbox
       set status = 'failed',
           locked_at = null,
           locked_by = null,
           last_error = coalesce(last_error, 'Worker lock expired after maximum attempts'),
           updated_at = now()
       where status = 'processing'
         and locked_at < now() - ($1::bigint * interval '1 millisecond')
         and attempts >= $2`,
      [input.lockTimeoutMs, input.maxAttempts]
    );

    const claimed = await client.query<DomainOutboxEvent>(
      `with candidates as (
         select id
         from domain_outbox
         where (
             status = 'pending'
             and available_at <= now()
             and attempts < $3
           )
           or (
             status = 'processing'
             and locked_at < now() - ($4::bigint * interval '1 millisecond')
             and attempts < $3
           )
         order by available_at, created_at, id
         for update skip locked
         limit $1
       )
       update domain_outbox event
       set status = 'processing',
           attempts = event.attempts + 1,
           locked_at = now(),
           locked_by = $2,
           processed_at = null,
           updated_at = now()
       from candidates
       where event.id = candidates.id
       returning ${outboxReturningColumns
         .split("\n")
         .map((column) => (column.trim() ? `event.${column.trim()}` : ""))
         .join("\n")}`,
      [
        input.batchSize,
        input.workerId,
        input.maxAttempts,
        input.lockTimeoutMs
      ]
    );
    return claimed.rows;
  });
}

async function markProcessed(event: DomainOutboxEvent, workerId: string) {
  const result = await pool.query(
    `update domain_outbox
     set status = 'processed',
         locked_at = null,
         locked_by = null,
         processed_at = now(),
         last_error = null,
         updated_at = now()
     where id = $1 and status = 'processing' and locked_by = $2`,
    [event.id, workerId]
  );
  if (result.rowCount !== 1) {
    throw new Error(`Outbox lock was lost before event ${event.id} completed`);
  }
}

async function markFailed(
  event: DomainOutboxEvent,
  workerId: string,
  error: unknown,
  maxAttempts: number,
  baseBackoffMs: number
) {
  const terminal = event.attempts >= maxAttempts;
  const delay = backoffMs(event.attempts, baseBackoffMs);
  const result = await pool.query(
    `update domain_outbox
     set status = $3,
         available_at = case
           when $3 = 'pending'
             then now() + ($4::bigint * interval '1 millisecond')
           else available_at
         end,
         locked_at = null,
         locked_by = null,
         processed_at = null,
         last_error = $5,
         updated_at = now()
     where id = $1 and status = 'processing' and locked_by = $2`,
    [
      event.id,
      workerId,
      terminal ? "failed" : "pending",
      delay,
      errorMessage(error)
    ]
  );
  if (result.rowCount !== 1) {
    logger.warn(
      { eventId: event.id, workerId },
      "outbox_failure_result_discarded_after_lock_loss"
    );
  }
}

async function heartbeatEvent(
  eventId: string,
  workerId: string
): Promise<void> {
  await pool.query(
    `update domain_outbox
     set locked_at = now(), updated_at = now()
     where id = $1 and status = 'processing' and locked_by = $2`,
    [eventId, workerId]
  );
}

async function processClaimedEvent(input: {
  event: DomainOutboxEvent;
  workerId: string;
  handler: DomainEventHandler;
  maxAttempts: number;
  baseBackoffMs: number;
  lockTimeoutMs: number;
}): Promise<boolean> {
  const heartbeatEveryMs = Math.max(50, Math.floor(input.lockTimeoutMs / 3));
  const heartbeat = setInterval(() => {
    heartbeatEvent(input.event.id, input.workerId).catch((error) => {
      logger.error(
        { error, eventId: input.event.id, workerId: input.workerId },
        "outbox_heartbeat_failed"
      );
    });
  }, heartbeatEveryMs);
  heartbeat.unref();

  try {
    await input.handler(input.event);
    await markProcessed(input.event, input.workerId);
    outboxEventsTotal.labels(input.event.eventType, "processed").inc();
    return true;
  } catch (error) {
    await markFailed(
      input.event,
      input.workerId,
      error,
      input.maxAttempts,
      input.baseBackoffMs
    );
    outboxEventsTotal.labels(
      input.event.eventType,
      input.event.attempts >= input.maxAttempts ? "failed" : "retry"
    ).inc();
    logger.error(
      {
        error,
        eventId: input.event.id,
        eventKey: input.event.eventKey,
        eventType: input.event.eventType,
        attempts: input.event.attempts
      },
      "outbox_event_failed"
    );
    return false;
  } finally {
    clearInterval(heartbeat);
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<boolean>
) {
  let cursor = 0;
  const results: boolean[] = [];
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await work(items[index]);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

export async function refreshOutboxMetrics() {
  const result = await pool.query<{ count: number; oldestAgeSeconds: number }>(
    `select count(*)::int as count,
            coalesce(
              extract(epoch from now() - min(created_at)),
              0
            )::float as "oldestAgeSeconds"
     from domain_outbox
     where status in ('pending', 'processing')`
  );
  outboxPendingEvents.set(Number(result.rows[0]?.count ?? 0));
  outboxOldestPendingAgeSeconds.set(
    Math.max(0, Number(result.rows[0]?.oldestAgeSeconds ?? 0))
  );
}

export async function processOutboxBatch(
  options: ProcessOutboxOptions = {}
): Promise<ProcessOutboxResult> {
  const workerId = options.workerId ?? instanceWorkerId;
  const batchSize = options.batchSize ?? env.OUTBOX_BATCH_SIZE;
  const concurrency = options.concurrency ?? env.OUTBOX_CONCURRENCY;
  const maxAttempts = options.maxAttempts ?? env.OUTBOX_MAX_ATTEMPTS;
  const baseBackoffMs =
    options.baseBackoffMs ?? env.OUTBOX_BASE_BACKOFF_MS;
  const lockTimeoutMs =
    options.lockTimeoutMs ?? env.OUTBOX_LOCK_TIMEOUT_MS;
  const handler = options.handler ?? handleDomainEvent;

  const events = await claimOutboxBatch({
    workerId,
    batchSize,
    maxAttempts,
    lockTimeoutMs
  });
  if (events.length === 0) {
    await refreshOutboxMetrics();
    return { claimed: 0, processed: 0, failed: 0 };
  }

  const results = await mapWithConcurrency(events, concurrency, (event) =>
    processClaimedEvent({
      event,
      workerId,
      handler,
      maxAttempts,
      baseBackoffMs,
      lockTimeoutMs
    })
  );
  await refreshOutboxMetrics();
  const processed = results.filter(Boolean).length;
  return {
    claimed: events.length,
    processed,
    failed: events.length - processed
  };
}

export async function retryFailedOutboxEvents(input: {
  eventIds?: string[];
  limit?: number;
} = {}) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const result = await inTx(async (client) =>
    client.query<{ id: string }>(
      `with candidates as (
         select id
         from domain_outbox
         where status = 'failed'
           and ($1::uuid[] is null or id = any($1::uuid[]))
         order by created_at, id
         for update skip locked
         limit $2
       )
       update domain_outbox event
       set status = 'pending',
           attempts = 0,
           available_at = now(),
           locked_at = null,
           locked_by = null,
           processed_at = null,
           last_error = null,
           updated_at = now()
       from candidates
       where event.id = candidates.id
       returning event.id`,
      [input.eventIds?.length ? input.eventIds : null, limit]
    )
  );
  await refreshOutboxMetrics();
  return result.rows.map((row) => row.id);
}

async function runTick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    do {
      const result = await processOutboxBatch();
      if (result.claimed < env.OUTBOX_BATCH_SIZE) break;
    } while (true);
  } catch (error) {
    logger.error({ error, workerId: instanceWorkerId }, "outbox_worker_tick_failed");
  } finally {
    tickRunning = false;
  }
}

export function startOutboxWorker() {
  if (!env.OUTBOX_WORKER_ENABLED || timer) return;
  void runTick();
  timer = setInterval(() => void runTick(), env.OUTBOX_POLL_INTERVAL_MS);
  timer.unref();
  logger.info({ workerId: instanceWorkerId }, "outbox_worker_started");
}

export function stopOutboxWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
