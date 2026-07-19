"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";
import { PhoneVerificationCard } from "./_components/VerificationCards";
import { LanguageCard } from "./_components/LanguageCard";
import { NotificationsCard } from "./_components/NotificationsCard";
import { PaymentsCard } from "./_components/PaymentsCard";
import { ProfileCard } from "./_components/ProfileCard";
import { SecurityCard } from "./_components/SecurityCard";
import { emptyProfile, isStrongPassword } from "./_components/settings-state";
import type {
  ProfileState,
  TwoFaReauthAction,
  TwoFaReauthMethod,
  TwoFaStep
} from "./_components/types";

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

  function saveProfile(next: ProfileState) {
    return apiFetch<{ user: User }>("/users/me", {
      method: "PATCH",
      body: JSON.stringify({
        ...next,
        settings: {
          ...(me.data?.user.settings ?? {}),
          profileDescription: next.profileDescription.trim()
        }
      })
    });
  }

  function applySavedUser(response: { user: User }) {
    if (authUser) setUser({ ...authUser, ...response.user });
    queryClient.invalidateQueries({ queryKey: ["me-settings"] });
  }

  const updateProfile = useMutation({
    mutationFn: saveProfile,
    onSuccess: (response) => {
      setProfileMessage(t("settings.profile.saved"));
      applySavedUser(response);
    },
    onError: (err) => setProfileMessage(err instanceof Error ? err.message : t("settings.profile.saveFailed"))
  });

  const [pushMessage, setPushMessage] = useState("");
  // Same PATCH as updateProfile, but reports into the notifications card so the
  // push toggle there gives feedback in place.
  const updatePush = useMutation({
    mutationFn: saveProfile,
    onSuccess: (response) => {
      setPushMessage(t("settings.profile.saved"));
      applySavedUser(response);
    },
    onError: (err) => setPushMessage(err instanceof Error ? err.message : t("settings.profile.saveFailed"))
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

  const [twoFaStep, setTwoFaStep] = useState<TwoFaStep>("idle");
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [twoFaMessage, setTwoFaMessage] = useState("");
  const [twoFaReauthAction, setTwoFaReauthAction] = useState<TwoFaReauthAction | null>(null);
  const [twoFaReauthMethod, setTwoFaReauthMethod] = useState<TwoFaReauthMethod>("password");
  const [twoFaReauthValue, setTwoFaReauthValue] = useState("");

  type TwoFaReauthentication = {
    currentPassword?: string;
    totpCode?: string;
  };

  function clearTwoFaReauthentication() {
    setTwoFaReauthAction(null);
    setTwoFaReauthValue("");
  }

  function currentTwoFaReauthentication(): TwoFaReauthentication {
    return twoFaReauthMethod === "password"
      ? { currentPassword: twoFaReauthValue }
      : { totpCode: twoFaReauthValue.trim() };
  }

  const startTwoFactorSetup = useMutation({
    mutationFn: (reauthentication: TwoFaReauthentication) =>
      apiFetch<{ secret: string; otpauthUri: string }>("/users/me/2fa/setup", {
        method: "POST",
        body: JSON.stringify(reauthentication)
      }),
    onSuccess: (data) => {
      setTwoFaSetup(data);
      setTwoFaStep("setup");
      setTwoFaMessage("");
      clearTwoFaReauthentication();
    },
    onError: (err) => setTwoFaMessage(err instanceof Error ? err.message : t("settings.twofa.setupFailed"))
  });

  const confirmTwoFactorSetup = useMutation({
    mutationFn: () => apiFetch<{ backupCodes: string[] }>("/users/me/2fa/enable", { method: "POST", body: JSON.stringify({ code: twoFaCode.trim() }) }),
    onSuccess: ({ backupCodes: codes }) => {
      setBackupCodes(codes);
      setTwoFaStep("backupCodes");
      setTwoFaSetup(null);
      setTwoFaCode("");
      queryClient.invalidateQueries({ queryKey: ["me-settings"] });
    },
    onError: (err) => setTwoFaMessage(err instanceof Error ? err.message : t("settings.twofa.invalidCode"))
  });

  const disableTwoFactorMutation = useMutation({
    mutationFn: (reauthentication: TwoFaReauthentication) =>
      apiFetch("/users/me/2fa/disable", {
        method: "POST",
        body: JSON.stringify(reauthentication)
      }),
    onSuccess: () => {
      clearTwoFaReauthentication();
      setTwoFaStep("idle");
      setTwoFaSetup(null);
      setBackupCodes([]);
      queryClient.invalidateQueries({ queryKey: ["me-settings"] });
    },
    onError: (err) => setTwoFaMessage(err instanceof Error ? err.message : t("settings.twofa.disableFailed"))
  });

  const regenerateTwoFactorBackupCodes = useMutation({
    mutationFn: (reauthentication: TwoFaReauthentication) =>
      apiFetch<{ backupCodes: string[] }>("/users/me/2fa/backup-codes/regenerate", {
        method: "POST",
        body: JSON.stringify(reauthentication)
      }),
    onSuccess: ({ backupCodes: codes }) => {
      setBackupCodes(codes);
      setTwoFaStep("backupCodes");
      setTwoFaMessage("");
      clearTwoFaReauthentication();
    },
    onError: (err) => setTwoFaMessage(err instanceof Error ? err.message : t("settings.twofa.regenerateFailed"))
  });

  function submitTwoFaSecurityAction() {
    const reauthentication = currentTwoFaReauthentication();
    if (twoFaReauthAction === "replace") {
      startTwoFactorSetup.mutate(reauthentication);
    } else if (twoFaReauthAction === "regenerate") {
      regenerateTwoFactorBackupCodes.mutate(reauthentication);
    } else if (twoFaReauthAction === "disable") {
      disableTwoFactorMutation.mutate(reauthentication);
    }
  }

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

  function togglePush(checked: boolean) {
    const next = { ...profile, pushEnabled: checked };
    setProfile(next);
    setPushMessage("");
    updatePush.mutate(next);
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
      <header>
        <h1 className="text-3xl font-black text-ink">{t("settings.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("settings.subtitle")}</p>
      </header>

      <ProfileCard
        profile={profile}
        setProfile={setProfile}
        avatarSrc={avatarSrc}
        initial={initial}
        role={authUser?.role ?? "-"}
        emailVerified={Boolean(me.data?.user.emailVerified)}
        phone={me.data?.user.phone ?? ""}
        phoneVerified={Boolean(me.data?.user.phoneVerified)}
        profileMessage={profileMessage}
        verifyMessage={verifyMessage}
        uploadPending={uploadAvatar.isPending}
        updatePending={updateProfile.isPending}
        resendPending={resendVerification.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          updateProfile.mutate(profile);
        }}
        onPickAvatar={pickAvatar}
        onClearAvatar={clearAvatar}
        onResendVerification={() => resendVerification.mutate()}
        t={t}
      />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <SecurityCard
            password={{
              isPending: changePassword.isPending,
              message: passwordMessage,
              onSubmit: submitPassword
            }}
            twoFactor={{
              enabled: Boolean(me.data?.user.twoFactorEnabled),
              step: twoFaStep,
              setup: twoFaSetup,
              code: twoFaCode,
              backupCodes,
              message: twoFaMessage,
              reauthAction: twoFaReauthAction,
              reauthMethod: twoFaReauthMethod,
              reauthValue: twoFaReauthValue,
              startPending: startTwoFactorSetup.isPending,
              confirmPending: confirmTwoFactorSetup.isPending,
              disablePending: disableTwoFactorMutation.isPending,
              regeneratePending: regenerateTwoFactorBackupCodes.isPending,
              setStep: setTwoFaStep,
              setCode: setTwoFaCode,
              setReauthAction: setTwoFaReauthAction,
              setReauthMethod: setTwoFaReauthMethod,
              setReauthValue: setTwoFaReauthValue,
              onCancelReauthentication: clearTwoFaReauthentication,
              onStart: () => startTwoFactorSetup.mutate({}),
              onConfirm: () => confirmTwoFactorSetup.mutate(),
              onSubmitReauthentication: submitTwoFaSecurityAction
            }}
            t={t}
          />
          <NotificationsCard
            emailEnabled={preferences.data?.preferences.emailEnabled ?? true}
            telegramEnabled={preferences.data?.preferences.telegramEnabled ?? true}
            telegramConnected={Boolean(me.data?.user.telegramConnected)}
            pushEnabled={profile.pushEnabled}
            connectPending={connectTelegram.isPending}
            pushPending={updatePush.isPending}
            message={telegramMessage || pushMessage}
            onEmailChange={(checked) => updatePreferences.mutate({ emailEnabled: checked })}
            onTelegramChange={(checked) => updatePreferences.mutate({ telegramEnabled: checked })}
            onPushChange={togglePush}
            onConnectTelegram={() => connectTelegram.mutate()}
            onDisconnectTelegram={() => disconnectTelegram.mutate()}
            t={t}
          />
        </div>
        <div className="space-y-6">
          <PaymentsCard cards={[]} wallets={[]} t={t} />
          <LanguageCard locale={locale} switchLocale={switchLocale} t={t} />
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
        </div>
      </div>
    </div>
  );
}
