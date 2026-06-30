"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flag, FileText, ImageIcon, Loader2, Paperclip, Send, X } from "lucide-react";
import { apiFetch, ApiError, AUTH_REFRESHED_EVENT, WS_URL } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { EmailNotVerifiedNotice } from "./EmailNotVerifiedNotice";
import { ReportModal } from "./ReportModal";

type Message = {
  id: string;
  senderId: string | null;
  senderDisplayName?: string;
  body: string;
  attachmentUrl?: string;
  createdAt: string;
  kind?: "user" | "system";
};

export function ChatPanel({
  conversationId,
  compact = false,
  disabledNotice
}: {
  conversationId: string;
  compact?: boolean;
  disabledNotice?: string;
}) {
  const user = useAuth((state) => state.user);
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentLabel, setAttachmentLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [emailBlocked, setEmailBlocked] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const history = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => apiFetch<{ messages: Message[] }>(`/chat/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId)
  });

  useEffect(() => {
    if (history.data?.messages) setMessages(history.data.messages);
  }, [history.data]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (!user || !conversationId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function connect() {
      // The access token lives in an httpOnly cookie, so the browser authenticates the
      // WS handshake automatically — no token needs to be readable by frontend JS.
      const ws = new WebSocket(WS_URL);
      socket.current = ws;

      ws.addEventListener("open", () => {
        attempt = 0;
        setConnected(true);
        setError("");
        setEmailBlocked(false);
        ws.send(JSON.stringify({ type: "join_conversation", conversationId }));
      });
      ws.addEventListener("close", () => {
        setConnected(false);
        if (cancelled) return;
        // The connection may have dropped because the access token expired mid-session.
        // A WS handshake can't refresh itself, so make a cheap authenticated request first
        // - apiFetch's own 401 handling silently refreshes it - before retrying the socket.
        attempt += 1;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
        retryTimer = setTimeout(async () => {
          if (cancelled) return;
          try {
            await apiFetch("/auth/me");
          } catch (refreshError) {
            if (refreshError instanceof ApiError && (refreshError.status === 401 || refreshError.status === 403)) {
              return; // session is genuinely gone - no point reconnecting
            }
          }
          if (!cancelled) connect();
        }, delay);
      });
      ws.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "message") {
          setMessages((current) => (current.some((item) => item.id === payload.message.id) ? current : [...current, payload.message]));
        }
        if (payload.type === "error") {
          if (payload.code === "email_not_verified") {
            setEmailBlocked(true);
          } else {
            setError(payload.message ?? "Chat error");
          }
        }
      });
    }

    connect();

    // A refresh triggered by some *other* request still means the cookie just rotated -
    // reconnect now instead of waiting for this socket to eventually drop on its own.
    const onRefreshed = () => {
      if (!cancelled) socket.current?.close();
    };
    window.addEventListener(AUTH_REFRESHED_EVENT, onRefreshed);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener(AUTH_REFRESHED_EVENT, onRefreshed);
      socket.current?.close();
    };
  }, [conversationId, user]);

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
    const form = new FormData(event.currentTarget);
    const typed = String(form.get("body") ?? "").trim();
    const attachment = attachmentUrl.trim();
    if (!typed && !attachment) return;
    const body = typed || `Attached file: ${attachmentLabel || "file"}`;
    event.currentTarget.reset();
    setAttachmentUrl("");
    setAttachmentLabel("");

    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: "message", conversationId, body, attachmentUrl: attachment || undefined }));
      return;
    }

    const saved = await apiFetch<{ message: Message }>(`/chat/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, attachmentUrl: attachment || undefined })
    });
    setMessages((current) => [...current, saved.message]);
  }

  return (
    <section className={`flex h-full ${compact ? "min-h-[230px]" : "min-h-[620px]"} flex-col bg-surface/35`}>
      <div ref={listRef} className={`${compact ? "max-h-[170px] min-h-[110px] px-3 py-3" : "min-h-[420px] flex-1 px-5 py-5"} space-y-4 overflow-y-auto`}>
        {messages.map((message) => {
          if (message.kind === "system") {
            return (
              <div key={message.id} className="flex justify-center">
                <p className="max-w-[90%] rounded-full bg-panel/60 px-4 py-1.5 text-center text-xs font-medium text-muted">
                  {message.body} · {new Date(message.createdAt).toLocaleString("ru-RU")}
                </p>
              </div>
            );
          }
          const mine = message.senderId === user?.id;
          return (
            <div key={message.id} className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                <div className={`rounded-2xl px-4 py-3 ${compact ? "" : "shadow-soft"} ${mine ? "rounded-br-md bg-brand text-stone-950" : `${compact ? "bg-panel/70" : "border border-line bg-card"} rounded-bl-md text-ink`}`}>
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                  {message.attachmentUrl ? <AttachmentPreview url={message.attachmentUrl} mine={mine} /> : null}
                </div>
                <p className="mt-1 flex items-center gap-2 px-1 text-xs text-muted">
                  {message.senderDisplayName ?? (mine ? "You" : "Participant")} · {new Date(message.createdAt).toLocaleString("ru-RU")}
                  {!mine ? (
                    <button
                      type="button"
                      className="opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                      aria-label="Пожаловаться на сообщение"
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
        {!messages.length ? (
          <div className={`${compact ? "min-h-[100px]" : "min-h-[300px]"} grid place-items-center text-center text-sm text-muted`}>
            {compact ? "" : "No messages yet"}
          </div>
        ) : null}
      </div>

      {disabledNotice ? (
        <div className={`${compact ? "px-3 pb-3 pt-2" : "border-t border-line bg-card/95 p-4"}`}>
          <p className="rounded-lg bg-panel/50 p-3 text-sm text-muted">{disabledNotice}</p>
        </div>
      ) : (
      <form ref={formRef} className={`${compact ? "bg-transparent px-3 pb-3 pt-2" : "border-t border-line bg-card/95 p-4"}`} onSubmit={submit}>
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
            className={`${compact ? "h-10 w-10 rounded-lg border-0 bg-panel/70" : "h-12 w-12 rounded-xl border border-line bg-panel"} grid shrink-0 place-items-center text-muted transition hover:border-brand/60 hover:text-brand`}
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="Attach file"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
          </button>
          <textarea
            className={`${compact ? "min-h-10 rounded-lg border-0 bg-panel/70 py-2 text-sm" : "app-input min-h-12 py-3"} max-h-32 min-w-0 flex-1 resize-none`}
            name="body"
            placeholder=""
            rows={1}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <button className={`app-button ${compact ? "h-10 px-3" : "h-12 px-4"}`} aria-label="Send message" disabled={uploading}>
            <Send className="h-4 w-4" />
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
