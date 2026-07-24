"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Send } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/locale-format";

type ParticipantDispute = {
  id: string;
  orderId: string;
  openedBy: string;
  reason: string;
  status: string;
  resolution?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
};

type ParticipantDisputeMessage = {
  id: string;
  authorDisplayName: string;
  authorRole: string;
  body: string;
  attachmentUrl?: string | null;
  createdAt: string;
};

type ParticipantDisputeResponse = {
  dispute: ParticipantDispute;
  messages: ParticipantDisputeMessage[];
  messageNextCursor?: string | null;
};

export function DisputeParticipantThread({ orderId }: { orderId: string }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const detail = useQuery({
    queryKey: ["order-dispute", orderId],
    queryFn: () =>
      apiFetch<ParticipantDisputeResponse>(`/disputes/orders/${orderId}/dispute`)
  });
  const send = useMutation({
    mutationFn: async () => {
      if (!detail.data?.dispute.id) throw new Error(t("orders.disputeUnavailable"));
      return apiFetch(`/disputes/${detail.data.dispute.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: body.trim() })
      });
    },
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["order-dispute", orderId] });
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || send.isPending) return;
    send.mutate();
  }

  if (detail.isLoading) {
    return (
      <section className="app-card p-5" data-testid="participant-dispute-thread">
        <p className="text-sm text-muted">{t("orders.loadingDispute")}</p>
      </section>
    );
  }

  if (!detail.data) {
    return (
      <section className="app-card p-5" data-testid="participant-dispute-thread">
        <div className="flex items-center gap-2 text-rose-600">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-sm font-bold">{t("orders.disputeUnavailable")}</p>
        </div>
        <button
          type="button"
          className="app-button-secondary mt-3"
          onClick={() => void detail.refetch()}
        >
          {t("errors.retry")}
        </button>
      </section>
    );
  }

  const { dispute, messages } = detail.data;
  const resolved = dispute.status === "resolved";

  return (
    <section className="app-card p-5" data-testid="participant-dispute-thread">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-ink">{t("orders.disputeThreadTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("orders.disputeThreadHelp")}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black ${
            resolved
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-300"
          }`}
        >
          {t(resolved ? "orders.disputeResolved" : "orders.disputeOpen")}
        </span>
      </div>

      <div className="mt-4 rounded-lg border border-amber-400/35 bg-amber-400/10 p-4">
        <p className="text-xs font-black uppercase text-muted">
          {t("orders.originalDisputeReason")}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink" data-testid="original-dispute-reason">
          {dispute.reason}
        </p>
      </div>

      <div className="mt-4 space-y-3" aria-label={t("orders.disputeMessages")}>
        {messages.map((message) => (
          <article
            key={message.id}
            className="rounded-lg border border-line bg-panel/35 p-4"
            data-testid="participant-dispute-message"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-ink">{message.authorDisplayName}</p>
              <p className="text-xs text-muted">{formatDate(message.createdAt, locale)}</p>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{message.body}</p>
            {message.attachmentUrl ? (
              <a
                className="mt-2 inline-block text-sm font-bold text-brand hover:underline"
                href={message.attachmentUrl}
              >
                {t("chat.attachment")}
              </a>
            ) : null}
          </article>
        ))}
        {!messages.length ? (
          <p className="rounded-lg border border-line bg-panel/35 p-4 text-sm text-muted">
            {t("orders.noDisputeMessages")}
          </p>
        ) : null}
      </div>

      {resolved ? (
        <p className="mt-4 rounded-lg border border-line bg-panel/35 p-4 text-sm text-muted">
          {t("orders.resolvedDisputeReadOnly")}
        </p>
      ) : (
        <form className="mt-4 space-y-2" onSubmit={submit}>
          <label className="text-sm font-black text-ink" htmlFor={`dispute-message-${dispute.id}`}>
            {t("orders.disputeReply")}
          </label>
          <textarea
            id={`dispute-message-${dispute.id}`}
            className="app-input h-24 w-full resize-none text-sm"
            placeholder={t("orders.disputeReplyPlaceholder")}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={5000}
            required
          />
          <button
            className="app-button w-full"
            disabled={send.isPending || !body.trim()}
            type="submit"
          >
            <Send className="h-4 w-4" />
            {send.isPending ? t("orders.sendingDisputeReply") : t("orders.sendDisputeReply")}
          </button>
          {send.error ? <p className="text-sm text-rose-600">{send.error.message}</p> : null}
        </form>
      )}
    </section>
  );
}
