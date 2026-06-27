"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, type User } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";
import { useI18n } from "../../lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuth((s) => s.setUser);
  const { t } = useI18n();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
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
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
        <input className="app-input w-full" name="email" type="email" placeholder={t("auth.email")} />
        <input
          className="app-input w-full"
          name="password"
          type="password"
          placeholder={t("auth.password")}
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="app-button w-full">{t("nav.login")}</button>
      </form>
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
