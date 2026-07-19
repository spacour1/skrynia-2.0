import { logger } from "../../common/logger.js";

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

export function publishSessionSecurityEvent(event: SessionSecurityEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error({ error, eventType: event.type }, "session_security_event_listener_failed");
    }
  }
}

export function onSessionSecurityEvent(listener: SessionSecurityEventListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
