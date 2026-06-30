"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../../lib/api";
import { RequireAuth } from "../../../components/RequireAuth";
import { useI18n } from "../../../lib/i18n";
import { useAuth } from "../../../lib/auth-store";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isBanned: boolean;
  mutedUntil?: string | null;
  createdAt: string;
};

export default function AdminUsersPage() {
  return (
    <RequireAuth roles={["admin", "moderator"]}>
      <AdminUsersContent />
    </RequireAuth>
  );
}

function AdminUsersContent() {
  const client = useQueryClient();
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch<{ users: AdminUser[] }>("/admin/users")
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["admin-users"] });

  const update = useMutation({
    mutationFn: ({ id, isBanned, role }: { id: string; isBanned?: boolean; role?: string }) =>
      apiFetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ isBanned, role }) }),
    onSuccess: refresh
  });

  const warn = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`/admin/users/${id}/warn`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: refresh
  });

  const mute = useMutation({
    mutationFn: ({ id, hours, reason }: { id: string; hours: number; reason?: string }) =>
      apiFetch(`/admin/users/${id}/mute`, { method: "POST", body: JSON.stringify({ hours, reason }) }),
    onSuccess: refresh
  });

  const unmute = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/users/${id}/unmute`, { method: "POST" }),
    onSuccess: refresh
  });

  function isCurrentlyMuted(user: AdminUser) {
    return Boolean(user.mutedUntil && new Date(user.mutedUntil).getTime() > Date.now());
  }

  function promptWarn(id: string) {
    const reason = window.prompt("Причина предупреждения:");
    if (reason?.trim()) warn.mutate({ id, reason: reason.trim() });
  }

  function promptMute(id: string) {
    const hours = Number(window.prompt("На сколько часов замьютить?", "24"));
    if (!hours || hours < 1) return;
    const reason = window.prompt("Причина (необязательно):") ?? undefined;
    mute.mutate({ id, hours, reason: reason?.trim() || undefined });
  }

  return (
    <section className="app-card p-5">
      <h1 className="text-xl font-semibold">{t("admin.userManagement")}</h1>
      <div className="table-shell mt-5 overflow-x-auto shadow-none">
        <table className="min-w-[960px]">
          <thead>
            <tr>
              <th>{t("common.user")}</th>
              <th>{t("auth.email")}</th>
              <th>{t("common.role")}</th>
              <th>{t("common.status")}</th>
              <th className="text-right">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.users.map((user) => (
              <tr key={user.id} className="border-b border-line transition last:border-b-0 hover:bg-panel/60">
                <td>{user.displayName}</td>
                <td>{user.email}</td>
                <td>
                  {isAdmin ? (
                    <select
                      className="app-input py-1"
                      value={user.role}
                      onChange={(event) => update.mutate({ id: user.id, role: event.target.value })}
                    >
                      <option value="user">user</option>
                      <option value="moderator">moderator</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    user.role
                  )}
                </td>
                <td>
                  {user.isBanned ? t("common.banned") : t("common.active")}
                  {isCurrentlyMuted(user) ? (
                    <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-black text-amber-600 dark:text-amber-300">
                      muted до {new Date(user.mutedUntil!).toLocaleString("ru-RU")}
                    </span>
                  ) : null}
                </td>
                <td className="text-right">
                  <div className="inline-flex flex-wrap justify-end gap-2">
                    <button className="rounded-md border border-line px-3 py-1 transition hover:bg-panel" onClick={() => promptWarn(user.id)}>
                      Предупредить
                    </button>
                    {isCurrentlyMuted(user) ? (
                      <button className="rounded-md border border-line px-3 py-1 transition hover:bg-panel" onClick={() => unmute.mutate(user.id)}>
                        Размьютить
                      </button>
                    ) : (
                      <button className="rounded-md border border-line px-3 py-1 transition hover:bg-panel" onClick={() => promptMute(user.id)}>
                        Замьютить
                      </button>
                    )}
                    {isAdmin ? (
                      <button
                        className="rounded-md border border-line px-3 py-1 transition hover:bg-panel"
                        onClick={() => update.mutate({ id: user.id, isBanned: !user.isBanned })}
                      >
                        {user.isBanned ? t("admin.unban") : t("admin.ban")}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
