"use client";

import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { showAppToast } from "@/lib/toast-events";

const USER_REPORT_REASONS: Array<[string, string]> = [
  ["fraud", "Мошенничество"],
  ["abuse", "Оскорбления"],
  ["spam", "Спам"],
  ["fake_lot", "Фейковый лот"],
  ["payment_issue", "Проблема с оплатой"],
  ["off_platform_deal", "Сделка вне платформы"],
  ["illegal_content", "Незаконный контент"],
  ["other", "Другое"]
];

const MESSAGE_REPORT_REASONS: Array<[string, string]> = [
  ["insult", "Оскорбление"],
  ["spam", "Спам"],
  ["scam", "Мошенничество"],
  ["off_platform_deal", "Сделка вне платформы"],
  ["personal_data", "Личные данные"],
  ["prohibited_content", "Запрещенный контент"],
  ["other", "Другое"]
];

type ReportModalProps = {
  kind: "user" | "message";
  targetId: string;
  onClose: () => void;
};

export function ReportModal({ kind, targetId, onClose }: ReportModalProps) {
  const [reason, setReason] = useState("");
  const reasons = kind === "user" ? USER_REPORT_REASONS : MESSAGE_REPORT_REASONS;

  const submitReport = useMutation({
    mutationFn: (input: { reason: string; description: string }) =>
      kind === "user"
        ? apiFetch("/reports/users", {
            method: "POST",
            body: JSON.stringify({ reportedUserId: targetId, reason: input.reason, description: input.description || undefined })
          })
        : apiFetch("/reports/messages", {
            method: "POST",
            body: JSON.stringify({ messageId: targetId, reason: input.reason, description: input.description || undefined })
          }),
    onSuccess: () => {
      showAppToast({ title: "Жалоба отправлена на проверку" });
      onClose();
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const description = String(new FormData(event.currentTarget).get("description") ?? "");
    if (!reason) return;
    submitReport.mutate({ reason, description });
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="app-card w-full max-w-sm p-5"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-black text-ink">{kind === "user" ? "Пожаловаться на пользователя" : "Пожаловаться на сообщение"}</h2>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-panel hover:text-ink" onClick={onClose} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-4 block text-sm font-bold text-muted">Причина</label>
        <select className="app-input mt-2 h-11 w-full" value={reason} onChange={(event) => setReason(event.target.value)} required>
          <option value="" disabled>
            Выберите причину
          </option>
          {reasons.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-sm font-bold text-muted">Описание (необязательно)</label>
        <textarea name="description" className="app-input mt-2 min-h-24 w-full resize-none py-2" maxLength={3000} />

        {submitReport.isError ? <p className="mt-2 text-sm text-rose-600">Не удалось отправить жалобу. Попробуйте снова.</p> : null}

        <button className="app-button mt-4 w-full py-3" type="submit" disabled={submitReport.isPending || !reason}>
          {submitReport.isPending ? "Отправляем..." : "Отправить жалобу"}
        </button>
      </form>
    </div>
  );
}
