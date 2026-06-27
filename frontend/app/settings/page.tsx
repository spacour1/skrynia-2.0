"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Camera,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  MailCheck,
  MailWarning,
  Moon,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { apiFetch, type User } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";
import { RequireAuth } from "../../components/RequireAuth";
import { useTheme } from "../../lib/theme-store";

type ProfileState = {
  displayName: string;
  email: string;
  avatarUrl: string;
  profileDescription: string;
  pushEnabled: boolean;
  twoFactorEnabled: boolean;
};

const emptyProfile: ProfileState = {
  displayName: "",
  email: "",
  avatarUrl: "",
  profileDescription: "",
  pushEnabled: false,
  twoFactorEnabled: false
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
      pushEnabled: Boolean(me.data.user.pushEnabled),
      twoFactorEnabled: Boolean(me.data.user.twoFactorEnabled)
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
      setProfileMessage("Аватар загружен. Нажмите сохранение, чтобы применить его к профилю.");
    },
    onError: (err) => setProfileMessage(err instanceof Error ? err.message : "Не удалось загрузить аватар")
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
      setProfileMessage("Настройки профиля сохранены");
      if (authUser) setUser({ ...authUser, ...response.user });
      queryClient.invalidateQueries({ queryKey: ["me-settings"] });
    },
    onError: (err) => setProfileMessage(err instanceof Error ? err.message : "Не удалось сохранить настройки")
  });

  const changePassword = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch("/users/me/password", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => setPasswordMessage("Пароль обновлен"),
    onError: (err) => setPasswordMessage(err instanceof Error ? err.message : "Не удалось сменить пароль")
  });

  const [verifyMessage, setVerifyMessage] = useState("");
  const resendVerification = useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/auth/verify-email/request", { method: "POST" }),
    onSuccess: (response) =>
      setVerifyMessage(
        response.status === "already_verified" ? "Email уже подтвержден" : "Письмо отправлено — проверьте почту (и папку спам)"
      ),
    onError: (err) => setVerifyMessage(err instanceof Error ? err.message : "Не удалось отправить письмо")
  });

  function pickAvatar(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileMessage("Выберите изображение PNG, JPG или WEBP");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProfileMessage("Файл слишком большой. Максимум 8 МБ.");
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
      setPasswordMessage("Новые пароли не совпадают");
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
                Настройки аккаунта
              </p>
              <h1 className="mt-3 text-3xl font-black text-ink">{profile.displayName || "Профиль"}</h1>
              <p className="mt-2 text-sm leading-6 text-muted">Профиль, аватар, уведомления, безопасность и вход в аккаунт.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Summary label="Email" value={profile.email || "-"} />
            <Summary label="Роль" value={authUser?.role ?? "-"} />
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
          <SectionHeader icon={UserRound} title="Профиль" text="Данные, которые видят покупатели и продавцы на платформе." />
          <div className="space-y-6 p-5">
            <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
              <div className="rounded-lg border border-line bg-panel/35 p-4">
                <AvatarView src={avatarSrc} initial={initial} />
                <div className="mt-4 grid gap-2">
                  <label className="app-button-secondary cursor-pointer">
                    {uploadAvatar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Загрузить аватар
                    <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => pickAvatar(event.target.files?.[0])} />
                  </label>
                  <button
                    className="app-button-danger"
                    type="button"
                    onClick={() => {
                      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                      setAvatarPreview("");
                      setProfile((current) => ({ ...current, avatarUrl: "" }));
                      setProfileMessage("Аватар будет удален после сохранения профиля.");
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">PNG, JPG или WEBP до 8 МБ. После загрузки нажмите “Сохранить профиль”.</p>
              </div>

              <div className="grid content-start gap-4">
                <Field label="Имя на площадке">
                  <input className="app-input w-full" value={profile.displayName} minLength={2} maxLength={80} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} required />
                </Field>
                <Field label="Email">
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input className="app-input w-full pl-9" type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} required />
                  </div>
                </Field>
                <Field label="Описание публичного профиля">
                  <textarea
                    className="app-input min-h-[120px] w-full resize-y leading-6"
                    value={profile.profileDescription}
                    maxLength={600}
                    onChange={(event) => setProfile({ ...profile, profileDescription: event.target.value })}
                    placeholder="Расскажите покупателям о себе, опыте, правилах выдачи и категориях товаров."
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Toggle
                    icon={Bell}
                    title="Push уведомления"
                    text="Заказы, сообщения и важные события."
                    checked={profile.pushEnabled}
                    onChange={(checked) => setProfile({ ...profile, pushEnabled: checked })}
                  />
                  <Toggle
                    icon={ShieldCheck}
                    title="Двухфакторная защита"
                    text="MVP-переключатель под будущий OTP/Telegram."
                    checked={profile.twoFactorEnabled}
                    onChange={(checked) => setProfile({ ...profile, twoFactorEnabled: checked })}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <StatusMessage message={profileMessage} />
              <button className="app-button h-11 px-5" disabled={updateProfile.isPending || uploadAvatar.isPending}>
                {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить профиль
              </button>
            </div>
          </div>
        </form>

        <aside className="space-y-6">
          <section className="app-card overflow-hidden">
            <SectionHeader icon={Sun} title="Тема интерфейса" text="Выберите тему. Страница перезагрузится и откроется уже в новом оформлении." />
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <button
                className={`rounded-lg border p-4 text-left transition hover:border-brand/70 ${theme === "light" ? "border-brand/70 bg-brand/10" : "border-line bg-panel/35"}`}
                type="button"
                onClick={() => setThemeAndReload("light")}
              >
                <Sun className="h-5 w-5 text-brand" />
                <span className="mt-3 block font-black text-ink">Светлая тема</span>
              </button>
              <button
                className={`rounded-lg border p-4 text-left transition hover:border-brand/70 ${theme === "dark" ? "border-brand/70 bg-brand/10" : "border-line bg-panel/35"}`}
                type="button"
                onClick={() => setThemeAndReload("dark")}
              >
                <Moon className="h-5 w-5 text-brand" />
                <span className="mt-3 block font-black text-ink">Темная тема</span>
              </button>
            </div>
          </section>

          <form className="app-card overflow-hidden" onSubmit={submitPassword}>
            <SectionHeader icon={KeyRound} title="Пароль" text="Минимум 8 символов. После смены используйте новый пароль при входе." />
            <div className="space-y-4 p-5">
              <input className="app-input w-full" name="currentPassword" type="password" placeholder="Текущий пароль" required />
              <input className="app-input w-full" name="newPassword" type="password" placeholder="Новый пароль" minLength={8} required />
              <input className="app-input w-full" name="repeatPassword" type="password" placeholder="Повторите новый пароль" minLength={8} required />
              <StatusMessage message={passwordMessage} />
              <button className="app-button-secondary w-full" disabled={changePassword.isPending}>
                {changePassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Сменить пароль
              </button>
            </div>
          </form>

          <section className="app-card overflow-hidden">
            <SectionHeader icon={Mail} title="Подтверждение email" text="Защитите аккаунт и разблокируйте уведомления о заказах на почту." />
            <div className="space-y-4 p-5">
              {me.data?.user.emailVerified ? (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
                  <MailCheck className="h-5 w-5 shrink-0" />
                  <span className="font-bold">Email подтвержден</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 rounded-lg border border-amber-400/40 bg-amber-100 p-4 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
                    <MailWarning className="h-5 w-5 shrink-0" />
                    <span className="font-bold">Email не подтвержден</span>
                  </div>
                  <p className="text-sm leading-6 text-muted">
                    Мы отправили письмо со ссылкой на <strong>{profile.email}</strong> при регистрации. Если оно не пришло — отправьте
                    повторно.
                  </p>
                  <button
                    className="app-button-secondary w-full"
                    type="button"
                    disabled={resendVerification.isPending}
                    onClick={() => resendVerification.mutate()}
                  >
                    {resendVerification.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    Отправить письмо повторно
                  </button>
                </>
              )}
              <StatusMessage message={verifyMessage} />
            </div>
          </section>

          <section className="app-card p-5">
            <h2 className="flex items-center gap-2 font-black text-ink">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              Что уже работает
            </h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-muted">
              <p>Аватар загружается файлом на backend и сохраняется в профиле.</p>
              <p>Имя, email и переключатели обновляются в базе данных.</p>
              <p>После сохранения сессия обновляется, поэтому аватар появляется в навигации без перелогина.</p>
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
      {src ? <img className="h-full w-full object-cover" src={src} alt="Аватар" /> : initial}
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
