import { money } from "@/lib/api";
import type { ReconciliationSnapshot } from "./types";

export function latestSnapshotsByCurrency(snapshots: ReconciliationSnapshot[]) {
  const byCurrency = new Map<string, ReconciliationSnapshot>();
  snapshots.forEach((snapshot) => {
    if (!byCurrency.has(snapshot.currency)) byCurrency.set(snapshot.currency, snapshot);
  });
  return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

export function formatRevenue(rows: { currency: string; revenueCents: number }[]) {
  if (!rows.length) return "0";
  return rows.map((row) => money(Number(row.revenueCents), row.currency)).join(" / ");
}

export function refetchAll(...queries: { refetch: () => unknown }[]) {
  queries.forEach((query) => query.refetch());
}

export function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function directionLabel(direction: string) {
  const labels: Record<string, string> = {
    credit: "кредит",
    debit: "дебет",
    neutral: "нейтрально"
  };
  return labels[direction] ?? direction;
}

export function entryTypeLabel(type: string) {
  const labels: Record<string, string> = {
    payment_capture: "захват оплаты",
    escrow_release: "выплата из эскроу",
    refund: "возврат",
    adjustment: "корректировка"
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

export function transactionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    payment_capture: "захват оплаты",
    escrow_hold: "удержание в эскроу",
    escrow_release: "выплата из эскроу",
    platform_fee: "комиссия платформы",
    refund: "возврат",
    wallet_credit: "зачисление на кошелек",
    wallet_debit: "списание с кошелька"
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

export function accountTypeLabel(type: string) {
  const labels: Record<string, string> = {
    asset: "актив",
    liability: "обязательство",
    revenue: "доход",
    expense: "расход",
    equity: "капитал"
  };
  return labels[type] ?? type;
}
