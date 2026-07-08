"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { apiFetch, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";
import { EmailVerificationCard, PhoneVerificationCard } from "./_components/VerificationCards";
import { LanguageCard } from "./_components/LanguageCard";
import { NotificationsCard } from "./_components/NotificationsCard";
import { PasswordCard } from "./_components/PasswordCard";
import { ProfileForm } from "./_components/ProfileForm";
import { TwoFactorCard } from "./_components/TwoFactorCard";
import { WorksCard } from "./_components/WorksCard";
import { emptyProfile, isStrongPassword } from "./_components/settings-state";
import { AvatarView, Summary } from "./_components/settings-ui";
import type { ProfileState } from "./_components/types";

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

  function clearAvatar() {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview("");
    setProfile((current) => ({ ...current, avatarUrl: "" }));
    setProfileMessage(t("settings.avatar.deleteNotice"));
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
    if (!isStrongPassword(newPassword)) {
      setPasswordMessage(t("settings.password.weak"));
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
        <ProfileForm
          profile={profile}
          setProfile={setProfile}
          avatarSrc={avatarSrc}
          initial={initial}
          profileMessage={profileMessage}
          uploadPending={uploadAvatar.isPending}
          updatePending={updateProfile.isPending}
          onSubmit={(event) => {
            event.preventDefault();
            updateProfile.mutate();
          }}
          onPickAvatar={pickAvatar}
          onClearAvatar={clearAvatar}
          t={t}
        />

        <aside className="space-y-6">
          <LanguageCard locale={locale} switchLocale={switchLocale} t={t} />
          <PasswordCard isPending={changePassword.isPending} message={passwordMessage} onSubmit={submitPassword} t={t} />
          <TwoFactorCard
            enabled={Boolean(me.data?.user.twoFactorEnabled)}
            step={twoFaStep}
            setup={twoFaSetup}
            code={twoFaCode}
            backupCodes={backupCodes}
            message={twoFaMessage}
            disablePassword={disablePassword}
            showDisablePrompt={showDisablePrompt}
            startPending={startTwoFactorSetup.isPending}
            confirmPending={confirmTwoFactorSetup.isPending}
            disablePending={disableTwoFactorMutation.isPending}
            setStep={setTwoFaStep}
            setCode={setTwoFaCode}
            setDisablePassword={setDisablePassword}
            setShowDisablePrompt={setShowDisablePrompt}
            onStart={() => startTwoFactorSetup.mutate()}
            onConfirm={() => confirmTwoFactorSetup.mutate()}
            onDisable={() => disableTwoFactorMutation.mutate()}
            t={t}
          />
          <EmailVerificationCard
            verified={Boolean(me.data?.user.emailVerified)}
            email={profile.email}
            resendPending={resendVerification.isPending}
            message={verifyMessage}
            onResend={() => resendVerification.mutate()}
            t={t}
          />
          <PhoneVerificationCard
            verified={Boolean(me.data?.user.phoneVerified)}
            verifiedPhone={me.data?.user.phone ?? ""}
            step={phoneStep}
            phoneInput={phoneInput}
            phoneCode={phoneCode}
            requestPending={requestPhoneCode.isPending}
            confirmPending={confirmPhoneCode.isPending}
            message={phoneMessage}
            setPhoneInput={setPhoneInput}
            setPhoneCode={setPhoneCode}
            setStep={setPhoneStep}
            onRequest={() => requestPhoneCode.mutate()}
            onConfirm={() => confirmPhoneCode.mutate()}
            t={t}
          />
          <NotificationsCard
            emailEnabled={preferences.data?.preferences.emailEnabled ?? true}
            telegramEnabled={preferences.data?.preferences.telegramEnabled ?? true}
            telegramConnected={Boolean(me.data?.user.telegramConnected)}
            connectPending={connectTelegram.isPending}
            message={telegramMessage}
            onEmailChange={(checked) => updatePreferences.mutate({ emailEnabled: checked })}
            onTelegramChange={(checked) => updatePreferences.mutate({ telegramEnabled: checked })}
            onConnectTelegram={() => connectTelegram.mutate()}
            onDisconnectTelegram={() => disconnectTelegram.mutate()}
            t={t}
          />
          <WorksCard t={t} />
        </aside>
      </section>
    </div>
  );
}
