"use client";

import Link from "@/lib/navigation";
import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, money } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";

type Dispute = {
  id: string;
  status: string;
  reason: string;
  resolution?: string;
  orderId: string;
  orderStatus: string;
  amountCents: number;
  currency: string;
  productTitle: string;
  buyerDisplayName: string;
  sellerDisplayName: string;
};

export default function AdminDisputesPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminDisputesContent />
    </RequireAuth>
  );
}

function AdminDisputesContent() {
  const client = useQueryClient();
  const { t } = useI18n();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const disputes = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: () => apiFetch<{ disputes: Dispute[] }>("/disputes")
  });
  const resolve = useMutation({
    mutationFn: ({ id, decision, adminNote }: { id: string; decision: string; adminNote: string }) =>
      apiFetch(`/disputes/${id}/resolve`, { method: "POST", body: JSON.stringify({ decision, adminNote }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-disputes"] })
  });

  function submit(event: FormEvent<HTMLFormElement>, id: string, decision: string) {
    event.preventDefault();
    resolve.mutate({ id, decision, adminNote: notes[id] || decision });
  }

  return (
    <section className="app-card p-5">
      <h1 className="text-xl font-semibold">{t("admin.disputes")}</h1>
      <div className="mt-5 space-y-4">
        {disputes.data?.disputes.map((dispute) => (
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
            <Link className="mt-3 inline-block text-sm font-semibold text-brand hover:underline" href={`/admin/disputes/${dispute.id}`}>
              {t("admin.viewOrderChat")}
            </Link>
            {dispute.status === "open" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <textarea
                  className="app-input md:col-span-2"
                  placeholder={t("admin.adminNote")}
                  value={notes[dispute.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [dispute.id]: event.target.value }))}
                />
                <form onSubmit={(event) => submit(event, dispute.id, "refund")}>
                  <button className="app-button-danger w-full">
                    {t("admin.refundBuyer")}
                  </button>
                </form>
                <form onSubmit={(event) => submit(event, dispute.id, "release")}>
                  <button className="app-button w-full">{t("admin.releaseSeller")}</button>
                </form>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">{t("admin.resolved")}: {dispute.resolution}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
