"use client";

import type { ReactNode } from "react";
import { Camera, type LucideIcon } from "lucide-react";

export function AvatarView({ src, initial }: { src?: string; initial: string }) {
  return (
    <span className="relative grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-brand/10 text-4xl font-black text-brand shadow-soft">
      {src ? <img className="h-full w-full object-cover" src={src} alt="" /> : initial}
      <span className="absolute bottom-1 right-1 grid h-8 w-8 place-items-center rounded-full bg-card text-brand shadow-soft">
        <Camera className="h-4 w-4" />
      </span>
    </span>
  );
}

export function SectionHeader({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-panel/50 p-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-lg font-black text-ink">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">{text}</p>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 text-sm font-bold text-ink">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`focus-ring relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? "bg-brand" : "bg-line"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow-soft transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

export function StatusPill({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return ok ? (
    <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
      {okText}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-bold text-rose-700 dark:text-rose-300">
      {badText}
    </span>
  );
}

export function StatusMessage({ message }: { message: string }) {
  if (!message) return null;
  return <p className="text-sm font-semibold text-muted">{message}</p>;
}
