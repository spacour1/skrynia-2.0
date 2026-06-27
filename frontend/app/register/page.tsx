"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, type User } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";
import { useI18n } from "../../lib/i18n";

export default function RegisterPage() {
  const router = useRouter();
  const setUser = useAuth((s) => s.setUser);
  const { t } = useI18n();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await apiFetch<{ user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          displayName: form.get("displayName")
        })
      });
      setUser(response.user);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="app-card overflow-hidden">
        <div className="border-b border-line bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">{t("auth.registerTitle")}</h1>
        </div>
        <form className="space-y-4 p-6" onSubmit={submit}>
        <input className="app-input w-full" name="displayName" placeholder={t("auth.displayName")} />
        <input className="app-input w-full" name="email" type="email" placeholder={t("auth.email")} />
        <input
          className="app-input w-full"
          name="password"
          type="password"
          placeholder={t("auth.password")}
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="app-button w-full">{t("nav.register")}</button>
      </form>
      </div>
    </div>
  );
}
