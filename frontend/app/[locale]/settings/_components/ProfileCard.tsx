"use client";

import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { Loader2, Mail, Phone, Save, Trash2, Upload } from "lucide-react";
import { AvatarView, Field, StatusMessage, StatusPill, Switch } from "./settings-ui";
import type { ProfileState, SettingsT } from "./types";

function ContactRow({
  icon: Icon,
  value,
  verified,
  action,
  t
}: {
  icon: typeof Mail;
  value: string;
  verified: boolean;
  action?: ReactNode;
  t: SettingsT;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel/35 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{value}</p>
        <div className="mt-1.5">
          <StatusPill ok={verified} okText={t("settings.status.verified")} badText={t("settings.status.notVerified")} />
        </div>
      </div>
      {action}
    </div>
  );
}

export function ProfileCard({
  profile,
  setProfile,
  avatarSrc,
  initial,
  role,
  emailVerified,
  phone,
  phoneVerified,
  profileMessage,
  verifyMessage,
  uploadPending,
  updatePending,
  resendPending,
  onSubmit,
  onPickAvatar,
  onClearAvatar,
  onResendVerification,
  t
}: {
  profile: ProfileState;
  setProfile: Dispatch<SetStateAction<ProfileState>>;
  avatarSrc: string;
  initial: string;
  role: string;
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;
  profileMessage: string;
  verifyMessage: string;
  uploadPending: boolean;
  updatePending: boolean;
  resendPending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPickAvatar: (file?: File) => void;
  onClearAvatar: () => void;
  onResendVerification: () => void;
  t: SettingsT;
}) {
  return (
    <section className="app-card overflow-hidden">
      <form onSubmit={onSubmit}>
        <div className="grid gap-6 p-6 lg:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            <AvatarView src={avatarSrc} initial={initial} />
            <label className="app-button-secondary h-10 cursor-pointer px-4 text-sm">
              {uploadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t("settings.avatar.change")}
              <input
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => onPickAvatar(event.target.files?.[0])}
              />
            </label>
            <button
              className="focus-ring inline-flex items-center gap-1.5 text-xs font-bold text-muted transition hover:text-rose-400"
              type="button"
              onClick={onClearAvatar}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("settings.avatar.delete")}
            </button>
          </div>

          <div className="min-w-0">
            <h1 className="text-3xl font-black text-ink">{profile.displayName || t("settings.profile.title")}</h1>
            <p className="mt-1 text-sm text-muted">{role}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <ContactRow
                icon={Mail}
                value={profile.email || "—"}
                verified={emailVerified}
                action={
                  emailVerified ? undefined : (
                    <button className="app-button-secondary h-10 px-4 text-sm" type="button" disabled={resendPending} onClick={onResendVerification}>
                      {resendPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      {t("settings.emailVerify.resend")}
                    </button>
                  )
                }
                t={t}
              />
              <ContactRow
                icon={Phone}
                value={phone || "—"}
                verified={phoneVerified}
                action={
                  phoneVerified ? undefined : (
                    <a className="app-button-secondary h-10 px-4 text-sm" href="#phone-verification">
                      {t("settings.phone.verifyAction")}
                    </a>
                  )
                }
                t={t}
              />
            </div>
            <StatusMessage message={verifyMessage} />
          </div>
        </div>

        <div className="space-y-4 border-t border-line p-6">
          <div>
            <h2 className="text-lg font-black text-ink">{t("settings.profile.editTitle")}</h2>
            <p className="mt-0.5 text-sm text-muted">{t("settings.profile.editText")}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("settings.profile.nameLabel")}>
              <input
                className="app-input w-full"
                value={profile.displayName}
                minLength={2}
                maxLength={80}
                onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}
                required
              />
            </Field>
            <Field label={t("auth.email")}>
              <input
                className="app-input w-full"
                type="email"
                value={profile.email}
                onChange={(event) => setProfile({ ...profile, email: event.target.value })}
                required
              />
            </Field>
          </div>
          <Field label={t("settings.profile.bio")}>
            <textarea
              className="app-input min-h-[110px] w-full resize-y font-normal leading-6"
              value={profile.profileDescription}
              maxLength={600}
              onChange={(event) => setProfile({ ...profile, profileDescription: event.target.value })}
              placeholder={t("settings.profile.bioPlaceholder")}
            />
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel/35 p-4">
            <div>
              <p className="text-sm font-black text-ink">{t("settings.push.title")}</p>
              <p className="mt-0.5 text-sm text-muted">{t("settings.push.text")}</p>
            </div>
            <Switch
              checked={profile.pushEnabled}
              onChange={(checked) => setProfile({ ...profile, pushEnabled: checked })}
              label={t("settings.push.title")}
            />
          </div>
          <p className="text-xs leading-5 text-muted">{t("settings.avatar.hint")}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <StatusMessage message={profileMessage} />
            <button className="app-button h-11 px-5" disabled={updatePending || uploadPending}>
              {updatePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("settings.profile.save")}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
