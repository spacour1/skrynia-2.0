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

// Payment methods are presentational-only for now: there is no backend API for
// them yet. These models define the contract the future API should satisfy.
export type BankCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type CryptoWallet = {
  id: string;
  network: string;
  label: string;
  addressPreview: string;
};
