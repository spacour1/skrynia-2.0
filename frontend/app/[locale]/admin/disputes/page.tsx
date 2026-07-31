"use client";

import Link from "@/lib/navigation";
import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useMoney, type WireMoneyCents } from "@/lib/currency";
import { StatusBadge } from "@/components/StatusBadge";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-store";
import { formatDate } from "@/lib/locale-format";
import { getDisputeFinancialAction } from "@/lib/admin-disputes";
import type { DisputeDecision, DisputeStatus } from "@/lib/contracts";

type Dispute = {
  id: string;
  status: DisputeStatus;
  reason: string;
  resolution?: DisputeDecision | null;
  orderId: string;
  orderStatus: string;
  amountCents: WireMoneyCents;
  currency: string;
  productTitle: string;
  buyerDisplayName: string;
  sellerDisplayName: string;
  createdAt: string;
  resolvedAt?: string | null;
};

export default function AdminDisputesPage() {
  return (
    <RequireAuth roles={["admin", "moderator"]}>
      <AdminDisputesContent />
    </RequireAuth>
  );
}

function AdminDisputesContent() {
  const user = useAuth((state) => state.user);
  const money = useMoney();
  const client = useQueryClient();
  const { t, locale } = useI18n();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const disputes = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: () => apiFetch<{ disputes: Dispute[] }>("/disputes")
  });
  const resolve = useMutation({
    mutationFn: ({ id, decision, adminNote }: { id: string; decision: string; adminNote: string }) =>
      apiFetch(`/disputes/${id}/resolve`, { method: "POST", body: JSON.stringify({ decision, adminNote }) }),
    onSettled: () => client.invalidateQueries({ queryKey: ["admin-disputes"] })
  });

  function submit(event: FormEvent<HTMLFormElement>, id: string, decision: string) {
    event.preventDefault();
    resolve.mutate({ id, decision, adminNote: notes[id] || decision });
  }

  return (
    <section className="app-card p-5">
      <h1 className="text-xl font-semibold">{t("admin.disputes")}</h1>
      <div className="mt-5 space-y-4">
        {disputes.data?.disputes.map((dispute) => {
          const financialAction = getDisputeFinancialAction(user?.role, dispute);
          const isCurrentMutation = resolve.variables?.id === dispute.id;

          return (
          <article key={dispute.id} className="rounded-md border border-line bg-surface/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{dispute.productTitle}</p>
                <p className="text-sm text-muted">
                  {dispute.buyerDisplayName} vs {dispute.sellerDisplayName} - {money(dispute.amountCents, dispute.currency)}
                </p>
              </div>
              <StatusBadge status={dispute.status} />
            </div>
            <p className="mt-3 text-sm">{dispute.reason}</p>
            <p className="mt-2 text-xs text-muted">
              {t("admin.createdAt")}: {formatDate(dispute.createdAt, locale)}
              {dispute.resolvedAt
                ? ` · ${t("admin.resolvedAt")}: ${formatDate(dispute.resolvedAt, locale)}`
                : ""}
            </p>
            <Link className="mt-3 inline-block text-sm font-semibold text-brand hover:underline" href={`/admin/disputes/${dispute.id}`}>
              {t("admin.viewOrderChat")}
            </Link>
            {financialAction.kind === "choose" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <textarea
                  className="app-input md:col-span-2"
                  placeholder={t("admin.adminNote")}
                  value={notes[dispute.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [dispute.id]: event.target.value }))}
                />
                <form onSubmit={(event) => submit(event, dispute.id, "refund")}>
                  <button className="app-button-danger w-full" disabled={resolve.isPending}>
                    {t("admin.refundBuyer")}
                  </button>
                </form>
                <form onSubmit={(event) => submit(event, dispute.id, "release")}>
                  <button className="app-button w-full" disabled={resolve.isPending}>
                    {t("admin.releaseSeller")}
                  </button>
                </form>
              </div>
            ) : dispute.status === "resolving" ? (
              <div className="mt-3">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {t("admin.resolutionInProgress")}
                </p>
                {financialAction.kind === "in_progress" ? (
                  <button className="app-button mt-3" type="button" disabled>
                    {t("admin.resolutionInProgress")}
                  </button>
                ) : null}
              </div>
            ) : dispute.status === "resolution_failed" ? (
              <div className="mt-3">
                <p className="text-sm text-rose-700 dark:text-rose-300">
                  {t("admin.resolutionFailed")}
                </p>
                {user?.role === "admin" ? (
                  <Link className="app-button mt-3" href={`/admin/disputes/${dispute.id}`}>
                    {t("admin.reviewRecovery")}
                  </Link>
                ) : null}
              </div>
            ) : dispute.status === "resolved" ? (
              <p className="mt-3 text-sm text-muted">{t("admin.resolved")}: {dispute.resolution}</p>
            ) : null}
            {isCurrentMutation && resolve.error ? (
              <p className="mt-3 text-sm text-rose-600">{resolve.error.message}</p>
            ) : null}
          </article>
          );
        })}
      </div>
    </section>
  );
}
