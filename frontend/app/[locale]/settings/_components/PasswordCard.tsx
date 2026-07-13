"use client";

import type { FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { StatusMessage } from "./settings-ui";
import type { SettingsT } from "./types";

export function PasswordPanel({
  isPending,
  message,
  onSubmit,
  t
}: {
  isPending: boolean;
  message: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  t: SettingsT;
}) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <h3 className="font-black text-ink">{t("settings.password.change")}</h3>
      <input className="app-input w-full" name="currentPassword" type="password" placeholder={t("settings.password.current")} autoComplete="current-password" required />
      <input className="app-input w-full" name="newPassword" type="password" placeholder={t("settings.password.new")} autoComplete="new-password" minLength={8} required />
      <input className="app-input w-full" name="repeatPassword" type="password" placeholder={t("settings.password.repeat")} autoComplete="new-password" minLength={8} required />
      <p className="text-xs leading-5 text-muted">{t("settings.password.text")}</p>
      <StatusMessage message={message} />
      <button className="app-button w-full" disabled={isPending}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {t("settings.password.change")}
      </button>
    </form>
  );
}
