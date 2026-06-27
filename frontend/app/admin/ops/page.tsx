"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  ClipboardList,
  Gauge,
  Play,
  RefreshCcw,
  SearchCheck,
  ShieldCheck,
  TimerReset
} from "lucide-react";
import { API_URL, apiFetch, money } from "../../../lib/api";
import { RequireAuth } from "../../../components/RequireAuth";
import { StatusBadge } from "../../../components/StatusBadge";

type JobCounts = {
  waiting?: number;
  active?: number;
  delayed?: number;
  completed?: number;
  failed?: number;
  paused?: number;
};

type AuditLog = {
  id: string;
  traceId: string;
  userId?: string | null;
  email?: string | null;
  displayName?: string | null;
  method: string;
  path: string;
  endpoint?: string | null;
  statusCode?: number | null;
  ipAddress?: string | null;
  action: string;
  createdAt: string;
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

type LedgerEntry = {
  id: string;
  idempotencyKey: string;
  entryType: string;
  orderId?: string | null;
  currency: string;
  createdAt: string;
  lines: {
    id: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    userId?: string | null;
    debitCents: number;
    creditCents: number;
  }[];
};

type MetricSummary = {
  requests: number;
  errors: number;
  capturedPayments: number;
  failedPayments: number;
};

export default function AdminOpsPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminOpsContent />
    </RequireAuth>
  );
}

function AdminOpsContent() {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ["admin-jobs"],
    queryFn: () => apiFetch<{ enabled: boolean; counts: JobCounts }>("/admin/jobs"),
    refetchInterval: 10000
  });
  const audit = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => apiFetch<{ auditLogs: AuditLog[] }>("/admin/audit"),
    refetchInterval: 15000
  });
  const reconciliation = useQuery({
    queryKey: ["admin-reconciliation"],
    queryFn: () => apiFetch<{ snapshots: ReconciliationSnapshot[] }>("/admin/reconciliation")
  });
  const ledger = useQuery({
    queryKey: ["admin-ledger"],
    queryFn: () => apiFetch<{ entries: LedgerEntry[] }>("/admin/ledger")
  });
  const metrics = useQuery({
    queryKey: ["ops-metrics"],
    queryFn: fetchMetricSummary,
    refetchInterval: 15000
  });
  const runReconciliation = useMutation({
    mutationFn: () => apiFetch("/admin/reconciliation/run", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-reconciliation"] })
  });
  const runJob = useMutation({
    mutationFn: (name: string) => apiFetch(`/admin/jobs/${name}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-jobs"] })
  });

  const latestReconciliation = reconciliation.data?.snapshots[0];
  const jobCounts = jobs.data?.counts ?? {};
  const failedJobs = Number(jobCounts.failed ?? 0);
  const delayedJobs = Number(jobCounts.delayed ?? 0);
  const activeJobs = Number(jobCounts.active ?? 0);

  const riskLevel = useMemo(() => {
    if (failedJobs > 0 || latestReconciliation?.status === "mismatch") return "attention";
    if (activeJobs > 0 || delayedJobs > 0) return "normal";
    return "quiet";
  }, [activeJobs, delayedJobs, failedJobs, latestReconciliation?.status]);

  return (
    <div className="space-y-6">
      <section className="app-card p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-lg border border-brand/20 bg-brand/10 text-brand">
              <Activity className="h-7 w-7" />
            </span>
            <div>
              <p className="text-sm font-bold uppercase text-brand">Центр операций</p>
              <h1 className="mt-1 text-2xl font-extrabold">Надежность, безопасность, очереди</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                Живой обзор очередей, журнала аудита, сверки финансов, главной книги и состояния API.
              </p>
            </div>
          </div>
          <button
            className="app-button-secondary"
            type="button"
            onClick={() => {
              jobs.refetch();
              audit.refetch();
              reconciliation.refetch();
              ledger.refetch();
              metrics.refetch();
            }}
          >
            <RefreshCcw className="h-4 w-4" />
            Обновить
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <OpsMetric
          icon={ShieldCheck}
          label="Состояние системы"
          value={riskLevel === "attention" ? "Нужна проверка" : riskLevel === "normal" ? "Работает" : "Спокойно"}
          tone={riskLevel === "attention" ? "danger" : "ok"}
        />
        <OpsMetric icon={BriefcaseBusiness} label="Отложенные задачи" value={delayedJobs} />
        <OpsMetric icon={TimerReset} label="Активные задачи" value={activeJobs} />
        <OpsMetric icon={AlertTriangle} label="Ошибки задач" value={failedJobs} tone={failedJobs ? "danger" : "ok"} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="app-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold">Очередь задач</h2>
              <p className="mt-1 text-sm text-muted">Статус BullMQ и ручной запуск фоновых задач.</p>
            </div>
            <StatusBadge status={jobs.data?.enabled ? "active" : "paused"} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {["waiting", "active", "delayed", "completed", "failed", "paused"].map((key) => (
              <div key={key} className="rounded-lg border border-line bg-surface/50 p-3">
                <p className="text-xs font-bold uppercase text-muted">{jobLabel(key)}</p>
                <p className="mt-1 text-xl font-black">{Number(jobCounts[key as keyof JobCounts] ?? 0)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <JobButton label="Проверить escrow release" name="escrow_release" runJob={runJob.mutate} pending={runJob.isPending} />
            <JobButton label="Проверить таймеры споров" name="dispute_timer" runJob={runJob.mutate} pending={runJob.isPending} />
            <JobButton label="Поставить payout в очередь" name="payout" runJob={runJob.mutate} pending={runJob.isPending} />
            <JobButton label="Проверить email-задачи" name="email_notification" runJob={runJob.mutate} pending={runJob.isPending} />
          </div>
        </div>

        <div className="app-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold">Сверка финансов</h2>
              <p className="mt-1 text-sm text-muted">Сравнение балансов кошельков с балансами главной книги.</p>
            </div>
            <button className="app-button-secondary" type="button" onClick={() => runReconciliation.mutate()} disabled={runReconciliation.isPending}>
              <SearchCheck className="h-4 w-4" />
              Запустить
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {reconciliation.data?.snapshots.slice(0, 4).map((snapshot) => (
              <div key={snapshot.id} className="rounded-lg border border-line bg-surface/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-black">{snapshot.currency}</p>
                  <StatusBadge status={snapshot.status} />
                </div>
                <dl className="mt-3 grid gap-2 text-sm">
                  <MetricLine label="Доступно в кошельках" value={money(Number(snapshot.walletAvailableCents), snapshot.currency)} />
                  <MetricLine label="К выплате по книге" value={money(Number(snapshot.ledgerPayableCents), snapshot.currency)} />
                  <MetricLine label="Разница эскроу" value={money(Math.abs(Number(snapshot.walletEscrowCents) - Number(snapshot.ledgerEscrowCents)), snapshot.currency)} />
                  <MetricLine label="Итоговая разница" value={money(Number(snapshot.differenceCents), snapshot.currency)} strong />
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <OpsMetric icon={Gauge} label="HTTP-запросы" value={metrics.data?.requests ?? 0} />
        <OpsMetric icon={AlertTriangle} label="HTTP-ошибки" value={metrics.data?.errors ?? 0} tone={metrics.data?.errors ? "danger" : "ok"} />
        <OpsMetric icon={Banknote} label="Успешные оплаты" value={metrics.data?.capturedPayments ?? 0} tone="ok" />
        <OpsMetric icon={AlertTriangle} label="Ошибки оплат" value={metrics.data?.failedPayments ?? 0} tone={metrics.data?.failedPayments ? "danger" : "ok"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="app-card p-5">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-brand" />
            <h2 className="text-lg font-extrabold">Журнал аудита</h2>
          </div>
          <div className="table-shell mt-4 overflow-x-auto shadow-none">
            <table className="min-w-[980px]">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Пользователь</th>
                  <th>Метод</th>
                  <th>Путь</th>
                  <th>Статус</th>
                  <th>IP</th>
                  <th>Trace</th>
                </tr>
              </thead>
              <tbody>
                {audit.data?.auditLogs.slice(0, 18).map((item) => (
                  <tr key={item.id} className="border-b border-line transition last:border-b-0 hover:bg-panel/60">
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{item.displayName ?? item.email ?? "анонимно"}</td>
                    <td><MethodBadge method={item.method} /></td>
                    <td className="max-w-[320px] truncate">{item.path}</td>
                    <td>{item.statusCode ?? "-"}</td>
                    <td>{item.ipAddress ?? "-"}</td>
                    <td className="font-mono text-xs text-muted">{shortTrace(item.traceId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="app-card p-5">
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-brand" />
            <h2 className="text-lg font-extrabold">Последние записи главной книги</h2>
          </div>
          <div className="mt-4 space-y-3">
            {ledger.data?.entries.slice(0, 8).map((entry) => {
              const debit = entry.lines.reduce((sum, line) => sum + Number(line.debitCents), 0);
              const credit = entry.lines.reduce((sum, line) => sum + Number(line.creditCents), 0);
              return (
                <article key={entry.id} className="rounded-lg border border-line bg-surface/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-black">{entryTypeLabel(entry.entryType)}</p>
                      <p className="mt-1 truncate text-xs text-muted">{entry.idempotencyKey}</p>
                    </div>
                    <StatusBadge status={debit === credit ? "completed" : "disputed"} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <MetricLine label="Дебет" value={money(debit, entry.currency)} />
                    <MetricLine label="Кредит" value={money(credit, entry.currency)} />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function OpsMetric({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof Activity;
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

function JobButton({
  label,
  name,
  runJob,
  pending
}: {
  label: string;
  name: string;
  runJob: (name: string) => void;
  pending: boolean;
}) {
  return (
    <button className="app-button-secondary justify-start" type="button" disabled={pending} onClick={() => runJob(name)}>
      <Play className="h-4 w-4" />
      {label}
    </button>
  );
}

function MetricLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-black" : "font-semibold"}>{value}</dd>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const color =
    method === "DELETE" ? "text-rose-700 bg-rose-100 dark:bg-rose-400/15 dark:text-rose-200" :
    method === "POST" ? "text-blue-800 bg-blue-100 dark:bg-blue-400/15 dark:text-blue-200" :
    method === "PATCH" || method === "PUT" ? "text-amber-800 bg-amber-100 dark:bg-amber-400/15 dark:text-amber-200" :
    "text-muted bg-panel";
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${color}`}>{method}</span>;
}

function jobLabel(key: string) {
  const labels: Record<string, string> = {
    waiting: "ожидают",
    active: "активные",
    delayed: "отложены",
    completed: "завершены",
    failed: "с ошибкой",
    paused: "пауза"
  };
  return labels[key] ?? key;
}

function entryTypeLabel(type: string) {
  const labels: Record<string, string> = {
    payment_capture: "захват оплаты",
    escrow_release: "выплата из эскроу",
    refund: "возврат",
    adjustment: "корректировка",
    platform_fee: "комиссия платформы"
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

async function fetchMetricSummary(): Promise<MetricSummary> {
  const response = await fetch(`${API_URL}/metrics`);
  const text = await response.text();
  return {
    requests: sumMetric(text, "marketplace_http_request_duration_seconds_count"),
    errors: sumMetric(text, "marketplace_http_errors_total"),
    capturedPayments: sumMetric(text, 'marketplace_payment_attempts_total{provider="mock",result="captured"}') + sumMetric(text, 'marketplace_payment_attempts_total{result="captured"}'),
    failedPayments: sumMetric(text, 'marketplace_payment_attempts_total{provider="mock",result="failed"}') + sumMetric(text, 'marketplace_payment_attempts_total{result="failed"}')
  };
}

function sumMetric(text: string, metric: string) {
  return text
    .split("\n")
    .filter((line) => line.startsWith(metric))
    .reduce((sum, line) => {
      const value = Number(line.trim().split(/\s+/).at(-1) ?? 0);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
}

function shortTrace(value: string) {
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
