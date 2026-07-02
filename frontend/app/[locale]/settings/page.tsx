"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Camera,
  CheckCircle2,
  KeyRound,
  Languages,
  Loader2,
  Mail,
  MailCheck,
  MailWarning,
  Moon,
  Phone,
  Save,
  Send,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { apiFetch, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";
import { localeLabels, locales } from "@/i18n/config";
import { useTheme } from "@/lib/theme-store";

type ProfileState = {
  displayName: string;
  email: string;
  avatarUrl: string;
  profileDescription: string;
  pushEnabled: boolean;
};

const emptyProfile: ProfileState = {
  displayName: "",
  email: "",
  avatarUrl: "",
  profileDescription: "",
  pushEnabled: false
};

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsContent />
    </RequireAuth>
  );
}

function SettingsContent() {
  const authUser = useAuth((state) => state.user);
  const setUser = useAuth((state) => state.setUser);
  const queryClient = useQueryClient();
  const { locale, switchLocale, t } = useI18n();
  const { theme, setThemeAndReload } = useTheme();
  const [profile, setProfile] = useState<ProfileState>(emptyProfile);
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");

  const me = useQuery({
    queryKey: ["me-settings"],
    queryFn: () => apiFetch<{ user: User }>("/users/me")
  });

  useEffect(() => {
    if (!me.data?.user) return;
    setProfile({
      displayName: me.data.user.displayName,
      email: me.data.user.email,
      avatarUrl: me.data.user.avatarUrl ?? "",
      profileDescription: typeof me.data.user.settings?.profileDescription === "string" ? me.data.user.settings.profileDescription : "",
      pushEnabled: Boolean(me.data.user.pushEnabled)
    });
  }, [me.data]);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return apiFetch<{ url: string }>("/storage/upload", { method: "POST", body });
    },
    onSuccess: ({ url }) => {
      setProfile((current) => ({ ...current, avatarUrl: url }));
      setProfileMessage(t("settings.avatar.uploaded"));
    },
    onError: (err) => setProfileMessage(err instanceof Error ? err.message : t("settings.avatar.uploadFailed"))
  });

  const updateProfile = useMutation({
    mutationFn: () =>
      apiFetch<{ user: User }>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          ...profile,
          settings: {
            ...(me.data?.user.settings ?? {}),
            profileDescription: profile.profileDescription.trim()
          }
        })
      }),
    onSuccess: (response) => {
      setProfileMessage(t("settings.profile.saved"));
      if (authUser) setUser({ ...authUser, ...response.user });
      queryClient.invalidateQueries({ queryKey: ["me-settings"] });
    },
    onError: (err) => setProfileMessage(err instanceof Error ? err.message : t("settings.profile.saveFailed"))
  });

  const changePassword = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch("/users/me/password", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => setPasswordMessage(t("settings.password.updated")),
    onError: (err) => setPasswordMessage(err instanceof Error ? err.message : t("settings.password.changeFailed"))
  });

  const [verifyMessage, setVerifyMessage] = useState("");
  const resendVerification = useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/auth/verify-email/request", { method: "POST" }),
    onSuccess: (response) =>
      setVerifyMessage(response.status === "already_verified" ? t("settings.emailVerify.alreadyVerified") : t("settings.emailVerify.sent")),
    onError: (err) => setVerifyMessage(err instanceof Error ? err.message : t("settings.emailVerify.sendFailed"))
  });

  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"enter" | "code_sent">("enter");
  const [phoneMessage, setPhoneMessage] = useState("");

  const requestPhoneCode = useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/users/me/phone/request", { method: "POST", body: JSON.stringify({ phone: phoneInput.trim() }) }),
    onSuccess: () => {
      setPhoneStep("code_sent");
      setPhoneMessage(t("settings.phone.codeSent"));
    },
    onError: (err) => setPhoneMessage(err instanceof Error ? err.message : t("settings.phone.sendFailed"))
  });

  const confirmPhoneCode = useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/users/me/phone/confirm", { method: "POST", body: JSON.stringify({ code: phoneCode.trim() }) }),
    onSuccess: () => {
      setPhoneMessage(t("settings.phone.confirmed"));
      setPhoneStep("enter");
      setPhoneCode("");
      queryClient.invalidateQueries({ queryKey: ["me-settings"] });
    },
    onError: (err) => setPhoneMessage(err instanceof Error ? err.message : t("settings.phone.invalidCode"))
  });

  const preferences = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => apiFetch<{ preferences: { emailEnabled: boolean; telegramEnabled: boolean } }>("/users/me/notifications/preferences")
  });
  const [telegramMessage, setTelegramMessage] = useState("");

  const updatePreferences = useMutation({
    mutationFn: (payload: { emailEnabled?: boolean; telegramEnabled?: boolean }) =>
      apiFetch("/users/me/notifications/preferences", { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-preferences"] })
  });

  const [twoFaStep, setTwoFaStep] = useState<"idle" | "setup" | "backupCodes">("idle");
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [twoFaMessage, setTwoFaMessage] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisablePrompt, setShowDisablePrompt] = useState(false);

  const startTwoFactorSetup = useMutation({
    mutationFn: () => apiFetch<{ secret: string; otpauthUri: string }>("/users/me/2fa/setup", { method: "POST" }),
    onSuccess: (data) => {
      setTwoFaSetup(data);
      setTwoFaStep("setup");
      setTwoFaMessage("");
    },
    onError: (err) => setTwoFaMessage(err instanceof Error ? err.message : t("settings.twofa.setupFailed"))
  });

  const confirmTwoFactorSetup = useMutation({
    mutationFn: () => apiFetch<{ backupCodes: string[] }>("/users/me/2fa/enable", { method: "POST", body: JSON.stringify({ code: twoFaCode.trim() }) }),
    onSuccess: ({ backupCodes: codes }) => {
      setBackupCodes(codes);
      setTwoFaStep("backupCodes");
      setTwoFaCode("");
      queryClient.invalidateQueries({ queryKey: ["me-settings"] });
    },
    onError: (err) => setTwoFaMessage(err instanceof Error ? err.message : t("settings.twofa.invalidCode"))
  });

  const disableTwoFactorMutation = useMutation({
    mutationFn: () => apiFetch("/users/me/2fa/disable", { method: "POST", body: JSON.stringify({ currentPassword: disablePassword }) }),
    onSuccess: () => {
      setShowDisablePrompt(false);
      setDisablePassword("");
      setTwoFaStep("idle");
      setTwoFaSetup(null);
      queryClient.invalidateQueries({ queryKey: ["me-settings"] });
    },
    onError: (err) => setTwoFaMessage(err instanceof Error ? err.message : t("settings.twofa.disableFailed"))
  });

  const connectTelegram = useMutation({
    mutationFn: () => apiFetch<{ link: string }>("/users/me/telegram/connect", { method: "POST" }),
    onSuccess: ({ link }) => window.open(link, "_blank", "noopener,noreferrer"),
    onError: (err) => setTelegramMessage(err instanceof Error ? err.message : t("settings.telegram.connectFailed"))
  });

  const disconnectTelegram = useMutation({
    mutationFn: () => apiFetch("/users/me/telegram/disconnect", { method: "POST" }),
    onSuccess: () => {
      setTelegramMessage(t("settings.telegram.disconnected"));
      queryClient.invalidateQueries({ queryKey: ["me-settings"] });
    }
  });

  function pickAvatar(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileMessage(t("settings.avatar.invalidType"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProfileMessage(t("settings.avatar.tooLarge"));
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(file));
    uploadAvatar.mutate(file);
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    const repeatPassword = String(form.get("repeatPassword") ?? "");
    if (newPassword !== repeatPassword) {
      setPasswordMessage(t("settings.password.mismatch"));
      return;
    }
    changePassword.mutate({
      currentPassword: form.get("currentPassword"),
      newPassword
    });
    event.currentTarget.reset();
  }

  const avatarSrc = avatarPreview || profile.avatarUrl;
  const initial = profile.displayName.slice(0, 1).toUpperCase() || "U";

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <section className="app-card overflow-hidden">
        <div className="grid gap-6 bg-panel/60 p-6 lg:grid-cols-[1fr_360px] lg:items-center">
          <div className="flex items-center gap-5">
            <AvatarView src={avatarSrc} initial={initial} size="large" />
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-bold text-brand">
                <UserRound className="h-3.5 w-3.5" />
                {t("settings.badge")}
              </p>
              <h1 className="mt-3 text-3xl font-black text-ink">{profile.displayName || t("settings.profile.title")}</h1>
              <p className="mt-2 text-sm leading-6 text-muted">{t("settings.headerText")}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Summary label={t("auth.email")} value={profile.email || "-"} />
            <Summary label={t("common.role")} value={authUser?.role ?? "-"} />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <form
          className="app-card overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            updateProfile.mutate();
          }}
        >
          <SectionHeader icon={UserRound} title={t("settings.profile.title")} text={t("settings.profile.text")} />
          <div className="space-y-6 p-5">
            <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
              <div className="rounded-lg border border-line bg-panel/35 p-4">
                <AvatarView src={avatarSrc} initial={initial} />
                <div className="mt-4 grid gap-2">
                  <label className="app-button-secondary cursor-pointer">
                    {uploadAvatar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {t("settings.avatar.upload")}
                    <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => pickAvatar(event.target.files?.[0])} />
                  </label>
                  <button
                    className="app-button-danger"
                    type="button"
                    onClick={() => {
                      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                      setAvatarPreview("");
                      setProfile((current) => ({ ...current, avatarUrl: "" }));
                      setProfileMessage(t("settings.avatar.deleteNotice"));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("settings.avatar.delete")}
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">{t("settings.avatar.hint")}</p>
              </div>

              <div className="grid content-start gap-4">
                <Field label={t("settings.profile.nameLabel")}>
                  <input className="app-input w-full" value={profile.displayName} minLength={2} maxLength={80} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} required />
                </Field>
                <Field label={t("auth.email")}>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input className="app-input w-full pl-9" type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} required />
                  </div>
                </Field>
                <Field label={t("settings.profile.bio")}>
                  <textarea
                    className="app-input min-h-[120px] w-full resize-y leading-6"
                    value={profile.profileDescription}
                    maxLength={600}
                    onChange={(event) => setProfile({ ...profile, profileDescription: event.target.value })}
                    placeholder={t("settings.profile.bioPlaceholder")}
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Toggle
                    icon={Bell}
                    title={t("settings.push.title")}
                    text={t("settings.push.text")}
                    checked={profile.pushEnabled}
                    onChange={(checked) => setProfile({ ...profile, pushEnabled: checked })}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <StatusMessage message={profileMessage} />
              <button className="app-button h-11 px-5" disabled={updateProfile.isPending || uploadAvatar.isPending}>
                {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("settings.profile.save")}
              </button>
            </div>
          </div>
        </form>

        <aside className="space-y-6">
          <section className="app-card overflow-hidden">
            <SectionHeader icon={Languages} title={t("settings.language.title")} text={t("settings.language.text")} />
            <div className="grid gap-3 p-5">
              {locales.map((option) => (
                <button
                  key={option}
                  className={`flex items-center justify-between rounded-lg border p-4 text-left transition hover:border-brand/70 ${
                    option === locale ? "border-brand/70 bg-brand/10" : "border-line bg-panel/35"
                  }`}
                  type="button"
                  onClick={() => switchLocale(option)}
                >
                  <span className="font-black text-ink">{localeLabels[option]}</span>
                  <span className={`text-xs font-black ${option === locale ? "text-brand" : "text-muted"}`}>{option.toUpperCase()}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="app-card overflow-hidden">
            <SectionHeader icon={Sun} title={t("settings.theme.title")} text={t("settings.theme.text")} />
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <button
                className={`rounded-lg border p-4 text-left transition hover:border-brand/70 ${theme === "light" ? "border-brand/70 bg-brand/10" : "border-line bg-panel/35"}`}
                type="button"
                onClick={() => setThemeAndReload("light")}
              >
                <Sun className="h-5 w-5 text-brand" />
                <span className="mt-3 block font-black text-ink">{t("settings.theme.light")}</span>
              </button>
              <button
                className={`rounded-lg border p-4 text-left transition hover:border-brand/70 ${theme === "dark" ? "border-brand/70 bg-brand/10" : "border-line bg-panel/35"}`}
                type="button"
                onClick={() => setThemeAndReload("dark")}
              >
                <Moon className="h-5 w-5 text-brand" />
                <span className="mt-3 block font-black text-ink">{t("settings.theme.dark")}</span>
              </button>
            </div>
          </section>

          <form className="app-card overflow-hidden" onSubmit={submitPassword}>
            <SectionHeader icon={KeyRound} title={t("settings.password.title")} text={t("settings.password.text")} />
            <div className="space-y-4 p-5">
              <input className="app-input w-full" name="currentPassword" type="password" placeholder={t("settings.password.current")} required />
              <input className="app-input w-full" name="newPassword" type="password" placeholder={t("settings.password.new")} minLength={8} required />
              <input className="app-input w-full" name="repeatPassword" type="password" placeholder={t("settings.password.repeat")} minLength={8} required />
              <StatusMessage message={passwordMessage} />
              <button className="app-button-secondary w-full" disabled={changePassword.isPending}>
                {changePassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {t("settings.password.change")}
              </button>
            </div>
          </form>

          <section className="app-card overflow-hidden">
            <SectionHeader icon={ShieldCheck} title={t("settings.twofa.title")} text={t("settings.twofa.text")} />
            <div className="space-y-4 p-5">
              {me.data?.user.twoFactorEnabled ? (
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
                      <button
                        className="app-button-danger w-full"
                        type="button"
                        disabled={!disablePassword || disableTwoFactorMutation.isPending}
                        onClick={() => disableTwoFactorMutation.mutate()}
                      >
                        {t("settings.twofa.confirmDisable")}
                      </button>
                    </div>
                  ) : (
                    <button className="app-button-danger w-full" type="button" onClick={() => setShowDisablePrompt(true)}>
                      {t("settings.twofa.disable")}
                    </button>
                  )}
                </>
              ) : twoFaStep === "backupCodes" ? (
                <>
                  <p className="text-sm leading-6 text-muted">{t("settings.twofa.backupIntro")}</p>
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-panel/40 p-4 font-mono text-sm">
                    {backupCodes.map((code) => (
                      <span key={code}>{code}</span>
                    ))}
                  </div>
                  <button className="app-button w-full" type="button" onClick={() => setTwoFaStep("idle")}>
                    {t("settings.twofa.done")}
                  </button>
                </>
              ) : twoFaStep === "setup" && twoFaSetup ? (
                <>
                  <p className="text-sm leading-6 text-muted">{t("settings.twofa.setupIntro")}</p>
                  <div className="rounded-lg border border-line bg-panel/40 p-4">
                    <p className="break-all font-mono text-xs text-muted">{twoFaSetup.otpauthUri}</p>
                    <p className="mt-2 text-sm">
                      {t("settings.twofa.secretLabel")} <span className="font-mono font-bold">{twoFaSetup.secret}</span>
                    </p>
                  </div>
                  <input
                    className="app-input w-full"
                    inputMode="numeric"
                    placeholder={t("settings.twofa.codePlaceholder")}
                    value={twoFaCode}
                    onChange={(event) => setTwoFaCode(event.target.value)}
                  />
                  <button
                    className="app-button w-full"
                    type="button"
                    disabled={!twoFaCode.trim() || confirmTwoFactorSetup.isPending}
                    onClick={() => confirmTwoFactorSetup.mutate()}
                  >
                    {confirmTwoFactorSetup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {t("settings.twofa.confirmEnable")}
                  </button>
                </>
              ) : (
                <button
                  className="app-button-secondary w-full"
                  type="button"
                  disabled={startTwoFactorSetup.isPending}
                  onClick={() => startTwoFactorSetup.mutate()}
                >
                  {startTwoFactorSetup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {t("settings.twofa.enable")}
                </button>
              )}
              <StatusMessage message={twoFaMessage} />
            </div>
          </section>

          <section className="app-card overflow-hidden">
            <SectionHeader icon={Mail} title={t("settings.emailVerify.title")} text={t("settings.emailVerify.text")} />
            <div className="space-y-4 p-5">
              {me.data?.user.emailVerified ? (
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
                  <p className="text-sm leading-6 text-muted">{t("settings.emailVerify.sentTo", { email: profile.email })}</p>
                  <button
                    className="app-button-secondary w-full"
                    type="button"
                    disabled={resendVerification.isPending}
                    onClick={() => resendVerification.mutate()}
                  >
                    {resendVerification.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    {t("settings.emailVerify.resend")}
                  </button>
                </>
              )}
              <StatusMessage message={verifyMessage} />
            </div>
          </section>

          <section className="app-card overflow-hidden">
            <SectionHeader icon={Phone} title={t("settings.phone.title")} text={t("settings.phone.text")} />
            <div className="space-y-4 p-5">
              {me.data?.user.phoneVerified ? (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span className="font-bold">{t("settings.phone.verified", { phone: me.data.user.phone ?? "" })}</span>
                </div>
              ) : phoneStep === "enter" ? (
                <>
                  <label className="block space-y-2">
                    <span className="block text-xs font-bold text-muted">{t("settings.phone.numberLabel")}</span>
                    <input
                      className="app-input h-11 w-full"
                      type="tel"
                      placeholder="+380501234567"
                      value={phoneInput}
                      onChange={(event) => setPhoneInput(event.target.value)}
                    />
                  </label>
                  <button
                    className="app-button-secondary w-full"
                    type="button"
                    disabled={!phoneInput.trim() || requestPhoneCode.isPending}
                    onClick={() => requestPhoneCode.mutate()}
                  >
                    {requestPhoneCode.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                    {t("settings.phone.sendCode")}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm leading-6 text-muted">{t("settings.phone.codeSentTo", { phone: phoneInput })}</p>
                  <label className="block space-y-2">
                    <span className="block text-xs font-bold text-muted">{t("settings.phone.codeLabel")}</span>
                    <input
                      className="app-input h-11 w-full"
                      type="text"
                      inputMode="numeric"
                      placeholder="482913"
                      value={phoneCode}
                      onChange={(event) => setPhoneCode(event.target.value)}
                    />
                  </label>
                  <button
                    className="app-button-secondary w-full"
                    type="button"
                    disabled={!phoneCode.trim() || confirmPhoneCode.isPending}
                    onClick={() => confirmPhoneCode.mutate()}
                  >
                    {confirmPhoneCode.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {t("settings.phone.confirmCode")}
                  </button>
                  <button
                    className="w-full text-center text-sm font-bold text-muted underline underline-offset-2 transition hover:text-ink"
                    type="button"
                    onClick={() => setPhoneStep("enter")}
                  >
                    {t("settings.phone.changeNumber")}
                  </button>
                </>
              )}
              <StatusMessage message={phoneMessage} />
            </div>
          </section>

          <section className="app-card overflow-hidden">
            <SectionHeader icon={Send} title={t("settings.notifs.title")} text={t("settings.notifs.text")} />
            <div className="space-y-4 p-5">
              <Toggle
                icon={Mail}
                title={t("settings.notifs.emailTitle")}
                text={t("settings.notifs.emailText")}
                checked={preferences.data?.preferences.emailEnabled ?? true}
                onChange={(checked) => updatePreferences.mutate({ emailEnabled: checked })}
              />
              <Toggle
                icon={Send}
                title={t("settings.notifs.telegramTitle")}
                text={t("settings.notifs.telegramText")}
                checked={preferences.data?.preferences.telegramEnabled ?? true}
                onChange={(checked) => updatePreferences.mutate({ telegramEnabled: checked })}
              />
              {me.data?.user.telegramConnected ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
                  <span className="flex items-center gap-2 font-bold">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    {t("settings.telegram.connected")}
                  </span>
                  <button
                    className="text-xs font-bold text-muted underline underline-offset-2 transition hover:text-ink"
                    type="button"
                    onClick={() => disconnectTelegram.mutate()}
                  >
                    {t("settings.telegram.disconnect")}
                  </button>
                </div>
              ) : (
                <button
                  className="app-button-secondary w-full"
                  type="button"
                  disabled={connectTelegram.isPending}
                  onClick={() => connectTelegram.mutate()}
                >
                  {connectTelegram.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("settings.telegram.connect")}
                </button>
              )}
              <StatusMessage message={telegramMessage} />
            </div>
          </section>

          <section className="app-card p-5">
            <h2 className="flex items-center gap-2 font-black text-ink">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              {t("settings.works.title")}
            </h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-muted">
              <p>{t("settings.works.item1")}</p>
              <p>{t("settings.works.item2")}</p>
              <p>{t("settings.works.item3")}</p>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function AvatarView({ src, initial, size = "normal" }: { src?: string; initial: string; size?: "normal" | "large" }) {
  const classes = size === "large" ? "h-24 w-24 rounded-2xl text-4xl" : "mx-auto h-36 w-36 rounded-2xl text-5xl";
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden border border-line bg-brand/10 font-black text-brand shadow-soft ${classes}`}>
      {src ? <img className="h-full w-full object-cover" src={src} alt="" /> : initial}
      <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-lg bg-card text-brand shadow-soft">
        <Camera className="h-4 w-4" />
      </span>
    </span>
  );
}

function SectionHeader({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-panel/50 p-5">
      <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand/10 text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-xl font-black text-ink">{title}</h2>
        <p className="mt-1 text-sm text-muted">{text}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2 text-sm font-bold text-ink">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  icon: Icon,
  title,
  text,
  checked,
  onChange
}: {
  icon: typeof Bell;
  title: string;
  text: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface/60 p-4 transition hover:border-brand/50 hover:bg-panel/50">
      <Icon className="mt-1 h-5 w-5 text-brand" />
      <span className="min-w-0 flex-1">
        <span className="block font-black text-ink">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-muted">{text}</span>
      </span>
      <input className="mt-1 h-5 w-5 accent-[rgb(var(--color-brand))]" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-card/70 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate font-black text-ink">{value}</p>
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  if (!message) return null;
  return <p className="text-sm font-semibold text-muted">{message}</p>;
}
