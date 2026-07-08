"use client";

import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { CatalogStatus } from "@/lib/catalog-api";
import { STATUS_COLORS } from "./types";

export function StatusPill({ status }: { status: CatalogStatus }) {
  const { t } = useI18n();
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_COLORS[status]}`}>{t(`adminCatalog.status.${status}`)}</span>;
}

export function FormError({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  return <p className="rounded-lg bg-rose-500/10 p-3 text-sm font-bold text-rose-400">{error instanceof ApiError ? error.message : t("adminCatalog.genericError")}</p>;
}

export function StatusActions({ status, onSetStatus }: { status: CatalogStatus; onSetStatus: (status: CatalogStatus) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("active")}>
          {t("adminCatalog.publish")}
        </button>
      ) : null}
      {status !== "hidden" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("hidden")}>
          {t("adminCatalog.hide")}
        </button>
      ) : null}
      {status !== "archived" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("archived")}>
          {t("adminCatalog.archive")}
        </button>
      ) : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
