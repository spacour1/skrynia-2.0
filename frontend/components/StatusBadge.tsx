"use client";

import clsx from "clsx";
import { useI18n } from "../lib/i18n";

const colors: Record<string, string> = {
  pending: "bg-slate-100 text-muted dark:bg-slate-500/15 dark:text-slate-200",
  paid: "bg-cyan-100 text-cyan-800 dark:bg-cyan-400/15 dark:text-cyan-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200",
  delivered: "bg-blue-100 text-blue-800 dark:bg-blue-400/15 dark:text-blue-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  disputed: "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200",
  refunded: "bg-zinc-100 text-zinc-700 dark:bg-zinc-400/15 dark:text-zinc-200",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200",
  blocked: "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200",
  open: "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200",
  resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  posted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  voided: "bg-zinc-100 text-zinc-700 dark:bg-zinc-400/15 dark:text-zinc-200",
  balanced: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  mismatch: "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200"
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span className={clsx("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", colors[status] ?? colors.pending)}>
      {t(`status.${status}`)}
    </span>
  );
}
