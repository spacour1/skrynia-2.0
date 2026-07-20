import { openAuthedSocket, WebSocketTicketError } from "./ws";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "waiting" | "stopped";

export type RealtimeEvent = {
  type: string;
  [key: string]: unknown;
};

export type RealtimeSnapshot = {
  status: RealtimeStatus;
  reconnectAttempt: number;
  error: Error | null;
};

export type RealtimeMessageInput = {
  clientMessageId: string;
  conversationId: string;
  body: string;
  attachmentUploadId?: string;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type RealtimeClientOptions = {
  openSocket?: () => Promise<WebSocket>;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
  ackTimeoutMs?: number;
};

type PendingMessage = {
  resolve: (message: unknown) => void;
  reject: (error: RealtimeMessageError) => void;
  timer: TimerHandle;
};

const SOCKET_OPEN = 1;
const TERMINAL_CLOSE_CODES = new Set([1008, 4001, 4003]);
const MAX_RECONNECT_DELAY_MS = 30_000;

export class RealtimeMessageError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code = "message_failed"
  ) {
    super(message);
    this.name = "RealtimeMessageError";
  }
}

export class RealtimeClient {
  private readonly openSocket: () => Promise<WebSocket>;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (timer: TimerHandle) => void;
  private readonly ackTimeoutMs: number;
  private readonly eventListeners = new Set<(event: RealtimeEvent) => void>();
  private readonly stateListeners = new Set<() => void>();
  private readonly roomReferences = new Map<string, number>();
  private readonly pendingMessages = new Map<string, PendingMessage>();

  private socket: WebSocket | null = null;
  private reconnectTimer: TimerHandle | null = null;
  private connectInFlight: Promise<WebSocket> | null = null;
  private enabled = false;
  private terminal = false;
  private visible = true;
  private online = true;
  private generation = 0;
  private snapshot: RealtimeSnapshot = {
    status: "stopped",
    reconnectAttempt: 0,
    error: null
  };

  constructor(options: RealtimeClientOptions = {}) {
    this.openSocket = options.openSocket ?? openAuthedSocket;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.ackTimeoutMs = options.ackTimeoutMs ?? 15_000;
  }

  getSnapshot = () => this.snapshot;

  subscribeState = (listener: () => void) => {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  };

  subscribe(listener: (event: RealtimeEvent) => void) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.terminal = false;
    this.generation += 1;
    this.updateSnapshot({ status: "idle", reconnectAttempt: 0, error: null });
    void this.connect();
  }

  stop() {
    if (!this.enabled && this.snapshot.status === "stopped") {
      this.roomReferences.clear();
      this.rejectPending(new RealtimeMessageError("Realtime session ended", false, "session_ended"));
      return;
    }
    this.enabled = false;
    this.terminal = false;
    this.generation += 1;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.connectInFlight = null;
    this.roomReferences.clear();
    this.rejectPending(new RealtimeMessageError("Realtime session ended", false, "session_ended"));
    if (socket) socket.close(1000, "Session ended");
    this.updateSnapshot({ status: "stopped", reconnectAttempt: 0, error: null });
  }

  refreshAuthentication() {
    if (!this.enabled) return;
    this.terminal = false;
    this.generation += 1;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.connectInFlight = null;
    this.rejectPending(new RealtimeMessageError("Connection refreshed before acknowledgement", true, "auth_refreshed"));
    if (socket) socket.close(1000, "Authentication refreshed");
    this.updateSnapshot({ status: "idle", reconnectAttempt: 0, error: null });
    void this.connect();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (visible) void this.connectIfWaiting();
  }

  setOnline(online: boolean) {
    this.online = online;
    if (online) void this.connectIfWaiting();
  }

  joinConversation(conversationId: string) {
    const count = this.roomReferences.get(conversationId) ?? 0;
    this.roomReferences.set(conversationId, count + 1);
    if (count === 0) {
      this.sendControl({ type: "join_conversation", conversationId });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.leaveConversation(conversationId);
    };
  }

  sendMessage(input: RealtimeMessageInput): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      return Promise.reject(
        new RealtimeMessageError("Realtime connection is not available", true, "not_connected")
      );
    }
    if (this.pendingMessages.has(input.clientMessageId)) {
      return Promise.reject(
        new RealtimeMessageError("This message is already awaiting acknowledgement", false, "duplicate_client_message_id")
      );
    }

    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.pendingMessages.delete(input.clientMessageId);
        reject(new RealtimeMessageError("Message acknowledgement timed out", true, "ack_timeout"));
      }, this.ackTimeoutMs);
      this.pendingMessages.set(input.clientMessageId, { resolve, reject, timer });

      try {
        this.socket!.send(
          JSON.stringify({
            type: "message",
            clientMessageId: input.clientMessageId,
            conversationId: input.conversationId,
            body: input.body,
            ...(input.attachmentUploadId
              ? { attachmentUploadId: input.attachmentUploadId }
              : {})
          })
        );
      } catch {
        this.settleMessage(
          input.clientMessageId,
          new RealtimeMessageError("Message could not be queued", true, "send_failed")
        );
      }
    });
  }

  private async connect() {
    if (
      !this.enabled ||
      this.terminal ||
      !this.visible ||
      !this.online ||
      this.socket ||
      this.connectInFlight
    ) {
      return;
    }

    const generation = this.generation;
    this.clearReconnectTimer();
    this.updateSnapshot({ ...this.snapshot, status: "connecting", error: null });

    try {
      const opening = this.openSocket();
      this.connectInFlight = opening;
      const socket = await opening;
      if (!this.enabled || generation !== this.generation) {
        socket.close(1000, "Stale connection");
        return;
      }

      this.socket = socket;
      socket.addEventListener("open", () => this.handleOpen(socket, generation));
      socket.addEventListener("message", (event) => this.handleMessage(event));
      socket.addEventListener("close", (event) => this.handleClose(socket, generation, event));
      if (socket.readyState === SOCKET_OPEN) this.handleOpen(socket, generation);
    } catch (error) {
      if (this.enabled && generation === this.generation) this.handleConnectFailure(error);
    } finally {
      if (generation === this.generation) this.connectInFlight = null;
    }
  }

  private handleOpen(socket: WebSocket, generation: number) {
    if (socket !== this.socket || generation !== this.generation) return;
    this.updateSnapshot({ status: "connected", reconnectAttempt: 0, error: null });
    for (const conversationId of this.roomReferences.keys()) {
      this.sendControl({ type: "join_conversation", conversationId });
    }
  }

  private handleMessage(event: MessageEvent) {
    if (typeof event.data !== "string") return;
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isRealtimeEvent(payload)) return;

    if (payload.type === "message_ack" && typeof payload.clientMessageId === "string") {
      this.settleMessage(payload.clientMessageId, null, payload.message);
    } else if (payload.type === "message_error" && typeof payload.clientMessageId === "string") {
      this.settleMessage(
        payload.clientMessageId,
        new RealtimeMessageError(
          typeof payload.message === "string" ? payload.message : "Message failed",
          payload.retryable === true,
          typeof payload.code === "string" ? payload.code : "message_failed"
        )
      );
    }

    for (const listener of this.eventListeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error("Realtime listener failed", error);
      }
    }
  }

  private handleClose(socket: WebSocket, generation: number, event: CloseEvent) {
    if (socket !== this.socket || generation !== this.generation) return;
    this.socket = null;
    this.rejectPending(
      new RealtimeMessageError(
        "Connection closed before acknowledgement",
        !TERMINAL_CLOSE_CODES.has(event.code),
        "connection_closed"
      )
    );
    if (!this.enabled) return;

    if (TERMINAL_CLOSE_CODES.has(event.code)) {
      this.terminal = true;
      this.updateSnapshot({
        status: "stopped",
        reconnectAttempt: this.snapshot.reconnectAttempt,
        error: new RealtimeMessageError(event.reason || "Realtime session rejected", false, "session_rejected")
      });
      return;
    }
    this.scheduleReconnect();
  }

  private handleConnectFailure(error: unknown) {
    const normalized =
      error instanceof WebSocketTicketError
        ? error
        : new WebSocketTicketError({
            message: error instanceof Error ? error.message : "Could not open realtime connection",
            status: 0,
            code: "websocket_network_error",
            retryable: true,
            cause: error
          });

    if (!normalized.retryable) {
      this.terminal = true;
      this.updateSnapshot({
        status: "stopped",
        reconnectAttempt: this.snapshot.reconnectAttempt,
        error: normalized
      });
      return;
    }
    this.scheduleReconnect(normalized.status === 429 ? normalized.retryAfterMs : undefined, normalized);
  }

  private scheduleReconnect(delayOverride?: number, error: Error | null = null) {
    if (!this.enabled || this.terminal) return;
    const nextAttempt = this.snapshot.reconnectAttempt + 1;
    const delay =
      delayOverride ??
      Math.min(1000 * 2 ** Math.max(0, nextAttempt - 1), MAX_RECONNECT_DELAY_MS);
    this.updateSnapshot({ status: "waiting", reconnectAttempt: nextAttempt, error });
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private async connectIfWaiting() {
    if (
      this.enabled &&
      !this.terminal &&
      this.visible &&
      this.online &&
      !this.socket &&
      !this.connectInFlight &&
      !this.reconnectTimer
    ) {
      await this.connect();
    }
  }

  private leaveConversation(conversationId: string) {
    const count = this.roomReferences.get(conversationId) ?? 0;
    if (count > 1) {
      this.roomReferences.set(conversationId, count - 1);
      return;
    }
    this.roomReferences.delete(conversationId);
    this.sendControl({ type: "leave_conversation", conversationId });
  }

  private sendControl(payload: RealtimeEvent) {
    if (this.socket?.readyState !== SOCKET_OPEN) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      this.socket.close(1011, "Send failed");
    }
  }

  private settleMessage(
    clientMessageId: string,
    error: RealtimeMessageError | null,
    message?: unknown
  ) {
    const pending = this.pendingMessages.get(clientMessageId);
    if (!pending) return;
    this.pendingMessages.delete(clientMessageId);
    this.clearTimer(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(message);
  }

  private rejectPending(error: RealtimeMessageError) {
    for (const clientMessageId of Array.from(this.pendingMessages.keys())) {
      this.settleMessage(clientMessageId, error);
    }
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private updateSnapshot(snapshot: RealtimeSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.stateListeners) {
      try {
        listener();
      } catch (error) {
        console.error("Realtime state listener failed", error);
      }
    }
  }
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}
