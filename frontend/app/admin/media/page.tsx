"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../../lib/api";
import { RequireAuth } from "../../../components/RequireAuth";

type AdminMedia = {
  id: string;
  url: string;
  type: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  productId: string;
  productTitle: string;
  sellerId: string;
  sellerDisplayName: string;
};

export default function AdminMediaPage() {
  return (
    <RequireAuth roles={["admin", "moderator"]}>
      <AdminMediaContent />
    </RequireAuth>
  );
}

function AdminMediaContent() {
  const client = useQueryClient();
  const media = useQuery({
    queryKey: ["admin-media"],
    queryFn: () => apiFetch<{ media: AdminMedia[] }>("/admin/media")
  });
  const moderate = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/admin/media/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-media"] })
  });

  return (
    <section className="app-card p-5">
      <h1 className="text-xl font-extrabold">Модерация изображений товаров</h1>
      <p className="mt-1 text-sm text-muted">
        Отклонённые изображения скрываются из публичных карточек, но остаются видны продавцу.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {media.data?.media.map((item) => (
          <article key={item.id} className="overflow-hidden rounded-lg border border-line bg-surface/50">
            <img src={item.url} alt={item.productTitle} className="h-40 w-full object-cover" />
            <div className="p-3">
              <p className="truncate text-sm font-semibold">{item.productTitle}</p>
              <p className="mt-1 truncate text-xs text-muted">{item.sellerDisplayName}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-bold ${
                    item.status === "approved"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : item.status === "rejected"
                        ? "bg-rose-500/10 text-rose-400"
                        : "bg-sky-500/10 text-sky-400"
                  }`}
                >
                  {item.status}
                </span>
                <div className="flex gap-2">
                  {item.status !== "approved" ? (
                    <button
                      className="rounded-md border border-line px-2 py-1 text-xs transition hover:bg-panel"
                      onClick={() => moderate.mutate({ id: item.id, status: "approved" })}
                    >
                      Разрешить
                    </button>
                  ) : null}
                  {item.status !== "rejected" ? (
                    <button
                      className="rounded-md border border-line px-2 py-1 text-xs transition hover:bg-panel"
                      onClick={() => moderate.mutate({ id: item.id, status: "rejected" })}
                    >
                      Отклонить
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        ))}
        {!media.data?.media.length ? <p className="text-sm text-muted">Изображений пока нет.</p> : null}
      </div>
    </section>
  );
}
