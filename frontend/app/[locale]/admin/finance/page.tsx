"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CheckCircle2,
  Clock3,
  FileSearch,
  Filter,
  RefreshCcw,
  Scale,
  Search,
  WalletCards
} from "lucide-react";
import { ApiError, apiFetch, money } from "@/lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { StatusBadge } from "@/components/StatusBadge";
import { entryTypeLabel, formatDate, formatRevenue, latestSnapshotsByCurrency, refetchAll, shortId, transactionTypeLabel } from "./_components/finance-format";
import { Delta, Direction, EmptyState, FinanceMetric, LedgerEntryCard, PendingOrderRow } from "./_components/finance-widgets";
import type { Filters, LedgerEntry, Overview, PendingOrder, ReconciliationSnapshot, Transaction } from "./_components/types";

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
  const pendingOrders = useQuery({
    queryKey: ["admin-orders-pending"],
    queryFn: () => apiFetch<{ orders: PendingOrder[] }>("/admin/orders/pending")
  });
  const confirmPayment = useMutation({
    mutationFn: ({ orderId, reference }: { orderId: string; reference: string }) =>
      apiFetch(`/admin/orders/${orderId}/confirm-payment`, {
        method: "POST",
        body: JSON.stringify({ reference: reference.trim() || undefined })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders-pending"] });
      queryClient.invalidateQueries({ queryKey: ["admin-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    }
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-brand" />
            <h2 className="text-lg font-extrabold">Заказы, ожидающие оплаты</h2>
          </div>
          <button className="app-button-secondary" type="button" onClick={() => pendingOrders.refetch()}>
            <RefreshCcw className="h-4 w-4" />
            Обновить
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Сюда попадает любой заказ без оплаты. Используй для подтверждения ручных переводов на карту — после
          проверки поступления нажми "Подтвердить оплату".
        </p>
        <div className="mt-4 space-y-3">
          {(pendingOrders.data?.orders ?? []).map((order) => (
            <PendingOrderRow
              key={order.id}
              order={order}
              onConfirm={(reference) => confirmPayment.mutate({ orderId: order.id, reference })}
              isPending={confirmPayment.isPending}
            />
          ))}
          {!pendingOrders.isLoading && !(pendingOrders.data?.orders ?? []).length ? (
            <EmptyState text="Заказов, ожидающих оплаты, нет." />
          ) : null}
          {confirmPayment.error ? <p className="text-sm text-rose-600">{(confirmPayment.error as ApiError).message}</p> : null}
        </div>
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
