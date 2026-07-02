"use client";

import Link from "@/lib/navigation";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

const rules = [
  "Все оплаты проходят через внутренний escrow, продавец получает деньги только после завершения заказа.",
  "Запрещены украденные аккаунты, фишинг, вредоносные файлы, обходы платежей и товары, нарушающие закон Украины.",
  "Продавец обязан описывать товар честно: регион, сервер, платформа, ограничения и способ передачи.",
  "Покупатель обязан проверять доставку до подтверждения заказа.",
  "Спор замораживает средства до решения администрации.",
  "Отзывы можно оставлять только по завершенным заказам."
];

export default function RulesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="app-card overflow-hidden">
        <div className="bg-panel/70 p-7">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-brand">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-3xl font-extrabold">Правила SKRYNIA</h1>
          <p className="mt-3 max-w-2xl leading-7 text-muted">
            Эти правила нужны, чтобы покупатели и продавцы безопасно работали с цифровыми товарами, услугами и игровой валютой.
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {rules.map((rule) => (
          <article key={rule} className="app-card flex gap-3 p-5">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
            <p className="text-sm leading-6 text-muted">{rule}</p>
          </article>
        ))}
      </section>

      <section className="app-card flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-action" />
          <div>
            <h2 className="font-extrabold">Нужна помощь или спор?</h2>
            <p className="mt-1 text-sm text-muted">Создайте обращение в поддержку, если продавец или покупатель нарушает правила.</p>
          </div>
        </div>
        <Link href="/support" className="app-button shrink-0">
          Написать в поддержку
        </Link>
      </section>
    </div>
  );
}
