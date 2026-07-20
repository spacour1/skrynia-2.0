import assert from "node:assert/strict";
import test from "node:test";
import {
  RealtimeClient,
  RealtimeMessageError
} from "../lib/realtime-client";
import { WebSocketTicketError } from "../lib/ws";

type Listener = (event: { data?: string; code?: number; reason?: string }) => void;

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(payload: string) {
    if (this.readyState !== 1) throw new Error("Socket is not open");
    this.sent.push(payload);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(payload: unknown) {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  disconnect(code = 1006, reason = "") {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  asWebSocket() {
    return this as unknown as WebSocket;
  }

  private emit(type: string, event: Parameters<Listener>[0]) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function fakeScheduler() {
  let nextId = 1;
  const tasks = new Map<number, () => void>();
  const delays: number[] = [];

  return {
    delays,
    setTimer(callback: () => void, delayMs: number) {
      const id = nextId++;
      tasks.set(id, callback);
      delays.push(delayMs);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(timer: ReturnType<typeof setTimeout>) {
      tasks.delete(timer as unknown as number);
    },
    runNext() {
      const entry = tasks.entries().next().value as [number, () => void] | undefined;
      assert.ok(entry, "expected a scheduled task");
      tasks.delete(entry[0]);
      entry[1]();
    }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function ticketError(status: number, retryAfterMs?: number) {
  return new WebSocketTicketError({
    message: `ticket ${status}`,
    status,
    code: `ticket_http_${status}`,
    retryable: status === 429 || status >= 500,
    retryAfterMs
  });
}

test("a 401 ticket error stops reconnecting", async () => {
  const scheduler = fakeScheduler();
  let attempts = 0;
  const client = new RealtimeClient({
    openSocket: async () => {
      attempts += 1;
      throw ticketError(401);
    },
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  client.start();
  await flushPromises();

  assert.equal(attempts, 1);
  assert.deepEqual(scheduler.delays, []);
  assert.equal(client.getSnapshot().status, "stopped");
});

test("a 429 ticket error honors Retry-After", async () => {
  const scheduler = fakeScheduler();
  const client = new RealtimeClient({
    openSocket: async () => {
      throw ticketError(429, 7_500);
    },
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  client.start();
  await flushPromises();

  assert.deepEqual(scheduler.delays, [7_500]);
  assert.equal(client.getSnapshot().status, "waiting");
});

test("503 ticket errors use exponential backoff", async () => {
  const scheduler = fakeScheduler();
  let attempts = 0;
  const client = new RealtimeClient({
    openSocket: async () => {
      attempts += 1;
      throw ticketError(503);
    },
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  client.start();
  await flushPromises();
  scheduler.runNext();
  await flushPromises();

  assert.equal(attempts, 2);
  assert.deepEqual(scheduler.delays, [1_000, 2_000]);
});

test("one client start creates only one connection", async () => {
  const socket = new FakeSocket();
  let attempts = 0;
  const client = new RealtimeClient({
    openSocket: async () => {
      attempts += 1;
      return socket.asWebSocket();
    }
  });

  client.subscribe(() => undefined);
  client.subscribe(() => undefined);
  client.start();
  client.start();
  await flushPromises();
  client.start();

  assert.equal(attempts, 1);
  client.stop();
});

test("message acknowledgement moves delivery from sending to sent", async () => {
  const socket = new FakeSocket();
  const scheduler = fakeScheduler();
  const client = new RealtimeClient({
    openSocket: async () => socket.asWebSocket(),
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });
  client.start();
  await flushPromises();
  socket.open();

  const delivery = { status: "sending" as "sending" | "sent" };
  const sending = client
    .sendMessage({
      clientMessageId: "9cb21d6e-8d4d-4f78-82b0-94ac91a057e0",
      conversationId: "b774a996-e3d9-47c4-8918-8281d8eff2f9",
      body: "hello"
    })
    .then((message) => {
      delivery.status = "sent";
      return message;
    });
  assert.equal(delivery.status, "sending");
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    type: "message",
    clientMessageId: "9cb21d6e-8d4d-4f78-82b0-94ac91a057e0",
    conversationId: "b774a996-e3d9-47c4-8918-8281d8eff2f9",
    body: "hello"
  });

  const saved = { id: "server-message-id", body: "hello" };
  socket.message({
    type: "message_ack",
    clientMessageId: "9cb21d6e-8d4d-4f78-82b0-94ac91a057e0",
    message: saved
  });

  assert.deepEqual(await sending, saved);
  assert.equal(delivery.status, "sent");
  client.stop();
});

test("disconnect before acknowledgement moves delivery to failed and retryable", async () => {
  const socket = new FakeSocket();
  const scheduler = fakeScheduler();
  const client = new RealtimeClient({
    openSocket: async () => socket.asWebSocket(),
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });
  client.start();
  await flushPromises();
  socket.open();

  const sending = client.sendMessage({
    clientMessageId: "d14fa263-7882-41c9-8fe1-b211a4255940",
    conversationId: "4369824e-6eb4-43c2-9604-44d8df42653f",
    body: "retry me"
  });
  socket.disconnect();

  const delivery = { status: "sending" as "sending" | "failed", retryable: false };
  await assert.rejects(sending, (error: unknown) => {
    assert.ok(error instanceof RealtimeMessageError);
    delivery.status = "failed";
    delivery.retryable = error.retryable;
    return true;
  });
  assert.deepEqual(delivery, { status: "failed", retryable: true });
  client.stop();
});
