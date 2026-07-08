import { Check, Sparkles } from "lucide-react";

export function SalesTips({ completion }: { completion: number }) {
  const tips = [
    "Подробное описание с преимуществами",
    "Качественные скриншоты товара",
    "Укажите все важные характеристики",
    "Конкурентная цена и акции"
  ];
  return (
    <section className="rounded-lg border border-action/35 bg-card/85 p-5 shadow-soft">
      <h2 className="flex items-center gap-2 font-extrabold text-ink">
        <Sparkles className="h-5 w-5 text-action" />
        Что повышает продажи
      </h2>
      <div className="mt-4 space-y-3">
        {tips.map((tip) => (
          <p key={tip} className="flex items-center gap-3 text-sm text-ink">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-action text-stone-950">
              <Check className="h-3.5 w-3.5" />
            </span>
            {tip}
          </p>
        ))}
      </div>
      <div className="mt-5 rounded-lg border border-action/25 bg-panel/40 p-4">
        <p className="flex gap-3 text-sm text-muted">
          <Sparkles className="h-5 w-5 shrink-0 text-action" />
          Лоты с полным заполнением продаются на 30-50% быстрее!
        </p>
        <p className="mt-4 text-sm font-bold text-ink">Заполнено: {completion}%</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-action transition-all" style={{ width: `${completion}%` }} />
        </div>
      </div>
    </section>
  );
}
