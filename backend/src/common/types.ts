import type { Request } from "express";
import type { Role } from "../domain/enums.js";

export type { Role };

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isBanned: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      rateLimitUserId?: string;
      rateLimitSessionId?: string;
      rateLimitPhoneHash?: string;
      traceId?: string;
      startTime?: bigint;
    }
  }
}

export type AuthedRequest = Request & {
  user: AuthUser;
};
