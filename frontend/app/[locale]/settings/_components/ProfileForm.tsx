"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Bell, Loader2, Mail, Save, Trash2, Upload, UserRound } from "lucide-react";
import { AvatarView, Field, SectionHeader, StatusMessage, Toggle } from "./settings-ui";
import type { ProfileState, SettingsT } from "./types";

export function ProfileForm({
  profile,
  setProfile,
  avatarSrc,
  initial,
  profileMessage,
  uploadPending,
  updatePending,
  onSubmit,
  onPickAvatar,
  onClearAvatar,
  t
}: {
  profile: ProfileState;
  setProfile: Dispatch<SetStateAction<ProfileState>>;
  avatarSrc: string;
  initial: string;
  profileMessage: string;
  uploadPending: boolean;
  updatePending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPickAvatar: (file?: File) => void;
  onClearAvatar: () => void;
  t: SettingsT;
}) {
  return (
    <form className="app-card overflow-hidden" onSubmit={onSubmit}>
      <SectionHeader icon={UserRound} title={t("settings.profile.title")} text={t("settings.profile.text")} />
      <div className="space-y-6 p-5">
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <div className="rounded-lg border border-line bg-panel/35 p-4">
            <AvatarView src={avatarSrc} initial={initial} />
            <div className="mt-4 grid gap-2">
              <label className="app-button-secondary cursor-pointer">
                {uploadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t("settings.avatar.upload")}
                <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onPickAvatar(event.target.files?.[0])} />
              </label>
              <button className="app-button-danger" type="button" onClick={onClearAvatar}>
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
          <button className="app-button h-11 px-5" disabled={updatePending || uploadPending}>
            {updatePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("settings.profile.save")}
          </button>
        </div>
      </div>
    </form>
  );
}
