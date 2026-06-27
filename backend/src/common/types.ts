import type { Request } from "express";

export type Role = "user" | "seller" | "admin";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isBanned: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      traceId?: string;
      startTime?: bigint;
    }
  }
}

export type AuthedRequest = Request & {
  user: AuthUser;
};
