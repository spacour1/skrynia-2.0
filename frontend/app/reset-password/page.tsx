"use client";

import { Suspense, FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const repeat = String(form.get("repeat") ?? "");
    if (password !== repeat) {
      setError(t("auth.passwordsDontMatch"));
      return;
    }
    setPending(true);
    try {
      await apiFetch("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, password })
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-md">
        <div className="app-card overflow-hidden p-8 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-500/10 text-rose-500">
            <XCircle className="h-9 w-9" />
          </span>
          <h1 className="mt-4 text-xl font-black text-ink">{t("verify.invalidLink")}</h1>
          <Link className="mt-6 inline-block text-brand hover:underline" href="/forgot-password">
            {t("auth.forgotPasswordTitle")}
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="mx-auto max-w-md">
        <div className="app-card overflow-hidden p-8 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="h-9 w-9" />
          </span>
          <h1 className="mt-4 text-xl font-black text-ink">{t("auth.resetPasswordSuccess")}</h1>
          <button className="app-button mt-6 w-full" type="button" onClick={() => router.push("/login")}>
            {t("auth.goToLogin")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="app-card overflow-hidden">
        <div className="border-b border-line bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">{t("auth.resetPasswordTitle")}</h1>
        </div>
        <div className="p-6">
          <form className="space-y-4" onSubmit={submit}>
            <input className="app-input w-full" name="password" type="password" minLength={8} placeholder={t("auth.newPassword")} required />
            <input className="app-input w-full" name="repeat" type="password" minLength={8} placeholder={t("auth.repeatPassword")} required />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button className="app-button w-full" disabled={pending}>
              {t("auth.resetPasswordSubmit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
