import type { ProfileState } from "./types";

export const emptyProfile: ProfileState = {
  displayName: "",
  email: "",
  avatarUrl: "",
  profileDescription: "",
  pushEnabled: false
};

export function isStrongPassword(value: string): boolean {
  return value.length >= 8 && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
}
