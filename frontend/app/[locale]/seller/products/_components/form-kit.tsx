import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Info } from "lucide-react";
import { formSteps } from "./constants";

export function FormSection({ step, children }: { step: number; children: ReactNode }) {
  const item = formSteps[step - 1];
  const Icon = item.icon;
  return (
    <section className="grid overflow-hidden rounded-lg border border-line bg-card/80 shadow-soft backdrop-blur md:grid-cols-[280px_1fr]">
      <div className="flex gap-4 border-b border-line bg-panel/30 p-5 md:border-b-0 md:border-r">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-action text-sm font-black text-stone-950 shadow-soft">{step}</span>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-card text-muted">
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <h2 className="font-extrabold text-ink">{item.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{item.text}</p>
        </div>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-3">{children}</div>
    </section>
  );
}

export function FieldBlock({ label, required, className = "", children }: { label: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <label className={`relative block space-y-1.5 ${className}`}>
      <span className="text-xs font-bold text-ink">
        {label} {required ? <span className="text-rose-400">*</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`app-input h-10 w-full bg-surface/80 pr-12 text-sm ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`app-input min-h-10 w-full resize-none bg-surface/80 pr-16 text-sm ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`app-input h-10 w-full bg-surface/80 text-sm ${props.className ?? ""}`} />;
}

export function Counter({ children }: { children: ReactNode }) {
  return <span className="absolute bottom-2 right-3 text-xs text-muted">{children}</span>;
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
      <Info className="h-3.5 w-3.5 text-action" />
      {children}
    </span>
  );
}

export function Toggle({ name, title, text, checked, onChange, badge }: { name: string; title: string; text: string; checked: boolean; onChange: (checked: boolean) => void; badge?: string }) {
  return (
    <label className="flex items-start gap-3 rounded-lg p-1">
      <input className="peer sr-only" name={name} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="mt-1 flex h-6 w-11 shrink-0 items-center rounded-full border border-line bg-muted/30 p-0.5 transition peer-checked:border-action/80 peer-checked:bg-action">
        <span className={`h-5 w-5 rounded-full bg-card shadow-soft transition ${checked ? "translate-x-5" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-extrabold text-ink">
          {title}
          {badge ? <span className="rounded-md bg-action px-2 py-0.5 text-[10px] font-black text-stone-950">{badge}</span> : null}
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted">{text}</span>
      </span>
    </label>
  );
}
