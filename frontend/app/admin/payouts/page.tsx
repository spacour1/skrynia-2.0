"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, money } from "../../../lib/api";
import { StatusBadge } from "../../../components/StatusBadge";
import { RequireAuth } from "../../../components/RequireAuth";

type Payout = {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  amountCents: number;
  currency: string;
  provider: string;
  destination: { method: string; accountNumber: string; holderName: string; bankName?: string };
  status: string;
  reference?: string;
  adminNote?: string;
  createdAt: string;
};

export default function AdminPayoutsPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminPayoutsContent />
    </RequireAuth>
  );
}

function AdminPayoutsContent() {
  const client = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const payouts = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: () => apiFetch<{ payouts: Payout[] }>("/admin/payouts?status=pending")
  });

  const complete = useMutation({
    mutationFn: ({ id, reference }: { id: string; reference: string }) =>
      apiFetch(`/admin/payouts/${id}/complete`, { method: "POST", body: JSON.stringify({ reference }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-payouts"] })
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`/admin/payouts/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-payouts"] })
  });

  function submitComplete(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (!notes[id]?.trim()) return;
    complete.mutate({ id, reference: notes[id].trim() });
  }

  function submitReject(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (!notes[id]?.trim()) return;
    reject.mutate({ id, reason: notes[id].trim() });
  }

  return (
    <section className="app-card p-5">
      <h1 className="text-xl font-semibold">Выплаты продавцам</h1>
      <p className="mt-1 text-sm text-muted">
        Переведите деньги на указанные реквизиты вручную, затем подтвердите банковским номером операции.
      </p>
      <div className="mt-5 space-y-4">
        {payouts.data?.payouts.length === 0 ? <p className="text-sm text-muted">Нет заявок в обработке.</p> : null}
        {payouts.data?.payouts.map((payout) => (
          <article key={payout.id} className="rounded-md border border-line bg-surface/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{payout.userDisplayName} ({payout.userEmail})</p>
                <p className="text-sm text-muted">{money(payout.amountCents, payout.currency)} - {payout.provider}</p>
              </div>
              <StatusBadge status={payout.status} />
            </div>
            <div className="mt-3 text-sm">
              <p>Карта/счёт: {payout.destination.accountNumber}</p>
              <p>Получатель: {payout.destination.holderName}</p>
              {payout.destination.bankName ? <p>Банк: {payout.destination.bankName}</p> : null}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                className="app-input md:col-span-2"
                placeholder="Номер банковской операции / причина отказа"
                value={notes[payout.id] ?? ""}
                onChange={(event) => setNotes((current) => ({ ...current, [payout.id]: event.target.value }))}
              />
              <form onSubmit={(event) => submitComplete(event, payout.id)}>
                <button className="app-button w-full" disabled={complete.isPending}>
                  Подтвердить перевод
                </button>
              </form>
              <form onSubmit={(event) => submitReject(event, payout.id)}>
                <button className="app-button-danger w-full" disabled={reject.isPending}>
                  Отклонить и вернуть на баланс
                </button>
              </form>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
