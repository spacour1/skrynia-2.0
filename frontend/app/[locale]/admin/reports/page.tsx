"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { RequireAuth } from "@/components/RequireAuth";

type Report = {
  id: string;
  kind: "user" | "message";
  reason: string;
  description?: string | null;
  status: "pending" | "in_review" | "resolved" | "rejected";
  priority: "normal" | "high";
  moderatorNote?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  reporterId: string;
  reporterDisplayName: string;
  reportedUserId: string;
  reportedDisplayName: string;
  messageId?: string | null;
};

const STATUS_FILTERS: Array<["" | Report["status"], string]> = [
  ["", "Все"],
  ["pending", "Новые"],
  ["in_review", "В работе"],
  ["resolved", "Закрытые"],
  ["rejected", "Отклоненные"]
];

export default function AdminReportsPage() {
  return (
    <RequireAuth roles={["admin", "moderator"]}>
      <AdminReportsContent />
    </RequireAuth>
  );
}

function AdminReportsContent() {
  const client = useQueryClient();
  const [status, setStatus] = useState<"" | Report["status"]>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const reports = useQuery({
    queryKey: ["admin-reports", status],
    queryFn: () => apiFetch<{ reports: Report[] }>(`/admin/reports${status ? `?status=${status}` : ""}`)
  });

  const refresh = () => client.invalidateQueries({ queryKey: ["admin-reports"] });

  const resolveReport = useMutation({
    mutationFn: ({ report, nextStatus }: { report: Report; nextStatus: string }) =>
      apiFetch(`/admin/reports/${report.kind === "user" ? "users" : "messages"}/${report.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, moderatorNote: notes[report.id] || undefined })
      }),
    onSuccess: refresh
  });

  const hideMessage = useMutation({
    mutationFn: (messageId: string) => apiFetch(`/admin/messages/${messageId}/hide`, { method: "POST" }),
    onSuccess: refresh
  });

  const restoreMessage = useMutation({
    mutationFn: (messageId: string) => apiFetch(`/admin/messages/${messageId}/restore`, { method: "POST" }),
    onSuccess: refresh
  });

  return (
    <section className="app-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Жалобы и модерация</h1>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value || "all"}
              className={`rounded-md border px-3 py-1.5 text-sm font-bold transition ${
                status === value ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:bg-panel"
              }`}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {reports.data?.reports.map((report) => (
          <article key={report.id} className="rounded-md border border-line bg-surface/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  <span className="rounded-full bg-panel px-2 py-0.5 text-xs font-black uppercase text-muted">
                    {report.kind === "user" ? "Жалоба на пользователя" : "Жалоба на сообщение"}
                  </span>
                  {report.priority === "high" ? (
                    <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-black uppercase text-rose-500">High</span>
                  ) : null}
                </p>
                <p className="mt-2 text-sm text-muted">
                  {report.reporterDisplayName} жалуется на {report.reportedDisplayName}
                </p>
              </div>
              <StatusBadge status={report.status} />
            </div>
            <p className="mt-3 text-sm font-bold text-ink">Причина: {report.reason}</p>
            {report.description ? <p className="mt-1 text-sm text-muted">{report.description}</p> : null}

            {report.kind === "message" && report.messageId ? (
              <div className="mt-3 flex gap-2">
                <button
                  className="rounded-md border border-line px-3 py-1 text-sm transition hover:bg-panel"
                  disabled={hideMessage.isPending}
                  onClick={() => hideMessage.mutate(report.messageId!)}
                >
                  Скрыть сообщение
                </button>
                <button
                  className="rounded-md border border-line px-3 py-1 text-sm transition hover:bg-panel"
                  disabled={restoreMessage.isPending}
                  onClick={() => restoreMessage.mutate(report.messageId!)}
                >
                  Восстановить сообщение
                </button>
              </div>
            ) : null}

            {report.status === "pending" || report.status === "in_review" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <textarea
                  className="app-input md:col-span-3"
                  placeholder="Заметка модератора (необязательно)"
                  value={notes[report.id] ?? report.moderatorNote ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))}
                />
                {report.status === "pending" ? (
                  <button
                    className="app-button-secondary w-full"
                    disabled={resolveReport.isPending}
                    onClick={() => resolveReport.mutate({ report, nextStatus: "in_review" })}
                  >
                    В работу
                  </button>
                ) : null}
                <button
                  className="app-button w-full"
                  disabled={resolveReport.isPending}
                  onClick={() => resolveReport.mutate({ report, nextStatus: "resolved" })}
                >
                  Закрыть (resolved)
                </button>
                <button
                  className="app-button-danger w-full"
                  disabled={resolveReport.isPending}
                  onClick={() => resolveReport.mutate({ report, nextStatus: "rejected" })}
                >
                  Отклонить
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">
                Заметка модератора: {report.moderatorNote || "—"}
              </p>
            )}
          </article>
        ))}
        {reports.data && !reports.data.reports.length ? <p className="text-sm text-muted">Жалоб не найдено.</p> : null}
      </div>
    </section>
  );
}
