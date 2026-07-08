"use client";

import { CheckCircle2, Loader2, Mail, Send } from "lucide-react";
import { SectionHeader, StatusMessage, Toggle } from "./settings-ui";
import type { SettingsT } from "./types";

export function NotificationsCard({
  emailEnabled,
  telegramEnabled,
  telegramConnected,
  connectPending,
  message,
  onEmailChange,
  onTelegramChange,
  onConnectTelegram,
  onDisconnectTelegram,
  t
}: {
  emailEnabled: boolean;
  telegramEnabled: boolean;
  telegramConnected: boolean;
  connectPending: boolean;
  message: string;
  onEmailChange: (checked: boolean) => void;
  onTelegramChange: (checked: boolean) => void;
  onConnectTelegram: () => void;
  onDisconnectTelegram: () => void;
  t: SettingsT;
}) {
  return (
    <section className="app-card overflow-hidden">
      <SectionHeader icon={Send} title={t("settings.notifs.title")} text={t("settings.notifs.text")} />
      <div className="space-y-4 p-5">
        <Toggle icon={Mail} title={t("settings.notifs.emailTitle")} text={t("settings.notifs.emailText")} checked={emailEnabled} onChange={onEmailChange} />
        <Toggle icon={Send} title={t("settings.notifs.telegramTitle")} text={t("settings.notifs.telegramText")} checked={telegramEnabled} onChange={onTelegramChange} />
        {telegramConnected ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            <span className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              {t("settings.telegram.connected")}
            </span>
            <button className="text-xs font-bold text-muted underline underline-offset-2 transition hover:text-ink" type="button" onClick={onDisconnectTelegram}>
              {t("settings.telegram.disconnect")}
            </button>
          </div>
        ) : (
          <button className="app-button-secondary w-full" type="button" disabled={connectPending} onClick={onConnectTelegram}>
            {connectPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("settings.telegram.connect")}
          </button>
        )}
        <StatusMessage message={message} />
      </div>
    </section>
  );
}
