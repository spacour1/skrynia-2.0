"use client";

import { CheckCircle2, Loader2, Mail, MailCheck, MailWarning, Phone } from "lucide-react";
import { SectionHeader, StatusMessage } from "./settings-ui";
import type { PhoneStep, SettingsT } from "./types";

export function EmailVerificationCard({
  verified,
  email,
  resendPending,
  message,
  onResend,
  t
}: {
  verified: boolean;
  email: string;
  resendPending: boolean;
  message: string;
  onResend: () => void;
  t: SettingsT;
}) {
  return (
    <section className="app-card overflow-hidden">
      <SectionHeader icon={Mail} title={t("settings.emailVerify.title")} text={t("settings.emailVerify.text")} />
      <div className="space-y-4 p-5">
        {verified ? (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            <MailCheck className="h-5 w-5 shrink-0" />
            <span className="font-bold">{t("settings.emailVerify.verified")}</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-amber-400/40 bg-amber-100 p-4 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
              <MailWarning className="h-5 w-5 shrink-0" />
              <span className="font-bold">{t("settings.emailVerify.notVerified")}</span>
            </div>
            <p className="text-sm leading-6 text-muted">{t("settings.emailVerify.sentTo", { email })}</p>
            <button className="app-button-secondary w-full" type="button" disabled={resendPending} onClick={onResend}>
              {resendPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {t("settings.emailVerify.resend")}
            </button>
          </>
        )}
        <StatusMessage message={message} />
      </div>
    </section>
  );
}

export function PhoneVerificationCard({
  verified,
  verifiedPhone,
  step,
  phoneInput,
  phoneCode,
  requestPending,
  confirmPending,
  message,
  setPhoneInput,
  setPhoneCode,
  setStep,
  onRequest,
  onConfirm,
  t
}: {
  verified: boolean;
  verifiedPhone: string;
  step: PhoneStep;
  phoneInput: string;
  phoneCode: string;
  requestPending: boolean;
  confirmPending: boolean;
  message: string;
  setPhoneInput: (value: string) => void;
  setPhoneCode: (value: string) => void;
  setStep: (step: PhoneStep) => void;
  onRequest: () => void;
  onConfirm: () => void;
  t: SettingsT;
}) {
  return (
    <section className="app-card overflow-hidden">
      <SectionHeader icon={Phone} title={t("settings.phone.title")} text={t("settings.phone.text")} />
      <div className="space-y-4 p-5">
        {verified ? (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="font-bold">{t("settings.phone.verified", { phone: verifiedPhone })}</span>
          </div>
        ) : step === "enter" ? (
          <>
            <label className="block space-y-2">
              <span className="block text-xs font-bold text-muted">{t("settings.phone.numberLabel")}</span>
              <input className="app-input h-11 w-full" type="tel" placeholder="+380501234567" value={phoneInput} onChange={(event) => setPhoneInput(event.target.value)} />
            </label>
            <button className="app-button-secondary w-full" type="button" disabled={!phoneInput.trim() || requestPending} onClick={onRequest}>
              {requestPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              {t("settings.phone.sendCode")}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm leading-6 text-muted">{t("settings.phone.codeSentTo", { phone: phoneInput })}</p>
            <label className="block space-y-2">
              <span className="block text-xs font-bold text-muted">{t("settings.phone.codeLabel")}</span>
              <input className="app-input h-11 w-full" type="text" inputMode="numeric" placeholder="482913" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} />
            </label>
            <button className="app-button-secondary w-full" type="button" disabled={!phoneCode.trim() || confirmPending} onClick={onConfirm}>
              {confirmPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {t("settings.phone.confirmCode")}
            </button>
            <button className="w-full text-center text-sm font-bold text-muted underline underline-offset-2 transition hover:text-ink" type="button" onClick={() => setStep("enter")}>
              {t("settings.phone.changeNumber")}
            </button>
          </>
        )}
        <StatusMessage message={message} />
      </div>
    </section>
  );
}
