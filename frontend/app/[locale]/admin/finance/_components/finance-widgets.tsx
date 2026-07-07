"use client";

import { useState, type ComponentType } from "react";
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2 } from "lucide-react";
import { money } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { accountTypeLabel, directionLabel, entryTypeLabel, formatDate, shortId } from "./finance-format";
import type { LedgerEntry, PendingOrder } from "./types";

export function FinanceMetric({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "ok" | "danger";
}) {
  const color = tone === "danger" ? "text-rose-500" : tone === "ok" ? "text-emerald-500" : "text-brand";
  return (
    <div className="app-card p-5">
      <Icon className={`h-6 w-6 ${color}`} />
      <p className="mt-3 text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </div>
  );
}

export function LedgerEntryCard({ entry }: { entry: LedgerEntry }) {
  const debit = entry.lines.reduce((sum, line) => sum + Number(line.debitCents), 0);
  const credit = entry.lines.reduce((sum, line) => sum + Number(line.creditCents), 0);
  const balanced = debit === credit;
  return (
    <article className="rounded-lg border border-line bg-surface/50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black">{entryTypeLabel(entry.entryType)}</p>
            <StatusBadge status={balanced ? "balanced" : "mismatch"} />
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted">{entry.idempotencyKey}</p>
          <p className="mt-1 text-xs text-muted">
            {formatDate(entry.createdAt)} {entry.orderId ? `· заказ ${shortId(entry.orderId)}` : ""}
          </p>
        </div>
        <div className="grid min-w-[260px] grid-cols-3 gap-2 text-sm">
          <MiniTotal label="Дебет" value={money(debit, entry.currency)} />
          <MiniTotal label="Кредит" value={money(credit, entry.currency)} />
          <MiniTotal label="Разница" value={money(Math.abs(debit - credit), entry.currency)} danger={!balanced} />
        </div>
      </div>
      <div className="table-shell mt-4 overflow-x-auto shadow-none">
        <table className="min-w-[900px]">
          <thead>
            <tr>
              <th>Счет</th>
              <th>Тип</th>
              <th>Пользователь</th>
              <th className="text-right">Дебет</th>
              <th className="text-right">Кредит</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((line) => (
              <tr key={line.id} className="border-b border-line last:border-b-0">
                <td>
                  <p className="font-semibold">{line.accountName}</p>
                  <p className="font-mono text-xs text-muted">{line.accountCode}</p>
                </td>
                <td>{accountTypeLabel(line.accountType)}</td>
                <td className="font-mono text-xs text-muted">{line.userId ? shortId(line.userId) : "-"}</td>
                <td className="text-right">{Number(line.debitCents) ? money(Number(line.debitCents), entry.currency) : "-"}</td>
                <td className="text-right">{Number(line.creditCents) ? money(Number(line.creditCents), entry.currency) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function Delta({
  label,
  left,
  right,
  currency,
  leftLabel,
  rightLabel
}: {
  label: string;
  left: number;
  right: number;
  currency: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const difference = Math.abs(Number(left) - Number(right));
  return (
    <div className={`rounded-lg border p-3 ${difference ? "border-rose-300 bg-rose-50 dark:border-rose-400/40 dark:bg-rose-400/10" : "border-line bg-card"}`}>
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <div className="mt-2 grid gap-1 text-sm">
        <p className="flex justify-between gap-2">
          <span className="text-muted">{leftLabel}</span>
          <span className="font-semibold">{money(Number(left), currency)}</span>
        </p>
        <p className="flex justify-between gap-2">
          <span className="text-muted">{rightLabel}</span>
          <span className="font-semibold">{money(Number(right), currency)}</span>
        </p>
      </div>
      <p className={`mt-2 text-sm font-black ${difference ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`}>
        Разница {money(difference, currency)}
      </p>
    </div>
  );
}

export function Direction({ direction }: { direction: string }) {
  const positive = direction === "credit";
  const Icon = positive ? ArrowUpCircle : ArrowDownCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${positive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200"}`}>
      <Icon className="h-3.5 w-3.5" />
      {directionLabel(direction)}
    </span>
  );
}

export function MiniTotal({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <p className={`mt-1 font-black ${danger ? "text-rose-600 dark:text-rose-300" : ""}`}>{value}</p>
    </div>
  );
}

export function PendingOrderRow({
  order,
  onConfirm,
  isPending
}: {
  order: PendingOrder;
  onConfirm: (reference: string) => void;
  isPending: boolean;
}) {
  const [reference, setReference] = useState("");
  return (
    <article className="rounded-lg border border-line bg-surface/50 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="font-black text-ink">{order.productTitle}</p>
        <p className="mt-1 text-xs text-muted">
          {order.buyerDisplayName} ({order.buyerEmail}) → {order.sellerDisplayName}
        </p>
        <p className="mt-1 font-mono text-xs text-muted">{shortId(order.id)} · {formatDate(order.createdAt)}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0">
        <p className="font-black text-brand">{money(Number(order.amountCents), order.currency)}</p>
        <input className="app-input h-9 w-44" placeholder="Комментарий (необязательно)" value={reference} onChange={(event) => setReference(event.target.value)} />
        <button className="app-button" type="button" disabled={isPending} onClick={() => onConfirm(reference)}>
          <CheckCircle2 className="h-4 w-4" />
          Подтвердить оплату
        </button>
      </div>
    </article>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid min-h-[160px] place-items-center rounded-lg border border-dashed border-line bg-surface/40 p-6 text-center text-sm text-muted">
      {text}
    </div>
  );
}
