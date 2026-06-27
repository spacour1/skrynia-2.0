export const APP_TOAST_EVENT = "skrynia-app-toast";

export type AppToastPayload = {
  id?: string;
  type?: string;
  title: string;
  body?: string | null;
  orderId?: string | null;
  productId?: string | null;
  conversationId?: string | null;
};

export function showAppToast(payload: AppToastPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AppToastPayload>(APP_TOAST_EVENT, { detail: payload }));
}
