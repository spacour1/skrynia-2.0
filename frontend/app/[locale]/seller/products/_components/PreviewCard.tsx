import { ChevronRight, Clock, Eye, Lock, Star, type LucideIcon } from "lucide-react";
import { money } from "@/lib/api";
import { deliveryTimes } from "./constants";
import type { LotForm } from "./types";

export function PreviewCard({
  form,
  imageUrl,
  gameName,
  sectionName,
  categoryName,
  sellerName
}: {
  form: LotForm;
  imageUrl?: string;
  gameName?: string;
  sectionName?: string;
  categoryName?: string;
  sellerName: string;
}) {
  const price = Number(form.price || 0);
  const oldPrice = Number(form.oldPrice || 0);
  const discount = oldPrice > price && price > 0 ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0;
  const title = form.title || "Название вашего лота";
  const subtitle = form.shortDescription || [gameName, sectionName, categoryName].filter(Boolean).join(" • ") || "Краткое преимущество появится здесь";

  return (
    <section className="rounded-lg border border-line bg-card/85 p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-action/10 text-action">
          <Eye className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-extrabold text-ink">Предпросмотр лота</h2>
          <p className="mt-1 text-sm text-muted">Так ваш лот увидят покупатели</p>
        </div>
      </div>

      <article className="mt-5 rounded-lg border border-line bg-surface/80 p-4">
        <div className="grid gap-4 sm:grid-cols-[180px_1fr] xl:grid-cols-[150px_1fr]">
          <div className="relative min-h-[180px] overflow-hidden rounded-lg bg-[radial-gradient(circle_at_35%_20%,rgba(251,191,36,.55),transparent_28%),linear-gradient(140deg,#1f2937,#3b1f11_45%,#111827)]">
            {imageUrl ? <img className="absolute inset-0 h-full w-full object-cover" src={imageUrl} alt={title} /> : null}
            <button className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg bg-black/40 text-white backdrop-blur" type="button">
              <Star className="h-5 w-5" />
            </button>
            {!imageUrl ? <span className="absolute bottom-4 left-4 text-5xl font-black text-white/20">{title.slice(0, 2).toUpperCase()}</span> : null}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded bg-violet-500/30 px-2 py-1 text-xs font-bold text-violet-100">{form.platform || "Платформа"}</span>
              <span className="rounded bg-blue-500/30 px-2 py-1 text-xs font-bold text-blue-100">{form.region || "Регион"}</span>
            </div>
            <h3 className="mt-3 text-xl font-black leading-7 text-ink">{title}</h3>
            <p className="mt-3 line-clamp-2 text-sm text-muted">{subtitle}</p>
            <div className="mt-4">
              <p className="text-2xl font-black text-ink">{money(Math.round(price * 100), form.currency)}</p>
              {oldPrice > 0 ? (
                <p className="mt-1 text-sm text-muted">
                  <span className="line-through">{money(Math.round(oldPrice * 100), form.currency)}</span>
                  {discount ? <span className="ml-2 rounded bg-rose-500/20 px-2 py-1 text-xs font-bold text-rose-300">-{discount}%</span> : null}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Badge icon={Clock} text={form.deliveryType === "instant" || form.autoDelivery ? "Мгновенная доставка" : deliveryTimes[form.deliveryTime]} />
          <Badge icon={Lock} text={`${form.stock || 0} шт. в наличии`} />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-panel font-black text-action">{sellerName.slice(0, 1).toUpperCase()}</span>
            <span className="truncate font-extrabold text-ink">{sellerName}</span>
            <span className="rounded bg-action px-2 py-0.5 text-[10px] font-black text-stone-950">PRO</span>
            <span className="flex items-center gap-1 text-sm text-muted">
              <Star className="h-4 w-4 fill-action text-action" /> 4.9
            </span>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
        </div>
      </article>
    </section>
  );
}

function Badge({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="flex items-center gap-2 rounded-lg bg-panel/60 px-3 py-2 text-sm text-muted">
      <Icon className="h-4 w-4" />
      {text}
    </span>
  );
}
