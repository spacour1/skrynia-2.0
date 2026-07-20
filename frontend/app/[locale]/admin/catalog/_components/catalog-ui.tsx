"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { catalogApi, type CatalogStatus } from "@/lib/catalog-api";
import { STATUS_COLORS } from "./types";

export function StatusPill({ status }: { status: CatalogStatus }) {
  const { t } = useI18n();
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_COLORS[status]}`}>{t(`adminCatalog.status.${status}`)}</span>;
}

export function FormError({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  return <p className="rounded-lg bg-rose-500/10 p-3 text-sm font-bold text-rose-400">{error instanceof ApiError ? error.message : t("adminCatalog.genericError")}</p>;
}

export function StatusActions({ status, onSetStatus }: { status: CatalogStatus; onSetStatus: (status: CatalogStatus) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("active")}>
          {t("adminCatalog.publish")}
        </button>
      ) : null}
      {status !== "hidden" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("hidden")}>
          {t("adminCatalog.hide")}
        </button>
      ) : null}
      {status !== "archived" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("archived")}>
          {t("adminCatalog.archive")}
        </button>
      ) : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-start justify-between gap-3 rounded-lg border border-line bg-panel/40 p-3 text-left transition hover:border-brand/50"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-4 text-muted">{hint}</span>
      </span>
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? "justify-end bg-brand" : "justify-start bg-line"}`}>
        <span className="h-4 w-4 rounded-full bg-surface" />
      </span>
    </button>
  );
}

/**
 * Single admin image slot: drag-and-drop or click to pick, uploads through the shared
 * owned storage flow (JPEG/PNG/WEBP, decoded and re-encoded server-side), then attaches
 * the catalog asset before exposing its hosted URL to the form.
 */
export function ImageSlot({
  label,
  hint,
  value,
  onChange,
  wide
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (url: string) => void;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(t("adminCatalog.images.badType"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(t("adminCatalog.images.tooLarge"));
      return;
    }
    setUploading(true);
    try {
      const { url } = await catalogApi.uploadImage(file);
      onChange(url);
    } catch (uploadError) {
      setError(uploadError instanceof ApiError ? uploadError.message : t("adminCatalog.genericError"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-w-0">
      <p className="text-xs font-black uppercase text-muted">{label}</p>
      <div
        className={`mt-1 grid ${wide ? "aspect-[3/1]" : "aspect-square"} cursor-pointer place-items-center overflow-hidden rounded-lg border border-dashed transition ${
          dragOver ? "border-brand bg-brand/10" : "border-line bg-panel/40 hover:border-brand/50"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          upload(event.dataTransfer.files?.[0]);
        }}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        ) : value ? (
          <img className="h-full w-full object-cover" src={value} alt="" />
        ) : (
          <span className="grid place-items-center gap-1 p-2 text-center text-muted">
            <ImagePlus className="mx-auto h-5 w-5" />
            <span className="text-[10px] font-bold leading-3">{t("adminCatalog.images.drop")}</span>
          </span>
        )}
      </div>
      <div className="mt-1 flex items-start justify-between gap-2">
        <p className="text-[10px] leading-4 text-muted">{hint}</p>
        {value ? (
          <button type="button" className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-rose-400 hover:underline" onClick={() => onChange("")}>
            <X className="h-3 w-3" />
            {t("adminCatalog.images.remove")}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-[11px] font-bold text-rose-400">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
