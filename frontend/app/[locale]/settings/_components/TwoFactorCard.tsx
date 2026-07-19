"use client";

import {
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  X
} from "lucide-react";
import { StatusMessage, StatusPill } from "./settings-ui";
import type {
  SettingsT,
  TwoFaReauthAction,
  TwoFaReauthMethod,
  TwoFaStep
} from "./types";

export function TwoFactorPanel({
  enabled,
  step,
  setup,
  code,
  backupCodes,
  message,
  reauthAction,
  reauthMethod,
  reauthValue,
  startPending,
  confirmPending,
  disablePending,
  regeneratePending,
  setStep,
  setCode,
  setReauthAction,
  setReauthMethod,
  setReauthValue,
  onCancelReauthentication,
  onStart,
  onConfirm,
  onSubmitReauthentication,
  t
}: {
  enabled: boolean;
  step: TwoFaStep;
  setup: { secret: string; otpauthUri: string } | null;
  code: string;
  backupCodes: string[];
  message: string;
  reauthAction: TwoFaReauthAction | null;
  reauthMethod: TwoFaReauthMethod;
  reauthValue: string;
  startPending: boolean;
  confirmPending: boolean;
  disablePending: boolean;
  regeneratePending: boolean;
  setStep: (step: TwoFaStep) => void;
  setCode: (value: string) => void;
  setReauthAction: (action: TwoFaReauthAction | null) => void;
  setReauthMethod: (method: TwoFaReauthMethod) => void;
  setReauthValue: (value: string) => void;
  onCancelReauthentication: () => void;
  onStart: () => void;
  onConfirm: () => void;
  onSubmitReauthentication: () => void;
  t: SettingsT;
}) {
  const securityActionPending =
    (reauthAction === "replace" && startPending) ||
    (reauthAction === "regenerate" && regeneratePending) ||
    (reauthAction === "disable" && disablePending);
  const securityActionLabel =
    reauthAction === "replace"
      ? t("settings.twofa.confirmReplace")
      : reauthAction === "regenerate"
        ? t("settings.twofa.confirmRegenerate")
        : t("settings.twofa.confirmDisable");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-black text-ink">{t("settings.twofa.title")}</h3>
        <StatusPill ok={enabled} okText={t("settings.twofa.statusOn")} badText={t("settings.twofa.statusOff")} />
      </div>
      <p className="text-sm leading-6 text-muted">{t("settings.twofa.shortText")}</p>
      {step === "backupCodes" ? (
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
            {t("settings.twofa.confirmSetup")}
          </button>
        </>
      ) : enabled ? (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="font-bold">{t("settings.twofa.enabled")}</span>
          </div>
          {!reauthAction ? (
            <div className="grid gap-2">
              <button className="app-button-secondary w-full" type="button" onClick={() => setReauthAction("replace")}>
                <RefreshCw className="h-4 w-4" />
                {t("settings.twofa.replace")}
              </button>
              <button className="app-button-secondary w-full" type="button" onClick={() => setReauthAction("regenerate")}>
                <KeyRound className="h-4 w-4" />
                {t("settings.twofa.regenerate")}
              </button>
              <button className="app-button-danger w-full" type="button" onClick={() => setReauthAction("disable")}>
                <ShieldOff className="h-4 w-4" />
                {t("settings.twofa.disable")}
              </button>
            </div>
          ) : (
            <div className="space-y-3 border-t border-line pt-4">
              <p className="text-sm font-bold text-ink">{t("settings.twofa.reauthPrompt")}</p>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-panel/40 p-1">
                <button
                  className={reauthMethod === "password" ? "app-button h-9" : "app-button-secondary h-9"}
                  type="button"
                  onClick={() => {
                    setReauthMethod("password");
                    setReauthValue("");
                  }}
                >
                  {t("settings.twofa.passwordMethod")}
                </button>
                <button
                  className={reauthMethod === "totp" ? "app-button h-9" : "app-button-secondary h-9"}
                  type="button"
                  onClick={() => {
                    setReauthMethod("totp");
                    setReauthValue("");
                  }}
                >
                  {t("settings.twofa.totpMethod")}
                </button>
              </div>
              <input
                className="app-input w-full"
                type={reauthMethod === "password" ? "password" : "text"}
                inputMode={reauthMethod === "totp" ? "numeric" : undefined}
                autoComplete={reauthMethod === "password" ? "current-password" : "one-time-code"}
                placeholder={reauthMethod === "password" ? t("settings.password.current") : t("settings.twofa.currentTotp")}
                value={reauthValue}
                onChange={(event) => setReauthValue(event.target.value)}
              />
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <button
                  className="app-button-secondary"
                  type="button"
                  title={t("settings.twofa.cancel")}
                  aria-label={t("settings.twofa.cancel")}
                  onClick={onCancelReauthentication}
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  className={reauthAction === "disable" ? "app-button-danger" : "app-button"}
                  type="button"
                  disabled={!reauthValue.trim() || securityActionPending}
                  onClick={onSubmitReauthentication}
                >
                  {securityActionPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {securityActionLabel}
                </button>
              </div>
            </div>
          )}
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
