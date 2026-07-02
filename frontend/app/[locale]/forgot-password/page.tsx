"use client";

import Link from "@/lib/navigation";
import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email") })
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="app-card overflow-hidden">
        <div className="border-b border-line bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">{t("auth.forgotPasswordTitle")}</h1>
          <p className="mt-1 text-sm text-muted">{t("auth.forgotPasswordText")}</p>
        </div>
        <div className="p-6">
          {sent ? (
            <p className="text-sm text-muted">{t("auth.forgotPasswordSent")}</p>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <input className="app-input w-full" name="email" type="email" placeholder={t("auth.email")} required />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button className="app-button w-full" disabled={pending}>
                {t("auth.forgotPasswordSubmit")}
              </button>
            </form>
          )}
          <p className="mt-4 text-sm text-muted">
            <Link className="text-brand hover:underline" href="/login">
              {t("auth.backToLogin")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
