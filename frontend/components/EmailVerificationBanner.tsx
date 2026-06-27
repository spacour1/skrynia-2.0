"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { MailWarning, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth-store";

const DISMISS_KEY = "skrynia-email-banner-dismissed";

export function EmailVerificationBanner() {
  const user = useAuth((state) => state.user);
  const hydrated = useAuth((state) => state.hydrated);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  });
  const [sent, setSent] = useState(false);

  const resend = useMutation({
    mutationFn: () => apiFetch("/auth/verify-email/request", { method: "POST" }),
    onSuccess: () => setSent(true)
  });

  if (!hydrated || !user || user.emailVerified || dismissed) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/40 bg-amber-100 px-4 py-3 text-sm text-amber-900 shadow-soft dark:bg-amber-400/10 dark:text-amber-200"
      role="status"
    >
      <MailWarning className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1 leading-5">
        Подтвердите email, чтобы защитить аккаунт и получать уведомления о заказах.{" "}
        {sent ? (
          <span className="font-bold">Письмо отправлено — проверьте почту.</span>
        ) : (
          <button
            className="font-bold underline underline-offset-2 transition hover:opacity-80 disabled:opacity-60"
            type="button"
            onClick={() => resend.mutate()}
            disabled={resend.isPending}
          >
            {resend.isPending ? "Отправляем..." : "Отправить письмо"}
          </button>
        )}{" "}
        или откройте{" "}
        <Link className="font-bold underline underline-offset-2 transition hover:opacity-80" href="/settings">
          настройки
        </Link>
        .
      </p>
      <button
        className="shrink-0 rounded-md p-1.5 text-amber-900/70 transition hover:bg-amber-200/60 dark:text-amber-200/70 dark:hover:bg-amber-400/10"
        type="button"
        aria-label="Скрыть уведомление"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
