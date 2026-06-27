"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CheckCircle2,
  FileSearch,
  Filter,
  RefreshCcw,
  Scale,
  Search,
  WalletCards
} from "lucide-react";
import { apiFetch, money } from "../../../lib/api";
import { RequireAuth } from "../../../components/RequireAuth";
import { StatusBadge } from "../../../components/StatusBadge";

type Transaction = {
  id: string;
  type: string;
  direction: string;
  amountCents: number;
  currency: string;
  status: string;
  orderId?: string | null;
  email?: string | null;
  displayName?: string | null;
  createdAt: string;
};

type LedgerLine = {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  userId?: string | null;
  debitCents: number;
  creditCents: number;
};

type LedgerEntry = {
  id: string;
  idempotencyKey: string;
  entryType: string;
  orderId?: string | null;
  currency: string;
  createdAt: string;
  lines: LedgerLine[];
};

type ReconciliationSnapshot = {
  id: string;
  currency: string;
  walletAvailableCents: number;
  walletEscrowCents: number;
  ledgerPayableCents: number;
  ledgerEscrowCents: number;
  platformRevenueCents: number;
  ledgerRevenueCents: number;
  providerClearingCents: number;
  differenceCents: number;
  status: string;
  createdAt: string;
};

type Overview = {
  revenue: { currency: string; revenueCents: number }[];
};

type Filters = {
  query: string;
  currency: string;
  type: string;
  status: string;
};

export default function AdminFinancePage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminFinanceContent />
    </RequireAuth>
  );
}

function AdminFinanceContent() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ query: "", currency: "all", type: "all", status: "all" });
  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => apiFetch<Overview>("/admin/overview")
  });
  const transactions = useQuery({
    queryKey: ["admin-transactions"],
    queryFn: () => apiFetch<{ transactions: Transaction[] }>("/admin/transactions")
  });
  const ledger = useQuery({
    queryKey: ["admin-ledger"],
    queryFn: () => apiFetch<{ entries: LedgerEntry[] }>("/admin/ledger")
  });
  const reconciliation = useQuery({
    queryKey: ["admin-reconciliation"],
    queryFn: () => apiFetch<{ snapshots: ReconciliationSnapshot[] }>("/admin/reconciliation")
  });
  const runReconciliation = useMutation({
    mutationFn: () => apiFetch("/admin/reconciliation/run", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-reconciliation"] })
  });

  const entries = ledger.data?.entries ?? [];
  const txs = transactions.data?.transactions ?? [];
  const snapshots = reconciliation.data?.snapshots ?? [];
  const latestByCurrency = useMemo(() => latestSnapshotsByCurrency(snapshots), [snapshots]);
  const currencies = useMemo(() => {
    const values = new Set<string>();
    entries.forEach((entry) => values.add(entry.currency));
    txs.forEach((tx) => values.add(tx.currency));
    snapshots.forEach((snapshot) => values.add(snapshot.currency));
    return Array.from(values).sort();
  }, [entries, txs, snapshots]);
  const entryTypes = useMemo(() => Array.from(new Set(entries.map((entry) => entry.entryType))).sort(), [entries]);

  const filteredEntries = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filters.currency !== "all" && entry.currency !== filters.currency) return false;
      if (filters.type !== "all" && entry.entryType !== filters.type) return false;
      if (!query) return true;
      return [
        entry.id,
        entry.idempotencyKey,
        entry.orderId ?? "",
        entry.entryType,
        ...entry.lines.flatMap((line) => [line.accountCode, line.accountName, line.userId ?? ""])
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [entries, filters.currency, filters.query, filters.type]);

  const filteredTransactions = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return txs.filter((tx) => {
      if (filters.currency !== "all" && tx.currency !== filters.currency) return false;
      if (filters.status !== "all" && tx.status !== filters.status) return false;
      if (!query) return true;
      return [tx.id, tx.orderId ?? "", tx.type, tx.direction, tx.displayName ?? "", tx.email ?? ""].some((value) =>
        value.toLowerCase().includes(query)
      );
    });
  }, [filters.currency, filters.query, filters.status, txs]);

  const totals = useMemo(() => {
    const debitByCurrency = new Map<string, number>();
    const creditByCurrency = new Map<string, number>();
    entries.forEach((entry) => {
      const debit = entry.lines.reduce((sum, line) => sum + Number(line.debitCents), 0);
      const credit = entry.lines.reduce((sum, line) => sum + Number(line.creditCents), 0);
      debitByCurrency.set(entry.currency, (debitByCurrency.get(entry.currency) ?? 0) + debit);
      creditByCurrency.set(entry.currency, (creditByCurrency.get(entry.currency) ?? 0) + credit);
    });
    return currencies.map((currency) => ({
      currency,
      debit: debitByCurrency.get(currency) ?? 0,
      credit: creditByCurrency.get(currency) ?? 0,
      revenue: overview.data?.revenue.find((item) => item.currency === currency)?.revenueCents ?? 0
    }));
  }, [currencies, entries, overview.data?.revenue]);

  const mismatchCount = latestByCurrency.filter((snapshot) => snapshot.status === "mismatch").length;

  return (
    <div className="space-y-6">
      <section className="app-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-lg border border-brand/20 bg-brand/10 text-brand">
              <WalletCards className="h-7 w-7" />
            </span>
            <div>
              <p className="text-sm font-bold uppercase text-brand">Финансовый контроль</p>
              <h1 className="mt-1 text-2xl font-extrabold">Главная книга, эскроу, сверка</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                Проверка double-entry проводок, расхождений кошельков, эскроу-обязательств, дохода платформы и журнала транзакций.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="app-button-secondary" type="button" onClick={() => refetchAll(transactions, ledger, reconciliation, overview)}>
              <RefreshCcw className="h-4 w-4" />
              Обновить
            </button>
            <button className="app-button" type="button" onClick={() => runReconciliation.mutate()} disabled={runReconciliation.isPending}>
              <Scale className="h-4 w-4" />
              Запустить сверку
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <FinanceMetric icon={CheckCircle2} label="Записи главной книги" value={entries.length} tone="ok" />
        <FinanceMetric icon={FileSearch} label="Строки журнала транзакций" value={txs.length} />
        <FinanceMetric icon={Scale} label="Проблемы сверки" value={mismatchCount} tone={mismatchCount ? "danger" : "ok"} />
        <FinanceMetric icon={Banknote} label="Доход платформы" value={formatRevenue(overview.data?.revenue ?? [])} />
      </section>

      <section className="app-card p-5">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-brand" />
          <h2 className="text-lg font-extrabold">Фильтры расследования</h2>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_160px_180px_160px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="app-input w-full pl-9"
              placeholder="Поиск по ID заказа, ключу проводки, счету, пользователю, транзакции"
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            />
          </label>
          <select className="app-input" value={filters.currency} onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value }))}>
            <option value="all">Все валюты</option>
            {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
          <select className="app-input" value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
            <option value="all">Все типы проводок</option>
            {entryTypes.map((type) => <option key={type} value={type}>{entryTypeLabel(type)}</option>)}
          </select>
          <select className="app-input" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="all">Все статусы транзакций</option>
            <option value="posted">проведен</option>
            <option value="pending">ожидает</option>
            <option value="voided">отменен</option>
          </select>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="app-card p-5">
          <h2 className="text-lg font-extrabold">Последняя сверка по валютам</h2>
          <div className="mt-4 space-y-3">
            {latestByCurrency.map((snapshot) => (
              <article key={snapshot.id} className="rounded-lg border border-line bg-surface/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-black">{snapshot.currency}</p>
                    <p className="mt-1 text-xs text-muted">{formatDate(snapshot.createdAt)}</p>
                  </div>
                  <StatusBadge status={snapshot.status} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Delta label="Доступно" left={snapshot.walletAvailableCents} right={snapshot.ledgerPayableCents} currency={snapshot.currency} leftLabel="кошелек" rightLabel="главная книга" />
                  <Delta label="Эскроу" left={snapshot.walletEscrowCents} right={snapshot.ledgerEscrowCents} currency={snapshot.currency} leftLabel="кошелек" rightLabel="главная книга" />
                  <Delta label="Доход" left={snapshot.platformRevenueCents} right={snapshot.ledgerRevenueCents} currency={snapshot.currency} leftLabel="платформа" rightLabel="главная книга" />
                  <div className="rounded-lg border border-line bg-card p-3">
                    <p className="text-xs font-bold uppercase text-muted">Клиринг провайдера</p>
                    <p className="mt-2 text-lg font-black">{money(Number(snapshot.providerClearingCents), snapshot.currency)}</p>
                    <p className="mt-1 text-xs text-muted">Актив на стороне провайдера до финального расчета</p>
                  </div>
                </div>
              </article>
            ))}
            {!latestByCurrency.length ? <EmptyState text="Снимков сверки пока нет. Запусти сверку, чтобы создать первый снимок." /> : null}
          </div>
        </div>

        <div className="app-card p-5">
          <h2 className="text-lg font-extrabold">Итоги по валютам</h2>
          <div className="table-shell mt-4 overflow-x-auto shadow-none">
            <table className="min-w-[720px]">
              <thead>
                <tr>
                  <th>Валюта</th>
                  <th className="text-right">Дебет книги</th>
                  <th className="text-right">Кредит книги</th>
                  <th className="text-right">Баланс</th>
                  <th className="text-right">Доход</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((item) => (
                  <tr key={item.currency} className="border-b border-line transition last:border-b-0 hover:bg-panel/60">
                    <td className="font-black">{item.currency}</td>
                    <td className="text-right">{money(item.debit, item.currency)}</td>
                    <td className="text-right">{money(item.credit, item.currency)}</td>
                    <td className="text-right">{money(item.debit - item.credit, item.currency)}</td>
                    <td className="text-right">{money(item.revenue, item.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="app-card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold">Записи главной книги</h2>
            <p className="mt-1 text-sm text-muted">Найдено записей: {filteredEntries.length}</p>
          </div>
          <p className="text-sm font-semibold text-muted">В каждой double-entry записи дебет и кредит должны сходиться.</p>
        </div>
        <div className="mt-4 space-y-3">
          {filteredEntries.map((entry) => <LedgerEntryCard key={entry.id} entry={entry} />)}
          {!filteredEntries.length ? <EmptyState text="Под эти фильтры записей главной книги не найдено." /> : null}
        </div>
      </section>

      <section className="app-card p-5">
        <h2 className="text-lg font-extrabold">Неизменяемый журнал транзакций</h2>
        <div className="table-shell mt-4 overflow-x-auto shadow-none">
          <table className="min-w-[980px]">
            <thead>
              <tr>
                <th>Создано</th>
                <th>Пользователь</th>
                <th>Тип</th>
                <th>Направление</th>
                <th>Статус</th>
                <th>Заказ</th>
                <th className="text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => (
                <tr key={tx.id} className="border-b border-line transition last:border-b-0 hover:bg-panel/60">
                  <td>{formatDate(tx.createdAt)}</td>
                  <td>{tx.displayName ?? tx.email ?? "-"}</td>
                  <td>{transactionTypeLabel(tx.type)}</td>
                  <td><Direction direction={tx.direction} /></td>
                  <td><StatusBadge status={tx.status} /></td>
                  <td className="font-mono text-xs text-muted">{tx.orderId ? shortId(tx.orderId) : "-"}</td>
                  <td className="text-right font-semibold">{money(Number(tx.amountCents), tx.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FinanceMetric({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof WalletCards;
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

function LedgerEntryCard({ entry }: { entry: LedgerEntry }) {
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

function Delta({
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
        <p className="flex justify-between gap-2"><span className="text-muted">{leftLabel}</span><span className="font-semibold">{money(Number(left), currency)}</span></p>
        <p className="flex justify-between gap-2"><span className="text-muted">{rightLabel}</span><span className="font-semibold">{money(Number(right), currency)}</span></p>
      </div>
      <p className={`mt-2 text-sm font-black ${difference ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`}>
        Разница {money(difference, currency)}
      </p>
    </div>
  );
}

function Direction({ direction }: { direction: string }) {
  const positive = direction === "credit";
  const Icon = positive ? ArrowUpCircle : ArrowDownCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${positive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200"}`}>
      <Icon className="h-3.5 w-3.5" />
      {directionLabel(direction)}
    </span>
  );
}

function directionLabel(direction: string) {
  const labels: Record<string, string> = {
    credit: "кредит",
    debit: "дебет",
    neutral: "нейтрально"
  };
  return labels[direction] ?? direction;
}

function entryTypeLabel(type: string) {
  const labels: Record<string, string> = {
    payment_capture: "захват оплаты",
    escrow_release: "выплата из эскроу",
    refund: "возврат",
    adjustment: "корректировка"
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

function transactionTypeLabel(type: string) {
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

function accountTypeLabel(type: string) {
  const labels: Record<string, string> = {
    asset: "актив",
    liability: "обязательство",
    revenue: "доход",
    expense: "расход",
    equity: "капитал"
  };
  return labels[type] ?? type;
}

function MiniTotal({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <p className={`mt-1 font-black ${danger ? "text-rose-600 dark:text-rose-300" : ""}`}>{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid min-h-[160px] place-items-center rounded-lg border border-dashed border-line bg-surface/40 p-6 text-center text-sm text-muted">
      {text}
    </div>
  );
}

function latestSnapshotsByCurrency(snapshots: ReconciliationSnapshot[]) {
  const byCurrency = new Map<string, ReconciliationSnapshot>();
  snapshots.forEach((snapshot) => {
    if (!byCurrency.has(snapshot.currency)) byCurrency.set(snapshot.currency, snapshot);
  });
  return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

function formatRevenue(rows: { currency: string; revenueCents: number }[]) {
  if (!rows.length) return "0";
  return rows.map((row) => money(Number(row.revenueCents), row.currency)).join(" / ");
}

function refetchAll(...queries: { refetch: () => unknown }[]) {
  queries.forEach((query) => query.refetch());
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
