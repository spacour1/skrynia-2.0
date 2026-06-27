"use client";

import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Headphones, Send } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";

export default function SupportPage() {
  const user = useAuth((s) => s.user);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const create = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch<{ ticket: { id: string } }>("/support/tickets", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: (response) => {
      setDone(`Обращение создано: ${response.ticket.id.slice(0, 8)}`);
      setError("");
    },
    onError: (err) => {
      setDone("");
      setError(err instanceof Error ? err.message : "Не удалось создать обращение");
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      email: form.get("email"),
      subject: form.get("subject"),
      body: form.get("body"),
      priority: form.get("priority")
    });
    event.currentTarget.reset();
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_360px]">
      <section className="app-card overflow-hidden">
        <div className="border-b border-line bg-panel/70 p-6">
          <Headphones className="h-8 w-8 text-brand" />
          <h1 className="mt-4 text-3xl font-extrabold">Поддержка SKRYNIA</h1>
          <p className="mt-2 text-sm leading-6 text-muted">Опишите проблему с заказом, оплатой, продавцом или лотом. Администратор обработает обращение.</p>
        </div>
        <form className="space-y-4 p-6" onSubmit={submit}>
          <input className="app-input w-full" name="email" type="email" defaultValue={user?.email ?? ""} placeholder="Email для ответа" />
          <input className="app-input w-full" name="subject" placeholder="Тема обращения" required />
          <select className="app-input w-full" name="priority" defaultValue="normal">
            <option value="low">Низкий приоритет</option>
            <option value="normal">Обычный приоритет</option>
            <option value="high">Срочно</option>
          </select>
          <textarea className="app-input h-40 w-full" name="body" placeholder="Опишите проблему минимум в 20 символов" required />
          {done && <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200">{done}</p>}
          {error && <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-200">{error}</p>}
          <button className="app-button">
            <Send className="h-4 w-4" />
            Отправить
          </button>
        </form>
      </section>

      <aside className="space-y-4">
        <section className="app-card p-5">
          <h2 className="text-lg font-extrabold">Telegram поддержка</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Тестовая ссылка для MVP. Позже сюда можно подключить реального оператора или бота.</p>
          <button className="app-button mt-4 w-full" onClick={() => window.open("https://t.me/skrynia_support", "_blank", "noopener,noreferrer")}>
            Открыть Telegram
          </button>
        </section>
        <section className="app-card p-5">
          <h2 className="text-lg font-extrabold">Что приложить</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
            <li>Номер заказа или ссылку на лот.</li>
            <li>Скриншоты переписки и доставки.</li>
            <li>Ожидаемое решение: возврат или выплата продавцу.</li>
          </ul>
        </section>
        <section className="app-card p-5">
          <h2 className="text-lg font-extrabold">SLA MVP</h2>
          <p className="mt-2 text-sm leading-6 text-muted">В локальной версии обращения сохраняются в базе и доступны администраторам.</p>
        </section>
      </aside>
    </div>
  );
}
