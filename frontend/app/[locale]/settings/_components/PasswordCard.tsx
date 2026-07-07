"use client";

import type { FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { SectionHeader, StatusMessage } from "./settings-ui";
import type { SettingsT } from "./types";

export function PasswordCard({
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
    <form className="app-card overflow-hidden" onSubmit={onSubmit}>
      <SectionHeader icon={KeyRound} title={t("settings.password.title")} text={t("settings.password.text")} />
      <div className="space-y-4 p-5">
        <input className="app-input w-full" name="currentPassword" type="password" placeholder={t("settings.password.current")} required />
        <input className="app-input w-full" name="newPassword" type="password" placeholder={t("settings.password.new")} minLength={8} required />
        <input className="app-input w-full" name="repeatPassword" type="password" placeholder={t("settings.password.repeat")} minLength={8} required />
        <StatusMessage message={message} />
        <button className="app-button-secondary w-full" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {t("settings.password.change")}
        </button>
      </div>
    </form>
  );
}
