"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../../lib/api";
import { RequireAuth } from "../../../components/RequireAuth";
import { useI18n } from "../../../lib/i18n";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isBanned: boolean;
  createdAt: string;
};

export default function AdminUsersPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminUsersContent />
    </RequireAuth>
  );
}

function AdminUsersContent() {
  const client = useQueryClient();
  const { t } = useI18n();
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch<{ users: AdminUser[] }>("/admin/users")
  });
  const update = useMutation({
    mutationFn: ({ id, isBanned, role }: { id: string; isBanned?: boolean; role?: string }) =>
      apiFetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ isBanned, role }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-users"] })
  });

  return (
    <section className="app-card p-5">
      <h1 className="text-xl font-semibold">{t("admin.userManagement")}</h1>
      <div className="table-shell mt-5 overflow-x-auto shadow-none">
        <table className="min-w-[820px]">
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
                  <select
                    className="app-input py-1"
                    value={user.role === "seller" ? "user" : user.role}
                    onChange={(event) => update.mutate({ id: user.id, role: event.target.value })}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>{user.isBanned ? t("common.banned") : t("common.active")}</td>
                <td className="text-right">
                  <button
                    className="rounded-md border border-line px-3 py-1 transition hover:bg-panel"
                    onClick={() => update.mutate({ id: user.id, isBanned: !user.isBanned })}
                  >
                    {user.isBanned ? t("admin.unban") : t("admin.ban")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
