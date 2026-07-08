"use client";

import { useState } from "react";
import { ChevronRight, Languages, LogOut, Settings, UserCircle, type LucideIcon } from "lucide-react";
import { CurrencySwitcher } from "@/components/CurrencySwitcher";
import { localeLabels, locales } from "@/i18n/config";
import { useI18n } from "@/lib/i18n";
import type { NotificationItem } from "./types";

export function ProfileDropdown({
  onDashboard,
  onSettings,
  onLogout
}: {
  onDashboard: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[300px] overflow-hidden rounded-2xl border border-line bg-card shadow-lift">
      <div className="grid gap-2 p-3">
        <MenuButton icon={UserCircle} label={t("nav.dashboard")} onClick={onDashboard} />
        <MenuButton icon={Settings} label={t("nav.settings")} onClick={onSettings} />
        <LanguageSwitcher />
        <CurrencySwitcher />
      </div>
      <div className="border-t border-line p-3">
        <MenuButton icon={LogOut} label={t("nav.logout")} onClick={onLogout} danger />
      </div>
    </div>
  );
}

function LanguageSwitcher() {
  const { locale, switchLocale, t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        className="flex h-11 w-full items-center justify-between rounded-xl px-3 text-sm font-bold text-muted transition hover:bg-panel hover:text-ink"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="inline-flex items-center gap-3">
          <Languages className="h-5 w-5" />
          {t("nav.language")}
        </span>
        <span className="text-xs text-brand">{locale.toUpperCase()}</span>
      </button>
      {open ? (
        <div className="mt-1 grid gap-1 rounded-xl border border-line bg-panel/40 p-2">
          {locales.map((option) => (
            <button
              key={option}
              className={`flex h-10 items-center justify-between rounded-lg px-3 text-sm font-bold transition ${
                option === locale ? "bg-brand/10 text-brand" : "text-muted hover:bg-panel hover:text-ink"
              }`}
              type="button"
              onClick={() => {
                setOpen(false);
                switchLocale(option);
              }}
            >
              <span>{localeLabels[option]}</span>
              <span className="text-xs">{option.toUpperCase()}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuButton({ icon: Icon, label, onClick, danger }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold transition hover:bg-panel ${danger ? "text-rose-500" : "text-muted hover:text-ink"}`} type="button" onClick={onClick}>
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

export function NotificationDropdown({
  items,
  unreadCount,
  loading,
  onOpen,
  onReadAll
}: {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  onOpen: (item: NotificationItem) => void;
  onReadAll: () => void;
}) {
  const { language, t } = useI18n();
  return (
    <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[360px] overflow-hidden rounded-2xl border border-line bg-card shadow-lift">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel/55 px-4 py-3">
        <div>
          <p className="font-black text-ink">{t("nav.notifications")}</p>
          <p className="text-xs text-muted">{unreadCount ? `${unreadCount} ${t("nav.unread")}` : t("nav.allRead")}</p>
        </div>
        {unreadCount ? (
          <button className="text-xs font-bold text-brand hover:underline" type="button" onClick={onReadAll}>
            {t("nav.readAll")}
          </button>
        ) : null}
      </div>
      <div className="max-h-[460px] overflow-y-auto p-2">
        {loading ? <p className="px-3 py-4 text-sm text-muted">{t("nav.loadingNotifications")}</p> : null}
        {!loading && !items.length ? (
          <div className="grid min-h-[180px] place-items-center text-center">
            <p className="max-w-[240px] text-sm leading-6 text-muted">{t("nav.noNotifications")}</p>
          </div>
        ) : null}
        {items.map((item) => {
          const title = item.titleKey ? t(item.titleKey, item.params ?? undefined) : item.title;
          const body = item.bodyKey ? t(item.bodyKey, item.params ?? undefined) : item.body;
          return (
            <button key={item.id} className={`flex w-full gap-3 rounded-xl p-3 text-left transition hover:bg-panel ${item.readAt ? "opacity-75" : "bg-brand/5"}`} type="button" onClick={() => onOpen(item)}>
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.readAt ? "bg-muted/40" : "bg-action"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black text-ink">{title}</span>
                {body ? <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted">{body}</span> : null}
                <span className="mt-2 block text-xs text-muted">{formatNotificationTime(item.createdAt, language)}</span>
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatNotificationTime(value: string, language: string) {
  return new Date(value).toLocaleString(language, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
