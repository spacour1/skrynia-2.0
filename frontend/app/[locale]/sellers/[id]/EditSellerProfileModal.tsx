"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { apiFetch, type User } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { uploadImage } from "@/lib/storage";

export function EditSellerProfileModal({
  user,
  onClose,
  onSaved
}: {
  user: {
    displayName: string;
    avatarUrl?: string | null;
    settings?: Record<string, unknown>;
  };
  onClose: () => void;
  onSaved: (user: User) => void;
}) {
  const { t } = useI18n();
  const settings = user.settings ?? {};
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [avatarUploadId, setAvatarUploadId] = useState("");
  const [tagline, setTagline] = useState(readString(settings.sellerTagline) || readString(settings.headline));
  const [description, setDescription] = useState(readString(settings.profileDescription) || readString(settings.sellerDescription));
  const [specialty, setSpecialty] = useState(readString(settings.specialty));
  const [responseTime, setResponseTime] = useState(readString(settings.responseTime));
  const [formError, setFormError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      return uploadImage(file, "avatar");
    },
    onSuccess: (upload) => {
      setAvatarUrl(upload.url);
      setAvatarUploadId(upload.id);
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : t("seller.profileSaveFailed"))
  });

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ user: User }>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim(),
          ...(avatarUploadId
            ? { avatarUploadId }
            : !avatarUrl
              ? { clearAvatar: true }
              : {}),
          settings: {
            ...settings,
            sellerTagline: tagline.trim(),
            profileDescription: description.trim(),
            specialty: specialty.trim(),
            responseTime: responseTime.trim()
          }
        })
      }),
    onSuccess: ({ user: updated }) => onSaved(updated),
    onError: (err) => setFormError(err instanceof Error ? err.message : t("seller.profileSaveFailed"))
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80 || tagline.length > 120 || description.length > 600) {
      setFormError(t("seller.profileSaveFailed"));
      return;
    }
    save.mutate();
  }

  function pickAvatar(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 8 * 1024 * 1024) return;
    uploadAvatar.mutate(file);
  }

  const pending = save.isPending || uploadAvatar.isPending;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <form
        className="app-card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-ink">{t("seller.editProfile")}</h2>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-panel hover:text-ink" onClick={onClose} aria-label={t("seller.cancel")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-panel text-xl font-black text-brand">
            {avatarUrl ? <img className="h-full w-full object-cover" src={avatarUrl} alt={displayName} /> : displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              aria-label={t("seller.avatar")}
              onChange={(event) => pickAvatar(event.target.files?.[0])}
            />
            <button type="button" className="app-button-secondary h-9 px-3 text-xs" disabled={uploadAvatar.isPending} onClick={() => fileInputRef.current?.click()}>
              {uploadAvatar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("seller.uploadImage")}
            </button>
          </div>
        </div>

        <label className="mt-4 block text-sm font-bold text-muted">{t("settings.profile.nameLabel")}</label>
        <input className="app-input mt-2 h-11 w-full" value={displayName} minLength={2} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} required />

        <label className="mt-4 block text-sm font-bold text-muted">{t("seller.sellerTagline")}</label>
        <input className="app-input mt-2 h-11 w-full" value={tagline} maxLength={120} onChange={(event) => setTagline(event.target.value)} />

        <label className="mt-4 block text-sm font-bold text-muted">{t("seller.description")}</label>
        <textarea className="app-input mt-2 min-h-24 w-full resize-none py-2" value={description} maxLength={600} onChange={(event) => setDescription(event.target.value)} />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-bold text-muted">{t("seller.specialty")}</label>
            <input className="app-input mt-2 h-11 w-full" value={specialty} onChange={(event) => setSpecialty(event.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-bold text-muted">{t("seller.responseTime")}</label>
            <input className="app-input mt-2 h-11 w-full" value={responseTime} onChange={(event) => setResponseTime(event.target.value)} />
          </div>
        </div>

        {formError ? <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-300">{formError}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="app-button-secondary h-10 px-4" onClick={onClose}>
            {t("seller.cancel")}
          </button>
          <button type="submit" className="app-button h-10 px-4" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("seller.saveChanges")}
          </button>
        </div>
      </form>
    </div>
  );
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
