"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailWarning, XCircle } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrate = useAuth((state) => state.hydrate);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setMessage("В ссылке отсутствует токен подтверждения.");
      return;
    }

    apiFetch("/auth/verify-email/confirm", {
      method: "POST",
      body: JSON.stringify({ token })
    })
      .then(async () => {
        setStatus("success");
        await hydrate();
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Не удалось подтвердить email. Попробуйте отправить письмо повторно.");
      });
  }, [searchParams, hydrate]);

  return (
    <div className="mx-auto max-w-md">
      <div className="app-card overflow-hidden p-8 text-center">
        {status === "loading" ? (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-brand" />
            <h1 className="mt-4 text-xl font-black text-ink">Подтверждаем email...</h1>
            <p className="mt-2 text-sm text-muted">Это займет секунду.</p>
          </>
        ) : null}

        {status === "success" ? (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <h1 className="mt-4 text-xl font-black text-ink">Email подтвержден!</h1>
            <p className="mt-2 text-sm leading-6 text-muted">Спасибо, ваш адрес подтвержден. Теперь у вас полный доступ ко всем функциям платформы.</p>
            <button className="app-button mt-6 w-full" type="button" onClick={() => router.push("/dashboard")}>
              В личный кабинет
            </button>
          </>
        ) : null}

        {status === "error" ? (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-500/10 text-rose-500">
              <XCircle className="h-9 w-9" />
            </span>
            <h1 className="mt-4 text-xl font-black text-ink">Не удалось подтвердить</h1>
            <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
            <div className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-amber-100 p-3 text-left text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
              <MailWarning className="h-4 w-4 shrink-0" />
              <span>Ссылка может быть устаревшей (действует 24 часа) или уже использованной. Запросите новую в настройках.</span>
            </div>
            <button className="app-button-secondary mt-6 w-full" type="button" onClick={() => router.push("/settings")}>
              В настройки
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
