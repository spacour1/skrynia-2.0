import type { ProfileState } from "./types";

export const emptyProfile: ProfileState = {
  displayName: "",
  email: "",
  avatarUrl: "",
  profileDescription: "",
  pushEnabled: false
};

export function isStrongPassword(value: string): boolean {
  const normalized = value.normalize("NFC");
  return Array.from(normalized).length >= 12 && new TextEncoder().encode(normalized).length <= 72;
}
