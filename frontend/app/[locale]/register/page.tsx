"use client";

import { useRouter } from "@/lib/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, ApiError, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { consumeReturnPath } from "@/lib/return-path";

export default function RegisterPage() {
  const router = useRouter();
  const setUser = useAuth((s) => s.setUser);
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
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
      router.push(consumeReturnPath());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="app-card overflow-hidden">
        <div className="border-b border-line bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">{t("auth.registerTitle")}</h1>
        </div>
        <form className="space-y-4 p-6" onSubmit={submit}>
          <input className="app-input w-full" name="displayName" placeholder={t("auth.displayName")} autoComplete="name" required minLength={2} />
          <input
            className="app-input w-full"
            name="email"
            type="email"
            placeholder={t("auth.email")}
            autoComplete="email"
            required
          />
          <input
            className="app-input w-full"
            name="password"
            type="password"
            placeholder={t("auth.password")}
            autoComplete="new-password"
            required
            minLength={8}
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button className="app-button w-full disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting}>
            {submitting ? t("auth.creatingAccount") : t("nav.register")}
          </button>
        </form>
      </div>
    </div>
  );
}
