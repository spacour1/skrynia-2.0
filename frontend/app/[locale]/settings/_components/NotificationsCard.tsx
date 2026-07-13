"use client";

import type { ReactNode } from "react";
import { Bell, CheckCircle2, Loader2, Mail, Send, type LucideIcon } from "lucide-react";
import { SectionHeader, StatusMessage, Switch } from "./settings-ui";
import type { SettingsT } from "./types";

function NotifRow({
  icon: Icon,
  title,
  text,
  checked,
  onChange,
  children
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel/35 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-ink">{title}</p>
          <p className="mt-0.5 text-sm leading-5 text-muted">{text}</p>
        </div>
        <Switch checked={checked} onChange={onChange} label={title} />
      </div>
      {children}
    </div>
  );
}

export function NotificationsCard({
  emailEnabled,
  telegramEnabled,
  telegramConnected,
  pushEnabled,
  connectPending,
  pushPending,
  message,
  onEmailChange,
  onTelegramChange,
  onPushChange,
  onConnectTelegram,
  onDisconnectTelegram,
  t
}: {
  emailEnabled: boolean;
  telegramEnabled: boolean;
  telegramConnected: boolean;
  pushEnabled: boolean;
  connectPending: boolean;
  pushPending: boolean;
  message: string;
  onEmailChange: (checked: boolean) => void;
  onTelegramChange: (checked: boolean) => void;
  onPushChange: (checked: boolean) => void;
  onConnectTelegram: () => void;
  onDisconnectTelegram: () => void;
  t: SettingsT;
}) {
  return (
    <section className="app-card overflow-hidden">
      <SectionHeader icon={Bell} title={t("settings.notifs.title")} text={t("settings.notifs.text")} />
      <div className="space-y-3 p-5">
        <NotifRow icon={Send} title={t("settings.notifs.telegramTitle")} text={t("settings.notifs.telegramText")} checked={telegramEnabled} onChange={onTelegramChange}>
          <div className="mt-3 border-t border-line pt-3">
            {telegramConnected ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {t("settings.telegram.connected")}
                </span>
                <button className="focus-ring text-xs font-bold text-muted underline underline-offset-2 transition hover:text-ink" type="button" onClick={onDisconnectTelegram}>
                  {t("settings.telegram.disconnect")}
                </button>
              </div>
            ) : (
              <button className="app-button-secondary w-full" type="button" disabled={connectPending} onClick={onConnectTelegram}>
                {connectPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t("settings.telegram.connect")}
              </button>
            )}
          </div>
        </NotifRow>
        <NotifRow icon={Mail} title={t("settings.notifs.emailTitle")} text={t("settings.notifs.emailText")} checked={emailEnabled} onChange={onEmailChange} />
        <NotifRow icon={Bell} title={t("settings.push.title")} text={t("settings.push.text")} checked={pushEnabled} onChange={pushPending ? () => undefined : onPushChange} />
        <StatusMessage message={message} />
      </div>
    </section>
  );
}
