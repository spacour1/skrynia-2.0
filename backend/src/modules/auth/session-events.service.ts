import { logger } from "../../common/logger.js";
import {
  onRealtimeEvent,
  publishRealtimeEvent
} from "../realtime/realtime-runtime.js";

export type SessionSecurityEvent =
  | {
      type: "session.revoked";
      sessionId: string;
    }
  | {
      type: "user.sessions.revoked";
      userId: string;
      exceptSessionId?: string;
    }
  | {
      type: "user.banned";
      userId: string;
    };

type SessionSecurityEventListener = (event: SessionSecurityEvent) => void;

const listeners = new Set<SessionSecurityEventListener>();

function emitSessionSecurityEvent(event: SessionSecurityEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error({ error, eventType: event.type }, "session_security_event_listener_failed");
    }
  }
}

onRealtimeEvent((event) => {
  if (event.type === "session.revoked" && event.scope === "session") {
    emitSessionSecurityEvent({
      type: "session.revoked",
      sessionId: event.targetId
    });
    return;
  }
  if (event.type === "user.sessions.revoked" && event.scope === "user") {
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as { exceptSessionId?: unknown })
        : {};
    emitSessionSecurityEvent({
      type: "user.sessions.revoked",
      userId: event.targetId,
      exceptSessionId:
        typeof payload.exceptSessionId === "string"
          ? payload.exceptSessionId
          : undefined
    });
    return;
  }
  if (event.type === "user.banned" && event.scope === "user") {
    emitSessionSecurityEvent({
      type: "user.banned",
      userId: event.targetId
    });
  }
});

export function publishSessionSecurityEvent(
  event: SessionSecurityEvent,
  options: { strict?: boolean } = {}
) {
  if (event.type === "session.revoked") {
    return publishRealtimeEvent(
      {
        type: event.type,
        scope: "session",
        targetId: event.sessionId,
        payload: {}
      },
      options
    );
  }
  return publishRealtimeEvent(
    {
      type: event.type,
      scope: "user",
      targetId: event.userId,
      payload:
        event.type === "user.sessions.revoked"
          ? { exceptSessionId: event.exceptSessionId }
          : {}
    },
    options
  );
}

export function onSessionSecurityEvent(listener: SessionSecurityEventListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
