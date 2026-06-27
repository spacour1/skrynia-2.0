"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailCheck, MailWarning, XCircle } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";
import { useI18n } from "../../lib/i18n";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrate = useAuth((state) => state.hydrate);
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"ready" | "loading" | "success" | "error">(token ? "ready" : "error");
  const [message, setMessage] = useState("");

  // Requiring a click (instead of auto-confirming on page load) means email-security
  // scanners that prefetch/crawl links in the inbox can't burn the one-time token before
  // the actual recipient gets a chance to use it.
  function confirm() {
    if (!token || status === "loading") return;
    setStatus("loading");
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
        setMessage(err instanceof ApiError ? err.message : "");
      });
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="app-card overflow-hidden p-8 text-center">
        {status === "ready" ? (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand/10 text-brand">
              <MailCheck className="h-9 w-9" />
            </span>
            <h1 className="mt-4 text-xl font-black text-ink">{t("verify.title")}</h1>
            <p className="mt-2 text-sm leading-6 text-muted">{t("verify.checkInbox")}</p>
            <button className="app-button mt-6 w-full" type="button" onClick={confirm}>
              {t("verify.confirmCta")}
            </button>
          </>
        ) : null}

        {status === "loading" ? (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-brand" />
            <h1 className="mt-4 text-xl font-black text-ink">{t("verify.confirming")}</h1>
          </>
        ) : null}

        {status === "success" ? (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <h1 className="mt-4 text-xl font-black text-ink">{t("verify.confirmed")}</h1>
            <p className="mt-2 text-sm leading-6 text-muted">{t("verify.confirmedText")}</p>
            <button className="app-button mt-6 w-full" type="button" onClick={() => router.push("/dashboard")}>
              {t("verify.continueToSite")}
            </button>
          </>
        ) : null}

        {status === "error" ? (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-500/10 text-rose-500">
              <XCircle className="h-9 w-9" />
            </span>
            <h1 className="mt-4 text-xl font-black text-ink">{t("verify.invalidLink")}</h1>
            <p className="mt-2 text-sm leading-6 text-muted">{message || t("verify.invalidLinkText")}</p>
            <div className="mt-6 flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-100 p-3 text-left text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
              <MailWarning className="h-4 w-4 shrink-0" />
              <span>{t("verify.invalidLinkText")}</span>
            </div>
            <button className="app-button-secondary mt-6 w-full" type="button" onClick={() => router.push("/settings")}>
              {t("verify.openSettings")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
