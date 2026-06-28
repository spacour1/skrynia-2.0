"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, ApiError, type User } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";
import { useI18n } from "../../lib/i18n";
import { consumeReturnPath } from "../../lib/return-path";

// Deliberately not using useSearchParams(): it forces this page out of static rendering
// and (in this app's setup) caused a real SSR/CSR hydration mismatch. The "next" param is
// only ever needed once, at submit time, so reading it straight from the URL there avoids
// both problems entirely.
export default function LoginPage() {
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
      const response = await apiFetch<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password")
        })
      });
      setUser(response.user);
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next ?? consumeReturnPath());
    } catch (err) {
      // ApiError carries a server-written, already-user-safe message (e.g. "Invalid email
      // or password"); anything else is a network/parse failure with no safe detail to show.
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="app-card overflow-hidden">
        <div className="border-b border-line bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">{t("auth.loginTitle")}</h1>
          <p className="mt-1 text-sm text-muted">{t("auth.seedHint")}</p>
        </div>
        <div className="p-6">
          <form className="mt-5 space-y-4" onSubmit={submit}>
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
              autoComplete="current-password"
              required
            />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button className="app-button w-full disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting}>
              {submitting ? t("auth.signingIn") : t("nav.login")}
            </button>
          </form>
          <p className="mt-3 text-sm">
            <Link className="text-brand hover:underline" href="/forgot-password">
              {t("auth.forgotPassword")}
            </Link>
          </p>
          <p className="mt-4 text-sm text-muted">
            {t("auth.noAccount")}{" "}
            <Link className="text-brand hover:underline" href="/register">
              {t("nav.register")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
