"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { apiFetch, type User } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function EditSellerBannerModal({
  currentBannerUrl,
  settings,
  onClose,
  onSaved
}: {
  currentBannerUrl?: string;
  settings?: Record<string, unknown>;
  onClose: () => void;
  onSaved: (user: User) => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pickFile(picked?: File) {
    if (!picked) return;
    if (!picked.type.startsWith("image/")) return;
    if (picked.size > 8 * 1024 * 1024) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  }

  const save = useMutation({
    mutationFn: async (bannerUrl: string) =>
      apiFetch<{ user: User }>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ settings: { ...(settings ?? {}), sellerBannerUrl: bannerUrl } })
      }),
    onSuccess: ({ user: updated }) => onSaved(updated),
    onError: (err) => setFormError(err instanceof Error ? err.message : t("seller.bannerSaveFailed"))
  });

  const upload = useMutation({
    mutationFn: async (picked: File) => {
      const body = new FormData();
      body.append("file", picked);
      return apiFetch<{ url: string }>("/storage/upload", { method: "POST", body });
    },
    onSuccess: ({ url }) => save.mutate(url),
    onError: (err) => setFormError(err instanceof Error ? err.message : t("seller.bannerSaveFailed"))
  });

  function submitSave() {
    setFormError("");
    if (!file) return;
    upload.mutate(file);
  }

  function removeBanner() {
    setFormError("");
    save.mutate("");
  }

  const pending = save.isPending || upload.isPending;
  const previewSrc = preview ?? currentBannerUrl;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="app-card w-full max-w-lg p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-ink">{t("seller.editBanner")}</h2>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-panel hover:text-ink" onClick={onClose} aria-label={t("seller.cancel")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="mt-4 grid h-40 w-full place-items-center overflow-hidden rounded-xl border border-line bg-panel/60 bg-cover bg-center"
          style={previewSrc ? { backgroundImage: `url(${previewSrc})` } : undefined}
        >
          {!previewSrc ? <span className="text-sm font-bold text-muted">{t("seller.banner")}</span> : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          aria-label={t("seller.uploadImage")}
          onChange={(event) => pickFile(event.target.files?.[0])}
        />
        <button type="button" className="app-button-secondary mt-3 h-10 px-4 text-sm" onClick={() => fileInputRef.current?.click()}>
          {t("seller.uploadImage")}
        </button>

        {formError ? <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-300">{formError}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {currentBannerUrl ? (
            <button type="button" className="app-button-secondary h-10 px-4" disabled={pending} onClick={removeBanner}>
              {t("seller.removeBanner")}
            </button>
          ) : null}
          <button type="button" className="app-button-secondary h-10 px-4" onClick={onClose}>
            {t("seller.cancel")}
          </button>
          <button type="button" className="app-button h-10 px-4" disabled={pending || !file} onClick={submitSave}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("seller.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
