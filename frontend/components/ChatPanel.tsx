"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, FileText, ImageIcon, Loader2, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { RealtimeMessageError } from "@/lib/realtime-client";
import { useRealtime, useRealtimeStatus } from "@/components/RealtimeProvider";
import { EmailNotVerifiedNotice } from "./EmailNotVerifiedNotice";
import { ReportModal } from "./ReportModal";

type Message = {
  id: string;
  senderId: string | null;
  senderDisplayName?: string;
  body: string;
  attachmentUrl?: string;
  createdAt: string;
  conversationId?: string;
  clientMessageId?: string;
  deliveryStatus?: "sending" | "sent" | "failed";
  retryable?: boolean;
  kind?: "user" | "system";
  metadata?: { bodyKey?: string; params?: Record<string, string | number> } | null;
};

type ChatPanelMode = "full" | "compact";

export function ChatPanel({
  conversationId,
  mode,
  compact = false,
  disabledNotice,
  ensureConversation,
  onConversationReady,
  emptyNotice
}: {
  conversationId?: string | null;
  mode?: ChatPanelMode;
  compact?: boolean;
  disabledNotice?: string;
  ensureConversation?: () => Promise<{ conversationId: string }>;
  onConversationReady?: (conversationId: string) => void;
  emptyNotice?: string;
}) {
  const user = useAuth((state) => state.user);
  const realtime = useRealtime();
  const realtimeStatus = useRealtimeStatus();
  const { language, t } = useI18n();
  const queryClient = useQueryClient();
  const isCompact = mode ? mode === "compact" : compact;
  const [activeConversationId, setActiveConversationId] = useState(conversationId ?? "");
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentLabel, setAttachmentLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [emailBlocked, setEmailBlocked] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const history = useQuery({
    queryKey: ["messages", activeConversationId],
    queryFn: () => apiFetch<{ messages: Message[] }>(`/chat/conversations/${activeConversationId}/messages`),
    enabled: Boolean(activeConversationId)
  });

  useEffect(() => {
    setActiveConversationId(conversationId ?? "");
    setError("");
    setEmailBlocked(false);
  }, [conversationId]);

  useEffect(() => {
    if (!history.data?.messages) return;
    setMessages((current) => {
      const pending = current.filter(
        (message) =>
          message.conversationId === activeConversationId &&
          (message.deliveryStatus === "sending" || message.deliveryStatus === "failed")
      );
      const serverIds = new Set(history.data.messages.map((message) => message.id));
      return [
        ...history.data.messages,
        ...pending.filter((message) => !serverIds.has(message.id))
      ];
    });
  }, [activeConversationId, history.data]);

  useEffect(() => {
    setMessages((current) =>
      current.filter((message) => message.conversationId === activeConversationId)
    );
  }, [activeConversationId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (!user || !activeConversationId) return;
    return realtime.joinConversation(activeConversationId);
  }, [activeConversationId, realtime, user]);

  useEffect(() => {
    return realtime.subscribe((payload) => {
      if (payload.type === "message") {
        const message = payload.message as Message | undefined;
        if (!message || message.conversationId !== activeConversationId) return;
        setMessages((current) =>
          current.some((item) => item.id === message.id) ? current : [...current, message]
        );
        queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
        queryClient.invalidateQueries({ queryKey: ["chat-conversations-grouped"] });
      }
      if (payload.type === "error") {
        if (payload.code === "email_not_verified") {
          setEmailBlocked(true);
        } else if (typeof payload.message === "string") {
          setError(payload.message);
        }
      }
    });
  }, [activeConversationId, queryClient, realtime]);

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const uploaded = await apiFetch<{ url: string }>("/storage/upload", { method: "POST", body });
      setAttachmentUrl(uploaded.url);
      setAttachmentLabel(file.name);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const typed = String(form.get("body") ?? "").trim();
    const attachment = attachmentUrl.trim();
    if (!typed && !attachment) return;
    const body = typed || `Attached file: ${attachmentLabel || "file"}`;
    let targetConversationId = activeConversationId;
    let pendingClientMessageId: string | undefined;

    setSending(true);
    setError("");
    setEmailBlocked(false);
    try {
      if (!targetConversationId) {
        if (!ensureConversation) {
          setError(t("messages.selectChat"));
          return;
        }
        const created = await ensureConversation();
        targetConversationId = created.conversationId;
        setActiveConversationId(targetConversationId);
        onConversationReady?.(targetConversationId);
      }

      pendingClientMessageId = crypto.randomUUID();
      const optimistic: Message = {
        id: `client:${pendingClientMessageId}`,
        clientMessageId: pendingClientMessageId,
        conversationId: targetConversationId,
        senderId: user?.id ?? null,
        senderDisplayName: user?.displayName,
        body,
        attachmentUrl: attachment || undefined,
        createdAt: new Date().toISOString(),
        deliveryStatus: "sending",
        retryable: true
      };
      setMessages((current) => [...current, optimistic]);

      const saved = await deliverMessage(optimistic);
      markMessageSent(pendingClientMessageId, saved);
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations-grouped"] });

      formElement.reset();
      setAttachmentUrl("");
      setAttachmentLabel("");
    } catch (sendError) {
      if (pendingClientMessageId) {
        markMessageFailed(pendingClientMessageId, isRetryable(sendError));
      }
      if (
        (sendError instanceof ApiError &&
          sendError.status === 403 &&
          sendError.code === "email_not_verified") ||
        (sendError instanceof RealtimeMessageError &&
          sendError.code === "email_not_verified")
      ) {
        setEmailBlocked(true);
      } else {
        setError(sendError instanceof Error ? sendError.message : "Message failed");
      }
    } finally {
      setSending(false);
    }
  }

  async function deliverMessage(message: Message): Promise<Message> {
    const conversation = message.conversationId!;
    if (
      conversation === activeConversationId &&
      realtimeStatus.status === "connected" &&
      message.clientMessageId
    ) {
      return (await realtime.sendMessage({
        clientMessageId: message.clientMessageId,
        conversationId: conversation,
        body: message.body,
        attachmentUrl: message.attachmentUrl
      })) as Message;
    }

    const saved = await apiFetch<{ message: Message }>(
      `/chat/conversations/${conversation}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          body: message.body,
          attachmentUrl: message.attachmentUrl
        })
      }
    );
    return saved.message;
  }

  function markMessageSent(clientMessageId: string, saved: Message) {
    setMessages((current) =>
      current.map((message) =>
        message.clientMessageId === clientMessageId
          ? {
              ...saved,
              clientMessageId,
              deliveryStatus: "sent",
              retryable: false
            }
          : message
      )
    );
  }

  function markMessageFailed(clientMessageId: string, retryable: boolean) {
    setMessages((current) =>
      current.map((message) =>
        message.clientMessageId === clientMessageId
          ? { ...message, deliveryStatus: "failed", retryable }
          : message
      )
    );
  }

  async function retryMessage(message: Message) {
    if (!message.clientMessageId || !message.retryable) return;
    setError("");
    setMessages((current) =>
      current.map((item) =>
        item.clientMessageId === message.clientMessageId
          ? { ...item, deliveryStatus: "sending" }
          : item
      )
    );
    try {
      const saved = await deliverMessage(message);
      markMessageSent(message.clientMessageId, saved);
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations-grouped"] });
    } catch (retryError) {
      markMessageFailed(message.clientMessageId, isRetryable(retryError));
      setError(retryError instanceof Error ? retryError.message : "Message failed");
    }
  }

  return (
    <section className={`flex h-full ${isCompact ? "min-h-[360px] overflow-hidden rounded-xl border border-line/70 bg-card/95 shadow-soft" : "min-h-[620px] bg-surface/35"} flex-col`}>
      <div ref={listRef} className={`${isCompact ? "max-h-[260px] min-h-[210px] px-3 py-3" : "min-h-[420px] flex-1 px-5 py-5"} space-y-4 overflow-y-auto`}>
        {history.isLoading && activeConversationId ? (
          <div className={`${isCompact ? "min-h-[180px]" : "min-h-[300px]"} grid place-items-center text-center text-sm text-muted`}>
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : null}
        {messages.map((message) => {
          if (message.kind === "system") {
            // bodyKey/params travel in metadata so system messages render in the viewer's
            // current language; the stored body is the default-locale fallback.
            const systemBody = message.metadata?.bodyKey ? t(message.metadata.bodyKey, message.metadata.params) : message.body;
            return (
              <div key={message.id} className="flex justify-center">
                <p className="max-w-[90%] rounded-full bg-panel/60 px-4 py-1.5 text-center text-xs font-medium text-muted">
                  {systemBody} · {new Date(message.createdAt).toLocaleString(language)}
                </p>
              </div>
            );
          }
          const mine = message.senderId === user?.id;
          return (
            <div key={message.id} className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                <div className={`rounded-2xl px-4 py-3 ${isCompact ? "" : "shadow-soft"} ${mine ? "rounded-br-md bg-brand text-stone-950" : `${isCompact ? "bg-panel/80" : "border border-line bg-card"} rounded-bl-md text-ink`}`}>
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                  {message.attachmentUrl ? <AttachmentPreview url={message.attachmentUrl} mine={mine} /> : null}
                </div>
                <p className="mt-1 flex items-center gap-2 px-1 text-xs text-muted">
                  {message.senderDisplayName ?? (mine ? "You" : t("messages.participant"))} · {new Date(message.createdAt).toLocaleString(language)}
                  {mine && message.deliveryStatus ? (
                    <span
                      className={
                        message.deliveryStatus === "failed"
                          ? "font-bold text-rose-400"
                          : "inline-flex items-center gap-1"
                      }
                    >
                      {message.deliveryStatus === "sending" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : null}
                      {t(`chat.${message.deliveryStatus}`)}
                    </span>
                  ) : null}
                  {mine && message.deliveryStatus === "failed" && message.retryable ? (
                    <button
                      type="button"
                      className="grid h-6 w-6 place-items-center rounded-md text-brand transition hover:bg-brand/10"
                      aria-label={t("chat.retryMessage")}
                      title={t("chat.retryMessage")}
                      onClick={() => void retryMessage(message)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {!mine ? (
                    <button
                      type="button"
                      className="opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                      aria-label={t("chat.reportMessage")}
                      onClick={() => setReportMessageId(message.id)}
                    >
                      <Flag className="h-3 w-3" />
                    </button>
                  ) : null}
                </p>
              </div>
            </div>
          );
        })}
        {!history.isLoading && !messages.length ? (
          <div className={`${isCompact ? "min-h-[180px] rounded-lg border border-dashed border-line/70 bg-panel/25 px-4" : "min-h-[300px]"} grid place-items-center text-center text-sm text-muted`}>
            {emptyNotice ?? t("chat.empty")}
          </div>
        ) : null}
      </div>

      {disabledNotice ? (
        <div className={`${isCompact ? "px-3 pb-3 pt-2" : "border-t border-line bg-card/95 p-4"}`}>
          <p className="rounded-lg bg-panel/50 p-3 text-sm text-muted">{disabledNotice}</p>
        </div>
      ) : (
      <form ref={formRef} className={`${isCompact ? "bg-transparent px-3 pb-3 pt-2" : "border-t border-line bg-card/95 p-4"}`} onSubmit={submit}>
        {emailBlocked ? (
          <div className="mb-2">
            <EmailNotVerifiedNotice />
          </div>
        ) : error ? (
          <p className="mb-2 text-xs font-bold text-rose-400">{error}</p>
        ) : null}
        {attachmentUrl ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/10 px-3 py-2 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2 font-bold text-brand">
              {isImage(attachmentUrl) ? <ImageIcon className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
              <span className="truncate">{attachmentLabel || "Attachment ready"}</span>
            </span>
            <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink" onClick={() => { setAttachmentUrl(""); setAttachmentLabel(""); }}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input ref={fileRef} className="hidden" type="file" accept="image/*,.txt,.pdf,.doc,.docx,.rtf" onChange={uploadAttachment} />
          <button
            className={`${isCompact ? "h-10 w-10 rounded-lg border-0 bg-panel/70" : "h-12 w-12 rounded-xl border border-line bg-panel"} grid shrink-0 place-items-center text-muted transition hover:border-brand/60 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60`}
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || sending}
            aria-label="Attach file"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
          </button>
          <textarea
            className={`${isCompact ? "min-h-10 rounded-lg border border-line/60 bg-panel/70 px-3 py-2 text-sm outline-none transition focus:border-brand/70" : "app-input min-h-12 py-3"} max-h-32 min-w-0 flex-1 resize-none disabled:cursor-not-allowed disabled:opacity-60`}
            name="body"
            placeholder={t("chat.messagePlaceholder")}
            rows={1}
            disabled={sending}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <button className={`app-button ${isCompact ? "h-10 px-3" : "h-12 px-4"}`} aria-label="Send message" disabled={uploading || sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
      )}
      {reportMessageId ? <ReportModal kind="message" targetId={reportMessageId} onClose={() => setReportMessageId(null)} /> : null}
    </section>
  );
}

function AttachmentPreview({ url, mine }: { url: string; mine: boolean }) {
  if (isImage(url)) {
    return (
      <a className="mt-3 block overflow-hidden rounded-xl border border-black/10 bg-black/10" href={url} target="_blank" rel="noreferrer">
        <img className="max-h-72 w-full object-cover" src={url} alt="" />
      </a>
    );
  }

  return (
    <a
      className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${mine ? "bg-stone-950/10 text-stone-950" : "bg-panel text-brand"}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <FileText className="h-4 w-4" />
      Open attached document
    </a>
  );
}

function isImage(url: string) {
  return /\.(png|jpe?g|gif|webp|avif)$/i.test(url.split("?")[0] ?? "");
}

function isRetryable(error: unknown) {
  if (error instanceof RealtimeMessageError) return error.retryable;
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500;
  return true;
}
