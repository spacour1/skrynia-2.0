"use client";

import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { StatusMessage, StatusPill } from "./settings-ui";
import type { SettingsT, TwoFaStep } from "./types";

export function TwoFactorPanel({
  enabled,
  step,
  setup,
  code,
  backupCodes,
  message,
  disablePassword,
  showDisablePrompt,
  startPending,
  confirmPending,
  disablePending,
  setStep,
  setCode,
  setDisablePassword,
  setShowDisablePrompt,
  onStart,
  onConfirm,
  onDisable,
  t
}: {
  enabled: boolean;
  step: TwoFaStep;
  setup: { secret: string; otpauthUri: string } | null;
  code: string;
  backupCodes: string[];
  message: string;
  disablePassword: string;
  showDisablePrompt: boolean;
  startPending: boolean;
  confirmPending: boolean;
  disablePending: boolean;
  setStep: (step: TwoFaStep) => void;
  setCode: (value: string) => void;
  setDisablePassword: (value: string) => void;
  setShowDisablePrompt: (value: boolean) => void;
  onStart: () => void;
  onConfirm: () => void;
  onDisable: () => void;
  t: SettingsT;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-black text-ink">{t("settings.twofa.title")}</h3>
        <StatusPill ok={enabled} okText={t("settings.twofa.statusOn")} badText={t("settings.twofa.statusOff")} />
      </div>
      <p className="text-sm leading-6 text-muted">{t("settings.twofa.shortText")}</p>
      {enabled ? (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="font-bold">{t("settings.twofa.enabled")}</span>
          </div>
          {showDisablePrompt ? (
            <div className="space-y-3">
              <input
                className="app-input w-full"
                type="password"
                placeholder={t("settings.password.current")}
                value={disablePassword}
                onChange={(event) => setDisablePassword(event.target.value)}
              />
              <button className="app-button-danger w-full" type="button" disabled={!disablePassword || disablePending} onClick={onDisable}>
                {t("settings.twofa.confirmDisable")}
              </button>
            </div>
          ) : (
            <button className="app-button-danger w-full" type="button" onClick={() => setShowDisablePrompt(true)}>
              {t("settings.twofa.disable")}
            </button>
          )}
        </>
      ) : step === "backupCodes" ? (
        <>
          <p className="text-sm leading-6 text-muted">{t("settings.twofa.backupIntro")}</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-panel/40 p-4 font-mono text-sm">
            {backupCodes.map((backupCode) => (
              <span key={backupCode}>{backupCode}</span>
            ))}
          </div>
          <button className="app-button w-full" type="button" onClick={() => setStep("idle")}>
            {t("settings.twofa.done")}
          </button>
        </>
      ) : step === "setup" && setup ? (
        <>
          <p className="text-sm leading-6 text-muted">{t("settings.twofa.setupIntro")}</p>
          <div className="rounded-lg border border-line bg-panel/40 p-4">
            <p className="break-all font-mono text-xs text-muted">{setup.otpauthUri}</p>
            <p className="mt-2 text-sm">
              {t("settings.twofa.secretLabel")} <span className="font-mono font-bold">{setup.secret}</span>
            </p>
          </div>
          <input className="app-input w-full" inputMode="numeric" placeholder={t("settings.twofa.codePlaceholder")} value={code} onChange={(event) => setCode(event.target.value)} />
          <button className="app-button w-full" type="button" disabled={!code.trim() || confirmPending} onClick={onConfirm}>
            {confirmPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t("settings.twofa.confirmEnable")}
          </button>
        </>
      ) : (
        <>
          <button className="app-button-secondary w-full" type="button" disabled={startPending} onClick={onStart}>
            {startPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t("settings.twofa.enable")}
          </button>
          <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            {t("settings.twofa.recommended")}
          </p>
        </>
      )}
      <StatusMessage message={message} />
    </div>
  );
}
