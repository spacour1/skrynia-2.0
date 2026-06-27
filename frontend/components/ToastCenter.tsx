"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, Heart, MessageCircle, ReceiptText, X } from "lucide-react";
import { WS_URL } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { APP_TOAST_EVENT, type AppToastPayload } from "../lib/toast-events";

type WsNotification = {
  id?: string;
  type: string;
  title: string;
  body?: string | null;
  orderId?: string | null;
  productId?: string | null;
  conversationId?: string | null;
  createdAt?: string;
};

type Toast = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  orderId?: string | null;
  productId?: string | null;
  conversationId?: string | null;
  createdAt: number;
};

const MAX_TOASTS = 4;
const TOAST_TTL_MS = 8000;

export function ToastCenter() {
  const user = useAuth((state) => state.user);
  const hydrated = useAuth((state) => state.hydrated);
  const router = useRouter();
  const queryClient = useQueryClient();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!hydrated || !user) {
      socketRef.current?.close();
      socketRef.current = null;
      setToasts([]);
      return;
    }

    let closedByEffect = false;

    function connect() {
      // The access token lives in an httpOnly cookie, so the browser authenticates the
      // WS handshake automatically — no token needs to be readable by frontend JS.
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.addEventListener("message", (event) => {
        const payload = safeParse(event.data);
        if (!payload || payload.type === "connected" || payload.type === "joined_order") return;

        if (payload.type === "presence") {
          queryClient.invalidateQueries({ queryKey: ["game-products"] });
          queryClient.invalidateQueries({ queryKey: ["products"] });
          queryClient.invalidateQueries({ queryKey: ["seller"] });
          queryClient.invalidateQueries({ queryKey: ["seller-favorites"] });
          queryClient.invalidateQueries({ queryKey: ["game-page"] });
          return;
        }

        const toast = toastFromPayload(payload);
        if (!toast) return;
        pushToast(toast);
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        if (toast.orderId) {
          queryClient.invalidateQueries({ queryKey: ["orders"] });
          queryClient.invalidateQueries({ queryKey: ["order", toast.orderId] });
        }
        if (toast.conversationId) {
          queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
        }
      });

      ws.addEventListener("close", () => {
        if (closedByEffect) return;
        reconnectTimerRef.current = window.setTimeout(connect, 3000);
      });
    }

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [hydrated, queryClient, user]);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismiss(toast.id), Math.max(1000, TOAST_TTL_MS - (Date.now() - toast.createdAt)))
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts]);

  useEffect(() => {
    function handleAppToast(event: Event) {
      const detail = (event as CustomEvent<AppToastPayload>).detail;
      if (!detail?.title) return;
      pushToast({
        id: detail.id ?? `${detail.type ?? "app"}:${detail.productId ?? detail.orderId ?? detail.conversationId ?? Date.now()}`,
        type: detail.type ?? "app",
        title: detail.title,
        body: detail.body,
        orderId: detail.orderId,
        productId: detail.productId,
        conversationId: detail.conversationId,
        createdAt: Date.now()
      });
    }

    window.addEventListener(APP_TOAST_EVENT, handleAppToast);
    return () => window.removeEventListener(APP_TOAST_EVENT, handleAppToast);
  }, []);

  function pushToast(toast: Toast) {
    if (seenRef.current.has(toast.id)) return;
    seenRef.current.add(toast.id);
    setToasts((current) => [toast, ...current].slice(0, MAX_TOASTS));
  }

  function dismiss(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function openToast(toast: Toast) {
    dismiss(toast.id);
    if (toast.conversationId) {
      router.push(`/messages?conversation=${toast.conversationId}`);
      return;
    }
    if (toast.orderId) {
      router.push(`/orders/${toast.orderId}`);
      return;
    }
    if (toast.productId) {
      router.push(`/products/${toast.productId}`);
      return;
    }
    router.push("/dashboard");
  }

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col-reverse gap-3 sm:bottom-6 sm:left-6">
      {toasts.map((toast) => {
        const Icon = iconForToast(toast.type);
        return (
          <article
            key={toast.id}
            className="relative overflow-hidden rounded-lg border border-line bg-card shadow-lift"
            role="status"
            aria-live="polite"
          >
            <button className="flex w-full gap-3 p-4 text-left transition hover:bg-panel/60" type="button" onClick={() => openToast(toast)}>
              <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black text-ink">{toast.title}</span>
                {toast.body ? <span className="mt-1 line-clamp-2 block text-sm leading-5 text-muted">{toast.body}</span> : null}
                <span className="mt-2 block text-xs font-semibold text-brand">
                  {toast.conversationId ? "Открыть чат" : toast.orderId ? "Открыть заказ" : toast.productId ? "Открыть товар" : "Открыть"}
                </span>
              </span>
            </button>
            <button
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-panel hover:text-ink"
              type="button"
              aria-label="Закрыть уведомление"
              onClick={() => dismiss(toast.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </article>
        );
      })}
    </div>
  );
}

function toastFromPayload(payload: any): Toast | null {
  if (payload.type === "notification" && payload.notification) {
    return toastFromNotification(payload.notification);
  }

  if (payload.type === "message" && payload.message) {
    return {
      id: payload.message.id,
      type: "message",
      title: "Новое сообщение",
      body: payload.message.body,
      conversationId: payload.message.conversationId,
      createdAt: Date.now()
    };
  }

  if (payload.type === "presence") return null;

  if (typeof payload.type === "string" && payload.orderId) {
    const title = eventTitle(payload.type);
    if (!title) return null;
    return {
      id: `${payload.type}:${payload.orderId}:${Date.now()}`,
      type: payload.type,
      title,
      body: eventBody(payload.type),
      orderId: payload.orderId,
      createdAt: Date.now()
    };
  }

  return null;
}

function toastFromNotification(notification: WsNotification): Toast {
  const fallbackTitle = eventTitle(notification.type);
  const fallbackBody = eventBody(notification.type);
  return {
    id: notification.id ?? `${notification.type}:${notification.orderId ?? notification.productId ?? notification.conversationId ?? Date.now()}`,
    type: notification.type,
    title: fallbackTitle ?? normalizeMojibake(notification.title),
    body: fallbackBody ?? (notification.body ? normalizeMojibake(notification.body) : null),
    orderId: notification.orderId,
    productId: notification.productId,
    conversationId: notification.conversationId,
    createdAt: Date.now()
  };
}

function iconForToast(type: string) {
  if (type === "message") return MessageCircle;
  if (type.includes("favorite")) return Heart;
  if (type.includes("paid") || type.includes("payment")) return ReceiptText;
  if (type.includes("completed") || type.includes("delivered")) return CheckCircle2;
  return Bell;
}

function eventTitle(type: string) {
  const titles: Record<string, string> = {
    order_paid: "Заказ оплачен",
    order_created: "Новый заказ",
    review_created: "Новый отзыв",
    order_started: "Заказ взят в работу",
    order_delivered: "Заказ доставлен",
    order_completed: "Сделка завершена",
    order_auto_completed: "Сделка завершена автоматически",
    order_disputed: "Открыт спор",
    dispute_resolved: "Спор решен"
  };
  return titles[type];
}

function eventBody(type: string) {
  const bodies: Record<string, string> = {
    order_paid: "Оплата поступила в эскроу.",
    order_created: "Покупатель создал заказ. После оплаты он появится в работе.",
    review_created: "Покупатель оставил отзыв по завершенной сделке.",
    order_started: "Продавец начал выполнение заказа.",
    order_delivered: "Проверьте результат и подтвердите доставку.",
    order_completed: "Средства выплачены продавцу.",
    order_auto_completed: "Срок проверки истек, заказ закрыт.",
    order_disputed: "Администратор проверит историю сделки.",
    dispute_resolved: "Решение администратора применено к заказу."
  };
  return bodies[type];
}

function safeParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeMojibake(value: string) {
  const map: Record<string, string> = {
    "РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ": "Новое сообщение",
    "Р—Р°РєР°Р· РѕРїР»Р°С‡РµРЅ": "Заказ оплачен",
    "РћРїР»Р°С‚Р° РІ escrow": "Оплата в эскроу",
    "РќРѕРІС‹Р№ Р·Р°РєР°Р·": "Новый заказ",
    "Р—Р°РєР°Р· РІР·СЏС‚ РІ СЂР°Р±РѕС‚Сѓ": "Заказ взят в работу",
    "Р—Р°РєР°Р· РґРѕСЃС‚Р°РІР»РµРЅ": "Заказ доставлен",
    "РЎРґРµР»РєР° Р·Р°РІРµСЂС€РµРЅР°": "Сделка завершена",
    "РћС‚РєСЂС‹С‚ СЃРїРѕСЂ": "Открыт спор",
    "РЎРїРѕСЂ СЂРµС€РµРЅ": "Спор решен",
    "РќРѕРІС‹Р№ РѕС‚Р·С‹РІ": "Новый отзыв"
  };
  return map[value] ?? value;
}
