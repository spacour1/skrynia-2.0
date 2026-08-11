"use client";

import Link from "@/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, use, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useMoney, type WireMoneyCents } from "@/lib/currency";
import { StatusBadge } from "@/components/StatusBadge";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/locale-format";
import { useAuth } from "@/lib/auth-store";
import { getDisputeFinancialAction } from "@/lib/admin-disputes";
import type {
  DisputeDecision,
  DisputeStatus
} from "@/lib/contracts";

type DisputeDetail = {
  id: string;
  orderId: string;
  status: DisputeStatus;
  reason: string;
  resolution?: DisputeDecision | null;
  resolutionDecision?: DisputeDecision | null;
  resolutionAttempts?: number;
  lastResolutionError?: string | null;
  resolvingStartedAt?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  orderStatus: string;
  amountCents: WireMoneyCents;
  currency: string;
  productTitle: string;
};

type DisputeMessage = {
  id: string;
  senderDisplayName: string;
  body: string;
  attachmentUrl?: string;
  createdAt: string;
};

type ParticipantDisputeMessage = {
  id: string;
  authorDisplayName: string;
  authorRole: string;
  body: string;
  attachmentUrl?: string | null;
  hiddenAt?: string | null;
  moderationReason?: string | null;
  createdAt: string;
};

export default function AdminDisputeDetailPage({
  params: paramsPromise
}: {
  params: Promise<{ id: string }>;
}) {
  const params = use(paramsPromise);
  return (
    <RequireAuth roles={["admin", "moderator"]}>
      <AdminDisputeDetailContent params={params} />
    </RequireAuth>
  );
}

function AdminDisputeDetailContent({ params }: { params: { id: string } }) {
  const user = useAuth((state) => state.user);
  const money = useMoney();
  const client = useQueryClient();
  const { t, locale } = useI18n();
  const [adminNote, setAdminNote] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const detail = useQuery({
    queryKey: ["admin-dispute", params.id],
    queryFn: () =>
      apiFetch<{
        dispute: DisputeDetail;
        messages: DisputeMessage[];
        disputeMessages: ParticipantDisputeMessage[];
      }>(`/disputes/${params.id}`)
  });
  const resolve = useMutation({
    mutationFn: (decision: "refund" | "release") =>
      apiFetch(`/disputes/${params.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, adminNote: adminNote || decision })
      }),
    onSettled: () => {
      client.invalidateQueries({ queryKey: ["admin-dispute", params.id] });
      client.invalidateQueries({ queryKey: ["admin-disputes"] });
    }
  });
  const reply = useMutation({
    mutationFn: () =>
      apiFetch(`/disputes/${params.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: replyBody.trim() })
      }),
    onSuccess: () => {
      setReplyBody("");
      client.invalidateQueries({ queryKey: ["admin-dispute", params.id] });
    }
  });

  function submit(event: FormEvent<HTMLFormElement>, decision: "refund" | "release") {
    event.preventDefault();
    resolve.mutate(decision);
  }

  if (detail.isLoading) return <p className="text-muted">{t("common.loading")}</p>;
  if (!detail.data) return <p className="text-rose-600">{t("orders.notFound")}</p>;

  const dispute = detail.data.dispute;
  const financialAction = getDisputeFinancialAction(user?.role, dispute);
  const decision = dispute.resolutionDecision ?? dispute.resolution;
  const decisionLabel =
    decision === "refund"
      ? t("admin.refundBuyer")
      : decision === "release"
        ? t("admin.releaseSeller")
        : null;

  return (
    <div className="space-y-6">
      <Link className="text-sm text-brand hover:underline" href="/admin/disputes">
        {t("common.back")}
      </Link>

      <section className="app-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Order {dispute.orderId.slice(0, 8)}</p>
            <h1 className="mt-1 text-xl font-semibold">{dispute.productTitle}</h1>
            <p className="mt-1 text-sm text-muted">{money(dispute.amountCents, dispute.currency)}</p>
          </div>
          <StatusBadge status={dispute.status} />
        </div>
        <div className="mt-4 rounded-md border border-line bg-panel p-3">
          <p className="text-xs font-bold uppercase text-muted">{t("admin.originalDisputeReason")}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm" data-testid="admin-original-dispute-reason">
            {dispute.reason}
          </p>
        </div>
      </section>

      <section className="app-card p-5" data-testid="admin-dispute-lifecycle">
        <h2 className="text-lg font-semibold">{t("admin.resolutionLifecycle")}</h2>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold text-muted">{t("common.status")}</dt>
            <dd className="mt-1"><StatusBadge status={dispute.status} /></dd>
          </div>
          {decisionLabel ? (
            <div>
              <dt className="font-semibold text-muted">{t("admin.resolutionDecision")}</dt>
              <dd className="mt-1">{decisionLabel}</dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-muted">{t("admin.createdAt")}</dt>
            <dd className="mt-1">{formatDate(dispute.createdAt, locale)}</dd>
          </div>
          {dispute.resolvingStartedAt ? (
            <div>
              <dt className="font-semibold text-muted">{t("admin.resolvingStartedAt")}</dt>
              <dd className="mt-1">{formatDate(dispute.resolvingStartedAt, locale)}</dd>
            </div>
          ) : null}
          {dispute.resolvedAt ? (
            <div>
              <dt className="font-semibold text-muted">{t("admin.resolvedAt")}</dt>
              <dd className="mt-1">{formatDate(dispute.resolvedAt, locale)}</dd>
            </div>
          ) : null}
          {user?.role === "admin" && typeof dispute.resolutionAttempts === "number" ? (
            <div>
              <dt className="font-semibold text-muted">{t("admin.resolutionAttempts")}</dt>
              <dd className="mt-1">{dispute.resolutionAttempts}</dd>
            </div>
          ) : null}
        </dl>

        {user?.role === "admin" && dispute.lastResolutionError ? (
          <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
            <p className="text-xs font-bold uppercase text-rose-700 dark:text-rose-300">
              {t("admin.lastResolutionError")}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700 dark:text-rose-200">
              {dispute.lastResolutionError}
            </p>
          </div>
        ) : null}

        {dispute.status === "resolving" ? (
          <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
            {t("admin.resolutionInProgress")}
          </p>
        ) : dispute.status === "resolution_failed" ? (
          <p className="mt-4 text-sm text-rose-700 dark:text-rose-300">
            {t("admin.resolutionFailed")}
          </p>
        ) : dispute.status === "resolved" ? (
          <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">
            {t("admin.resolutionCompleted")}
          </p>
        ) : null}

        {financialAction.kind === "choose" || financialAction.kind === "retry" ? (
          <div className="mt-5 border-t border-line pt-5">
            <h3 className="font-semibold">
              {financialAction.kind === "retry"
                ? t("admin.retryResolution")
                : t("admin.resolveDispute")}
            </h3>
          <textarea
            className="app-input mt-3 h-24 w-full"
            placeholder={t("admin.adminNote")}
            value={adminNote}
            onChange={(event) => setAdminNote(event.target.value)}
          />
            {financialAction.kind === "choose" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <form onSubmit={(event) => submit(event, "refund")}>
                  <button className="app-button-danger w-full" disabled={resolve.isPending}>
                    {t("admin.refundBuyer")}
                  </button>
                </form>
                <form onSubmit={(event) => submit(event, "release")}>
                  <button className="app-button w-full" disabled={resolve.isPending}>
                    {t("admin.releaseSeller")}
                  </button>
                </form>
              </div>
            ) : (
              <form
                className="mt-3"
                onSubmit={(event) => submit(event, financialAction.decision)}
              >
                <button className="app-button w-full" disabled={resolve.isPending}>
                  {t("admin.retryResolution")}: {decisionLabel}
                </button>
              </form>
            )}
          </div>
        ) : financialAction.kind === "in_progress" ? (
          <button className="app-button mt-5" type="button" disabled>
            {t("admin.resolutionInProgress")}
          </button>
        ) : user?.role === "admin" && dispute.status === "resolution_failed" ? (
          <p className="mt-4 text-sm text-rose-600">{t("admin.retryUnavailable")}</p>
        ) : null}

        {resolve.error ? (
          <p className="mt-4 text-sm text-rose-600">{resolve.error.message}</p>
        ) : null}
      </section>

      <section className="app-card p-5">
        <h2 className="text-lg font-semibold">{t("admin.orderChatHistory")}</h2>
        <div className="mt-4 space-y-3">
          {detail.data.messages.map((message) => (
            <article key={message.id} className="rounded-md border border-line bg-surface/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{message.senderDisplayName}</span>
                <span className="text-muted">{formatDate(message.createdAt, locale)}</span>
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

      <section className="app-card p-5" data-testid="admin-dispute-messages">
        <h2 className="text-lg font-semibold">{t("admin.disputeParticipantMessages")}</h2>
        <p className="mt-1 text-sm text-muted">{t("admin.disputeParticipantMessagesHelp")}</p>
        <div className="mt-4 space-y-3">
          {detail.data.disputeMessages.map((message) => (
            <article
              key={message.id}
              className="rounded-md border border-line bg-surface/50 p-3"
              data-testid="admin-dispute-message"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">
                  {message.authorDisplayName} · {t(`admin.disputeAuthorRole.${message.authorRole}`)}
                </span>
                <span className="text-muted">{formatDate(message.createdAt, locale)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p>
              {user?.role === "admin" && message.hiddenAt ? (
                <p className="mt-2 text-xs font-bold text-rose-500">
                  {t("admin.disputeMessageHidden")}
                  {message.moderationReason ? `: ${message.moderationReason}` : ""}
                </p>
              ) : null}
              {message.attachmentUrl ? (
                <a className="mt-2 block text-sm text-brand hover:underline" href={message.attachmentUrl}>
                  {t("chat.attachment")}
                </a>
              ) : null}
            </article>
          ))}
          {!detail.data.disputeMessages.length ? (
            <p className="text-sm text-muted">{t("admin.noDisputeMessages")}</p>
          ) : null}
        </div>
        {dispute.status !== "resolved" ? (
          <form
            className="mt-4 space-y-3 border-t border-line pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (replyBody.trim()) reply.mutate();
            }}
          >
            <label className="block text-sm font-semibold text-ink" htmlFor="staff-dispute-reply">
              {t("orders.disputeReply")}
            </label>
            <textarea
              id="staff-dispute-reply"
              className="app-input h-24 w-full"
              placeholder={t("orders.disputeReplyPlaceholder")}
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              maxLength={5000}
              required
            />
            <button
              className="app-button"
              type="submit"
              disabled={reply.isPending || !replyBody.trim()}
            >
              {reply.isPending
                ? t("orders.sendingDisputeReply")
                : t("orders.sendDisputeReply")}
            </button>
            {reply.error ? (
              <p className="text-sm text-rose-600">{reply.error.message}</p>
            ) : null}
          </form>
        ) : null}
      </section>
    </div>
  );
}
