import type { IsoDateString } from "./common.js";
import type { Role } from "./enums.js";

export type AuthUserDto = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  avatarUrl: string | null;
  pushEnabled: boolean;
  twoFactorEnabled: boolean;
  createdAt: IsoDateString;
  online: boolean | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  telegramConnected: boolean;
};
