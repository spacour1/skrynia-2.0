"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function QueryErrorState({
  message,
  onRetry,
  stale = false,
  className = ""
}: {
  message?: string;
  onRetry: () => void;
  stale?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const text = message ?? t(stale ? "errors.staleData" : "errors.queryUnavailable");

  return (
    <div
      className={`${
        stale
          ? "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/35 bg-amber-400/10 px-4 py-3"
          : "app-card grid min-h-[180px] place-items-center p-6 text-center"
      } ${className}`.trim()}
      role="alert"
    >
      <div className={stale ? "flex min-w-0 items-center gap-3" : "max-w-md"}>
        <AlertTriangle className={`${stale ? "h-5 w-5" : "mx-auto h-9 w-9"} shrink-0 text-amber-400`} />
        <p className={`${stale ? "text-sm" : "mt-3 text-sm"} text-muted`}>{text}</p>
      </div>
      <button
        type="button"
        className={`${stale ? "" : "mt-4"} inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-brand/50 bg-brand/10 px-4 text-sm font-black text-brand transition hover:bg-brand/20`}
        onClick={onRetry}
      >
        <RefreshCw className="h-4 w-4" />
        {t("errors.retry")}
      </button>
    </div>
  );
}
