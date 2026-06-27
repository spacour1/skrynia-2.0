"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { apiFetch, money } from "../../../../lib/api";
import { StatusBadge } from "../../../../components/StatusBadge";
import { RequireAuth } from "../../../../components/RequireAuth";
import { useI18n } from "../../../../lib/i18n";

type DisputeDetail = {
  id: string;
  order_id: string;
  status: string;
  reason: string;
  resolution?: string;
  order_status: string;
  amount_cents: number;
  currency: string;
  product_title: string;
};

type DisputeMessage = {
  id: string;
  senderDisplayName: string;
  body: string;
  attachmentUrl?: string;
  createdAt: string;
};

export default function AdminDisputeDetailPage({ params }: { params: { id: string } }) {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminDisputeDetailContent params={params} />
    </RequireAuth>
  );
}

function AdminDisputeDetailContent({ params }: { params: { id: string } }) {
  const client = useQueryClient();
  const { t } = useI18n();
  const [adminNote, setAdminNote] = useState("");
  const detail = useQuery({
    queryKey: ["admin-dispute", params.id],
    queryFn: () => apiFetch<{ dispute: DisputeDetail; messages: DisputeMessage[] }>(`/disputes/${params.id}`)
  });
  const resolve = useMutation({
    mutationFn: (decision: "refund" | "release") =>
      apiFetch(`/disputes/${params.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, adminNote: adminNote || decision })
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-dispute", params.id] });
      client.invalidateQueries({ queryKey: ["admin-disputes"] });
    }
  });

  function submit(event: FormEvent<HTMLFormElement>, decision: "refund" | "release") {
    event.preventDefault();
    resolve.mutate(decision);
  }

  if (detail.isLoading) return <p className="text-muted">{t("common.loading")}</p>;
  if (!detail.data) return <p className="text-rose-600">{t("orders.notFound")}</p>;

  const dispute = detail.data.dispute;

  return (
    <div className="space-y-6">
      <Link className="text-sm text-brand hover:underline" href="/admin/disputes">
        {t("common.back")}
      </Link>

      <section className="app-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Order {dispute.order_id.slice(0, 8)}</p>
            <h1 className="mt-1 text-xl font-semibold">{dispute.product_title}</h1>
            <p className="mt-1 text-sm text-muted">{money(dispute.amount_cents, dispute.currency)}</p>
          </div>
          <StatusBadge status={dispute.status} />
        </div>
        <p className="mt-4 rounded-md border border-line bg-panel p-3 text-sm">{dispute.reason}</p>
      </section>

      {dispute.status === "open" && (
        <section className="app-card p-5">
          <h2 className="text-lg font-semibold">{t("admin.resolveDispute")}</h2>
          <textarea
            className="app-input mt-3 h-24 w-full"
            placeholder={t("admin.adminNote")}
            value={adminNote}
            onChange={(event) => setAdminNote(event.target.value)}
          />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <form onSubmit={(event) => submit(event, "refund")}>
              <button className="app-button-danger w-full">
                {t("admin.refundBuyer")}
              </button>
            </form>
            <form onSubmit={(event) => submit(event, "release")}>
              <button className="app-button w-full">{t("admin.releaseSeller")}</button>
            </form>
          </div>
        </section>
      )}

      <section className="app-card p-5">
        <h2 className="text-lg font-semibold">{t("admin.orderChatHistory")}</h2>
        <div className="mt-4 space-y-3">
          {detail.data.messages.map((message) => (
            <article key={message.id} className="rounded-md border border-line bg-surface/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{message.senderDisplayName}</span>
                <span className="text-muted">{new Date(message.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p>
              {message.attachmentUrl && (
                <a className="mt-2 block text-sm text-brand hover:underline" href={message.attachmentUrl}>
                  {t("chat.attachment")}
                </a>
              )}
            </article>
          ))}
          {!detail.data.messages.length && <p className="text-sm text-muted">{t("admin.noChat")}</p>}
        </div>
      </section>
    </div>
  );
}
