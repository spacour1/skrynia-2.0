import type { useI18n } from "@/lib/i18n";

export type ProfileState = {
  displayName: string;
  email: string;
  avatarUrl: string;
  profileDescription: string;
  pushEnabled: boolean;
};

export type SettingsT = ReturnType<typeof useI18n>["t"];

export type PhoneStep = "enter" | "code_sent";

export type TwoFaStep = "idle" | "setup" | "backupCodes";
