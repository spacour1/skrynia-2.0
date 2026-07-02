"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { RequireAuth } from "@/components/RequireAuth";

type Ticket = {
  id: string;
  email?: string;
  userDisplayName?: string;
  subject: string;
  body: string;
  status: string;
  priority: string;
  createdAt: string;
};

export default function AdminSupportPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminSupportContent />
    </RequireAuth>
  );
}

function AdminSupportContent() {
  const client = useQueryClient();
  const tickets = useQuery({
    queryKey: ["admin-support-tickets"],
    queryFn: () => apiFetch<{ tickets: Ticket[] }>("/support/admin/tickets")
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/support/admin/tickets/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-support-tickets"] })
  });

  return (
    <section className="app-card p-5">
      <h1 className="text-xl font-extrabold">Обращения поддержки</h1>
      <div className="mt-5 space-y-4">
        {tickets.data?.tickets.map((ticket) => (
          <article key={ticket.id} className="rounded-md border border-line bg-surface/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">{ticket.subject}</p>
                <p className="mt-1 text-sm text-muted">
                  {ticket.userDisplayName ?? ticket.email ?? "Гость"} · {ticket.priority} · {new Date(ticket.createdAt).toLocaleString()}
                </p>
              </div>
              <select
                className="app-input py-1"
                value={ticket.status}
                onChange={(event) => update.mutate({ id: ticket.id, status: event.target.value })}
              >
                <option value="open">open</option>
                <option value="in_progress">in progress</option>
                <option value="resolved">resolved</option>
                <option value="closed">closed</option>
              </select>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{ticket.body}</p>
          </article>
        ))}
        {!tickets.data?.tickets.length && <p className="text-sm text-muted">Обращений пока нет.</p>}
      </div>
    </section>
  );
}
