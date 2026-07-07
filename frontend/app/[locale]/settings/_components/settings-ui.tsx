"use client";

import type { ReactNode } from "react";
import { Camera, type LucideIcon } from "lucide-react";

export function AvatarView({ src, initial, size = "normal" }: { src?: string; initial: string; size?: "normal" | "large" }) {
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

export function SectionHeader({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 text-sm font-bold text-ink">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Toggle({
  icon: Icon,
  title,
  text,
  checked,
  onChange
}: {
  icon: LucideIcon;
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

export function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-card/70 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate font-black text-ink">{value}</p>
    </div>
  );
}

export function StatusMessage({ message }: { message: string }) {
  if (!message) return null;
  return <p className="text-sm font-semibold text-muted">{message}</p>;
}
