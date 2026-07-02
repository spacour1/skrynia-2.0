"use client";

import { useState } from "react";
import Link from "@/lib/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, MailWarning } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Friendly replacement for the raw 403 email_not_verified error in forms/buy/chat/wallet actions. */
export function EmailNotVerifiedNotice() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const resend = useMutation({
    mutationFn: () => apiFetch("/auth/verify-email/request", { method: "POST" }),
    onSuccess: () => setSent(true)
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-400/40 bg-amber-100 p-4 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
      <div className="flex items-start gap-3">
        <MailWarning className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-bold">{t("verify.blockedTitle")}</p>
          <p className="mt-1 leading-5">{t("verify.blockedText")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {sent ? (
          <span className="font-bold">{t("verify.sent")}</span>
        ) : (
          <button
            className="inline-flex items-center gap-1.5 font-bold underline underline-offset-2 transition hover:opacity-80 disabled:opacity-60"
            type="button"
            onClick={() => resend.mutate()}
            disabled={resend.isPending}
          >
            {resend.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("verify.resendAgain")}
          </button>
        )}
        <Link className="font-bold underline underline-offset-2 transition hover:opacity-80" href="/settings">
          {t("verify.openSettings")}
        </Link>
      </div>
    </div>
  );
}
