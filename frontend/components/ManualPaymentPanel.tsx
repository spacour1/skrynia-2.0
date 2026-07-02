"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Check, Copy } from "lucide-react";
import { ApiError, apiFetch, money } from "@/lib/api";

type ManualPaymentDetails = {
  cardNumber: string;
  receiverName: string;
  bank: string | null;
  amountCents: number;
  currency: string;
  comment: string;
};

export function ManualPaymentPanel({ orderId }: { orderId: string }) {
  const details = useQuery({
    queryKey: ["manual-payment-details", orderId],
    queryFn: () => apiFetch<ManualPaymentDetails>(`/payments/orders/${orderId}/manual/details`)
  });

  if (details.isLoading) return <p className="text-sm text-muted">Загружаем реквизиты...</p>;
  if (details.error) return <p className="text-sm text-rose-600">{(details.error as ApiError).message}</p>;
  if (!details.data) return null;

  const d = details.data;
  return (
    <div className="rounded-lg border border-line bg-panel/40 p-4">
      <div className="flex items-center gap-2 text-sm font-black text-ink">
        <Banknote className="h-4 w-4 text-brand" />
        Реквизиты для перевода
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        <CopyRow label="Сумма к переводу" value={money(d.amountCents, d.currency)} />
        <CopyRow label="Номер карты" value={d.cardNumber} mono />
        <CopyRow label="Получатель" value={d.receiverName} />
        {d.bank ? <CopyRow label="Банк" value={d.bank} /> : null}
        <CopyRow label="Комментарий к переводу" value={d.comment} mono />
      </div>
      <p className="mt-3 text-xs leading-6 text-muted">
        Переведите указанную сумму на эту карту и обязательно укажите комментарий — это поможет администратору
        быстрее найти ваш платёж. После перевода дождитесь подтверждения оплаты — статус заказа обновится
        автоматически.
      </p>
    </div>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className={`truncate font-bold text-ink ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
      <button
        type="button"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel text-muted transition hover:text-brand"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
