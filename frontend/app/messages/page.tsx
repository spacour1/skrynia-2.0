"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, MessageCircle, Search } from "lucide-react";
import { ChatPanel } from "../../components/ChatPanel";
import { RequireAuth } from "../../components/RequireAuth";
import { apiFetch, money, type Conversation } from "../../lib/api";

const chatTabs = [
  ["all", "All"],
  ["active", "Active"],
  ["finished", "Finished"]
];

const ACTIVE_ORDER_STATUSES = ["pending", "paid", "in_progress", "delivered", "disputed"];

export default function MessagesPage() {
  return (
    <RequireAuth>
      <MessagesContent />
    </RequireAuth>
  );
}

function MessagesContent() {
  const searchParams = useSearchParams();
  const [selectedConversationId, setSelectedConversationId] = useState(searchParams.get("conversation") ?? "");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const conversations = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: () => apiFetch<{ conversations: Conversation[] }>("/chat/conversations")
  });

  const filtered = useMemo(() => {
    const list = conversations.data?.conversations ?? [];
    const term = q.trim().toLowerCase();
    return list.filter((conversation) => {
      const title = (conversation.productTitle ?? "").toLowerCase();
      const matchesSearch =
        !term ||
        title.includes(term) ||
        conversation.id.toLowerCase().includes(term) ||
        participantName(conversation).toLowerCase().includes(term);
      const active = !conversation.orderStatus || ACTIVE_ORDER_STATUSES.includes(conversation.orderStatus);
      const matchesTab = tab === "all" || (tab === "active" && active) || (tab === "finished" && !active);
      return matchesSearch && matchesTab;
    });
  }, [conversations.data, q, tab]);

  const selected = selectedConversationId || filtered[0]?.id;
  const selectedConversation = filtered.find((conversation) => conversation.id === selected) ??
    conversations.data?.conversations?.find((conversation) => conversation.id === selected);

  return (
    <div className="grid min-h-[calc(100vh-130px)] overflow-hidden rounded-lg border border-line bg-card shadow-lift lg:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="border-b border-line bg-card lg:border-b-0 lg:border-r">
        <div className="border-b border-line p-5">
          <div>
            <h1 className="text-2xl font-black text-ink">Messages</h1>
          </div>
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="app-input h-12 w-full pl-10" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search order, product, or seller" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {chatTabs.map(([value, label]) => (
              <button
                key={value}
                className={`h-10 rounded-lg text-sm font-black transition ${tab === value ? "bg-brand text-stone-950" : "bg-panel text-muted hover:text-ink"}`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[calc(100vh-350px)] min-h-[420px] overflow-y-auto p-2">
          {filtered.map((conversation, index) => {
            const active = selected === conversation.id;
            const title = conversation.productTitle ?? "Сообщения";
            const amount = conversation.amountCents ?? 0;
            return (
              <button
                key={conversation.id}
                className={`mb-2 flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                  active ? "border-brand/50 bg-brand/10 shadow-soft" : "border-transparent hover:border-line hover:bg-panel/70"
                }`}
                onClick={() => setSelectedConversationId(conversation.id)}
              >
                <ParticipantAvatar conversation={conversation} index={index} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate font-black text-ink">{participantName(conversation)}</span>
                    <span className="text-xs text-muted">{formatTime(conversation.lastMessageAt ?? conversation.createdAt)}</span>
                  </span>
                  <span className="mt-1 block truncate text-sm font-bold text-muted">{title}</span>
                  {conversation.orderStatus ? (
                    <span className="mt-2 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-panel px-2 py-1 text-[11px] font-black uppercase text-muted">{conversation.orderStatus}</span>
                      <span className="text-xs font-black text-brand">{money(amount, conversation.currency ?? "UAH", { preserveCurrency: true })}</span>
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
          {!filtered.length ? (
            <div className="grid min-h-[240px] place-items-center p-6 text-center">
              <div>
                <MessageCircle className="mx-auto h-10 w-10 text-muted" />
                <p className="mt-3 text-sm text-muted">No order chats found.</p>
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="min-w-0 bg-surface/30">
        {selected && selectedConversation ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-line bg-card px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  {selectedConversation.sellerId ? (
                    <Link className="shrink-0 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/60" href={`/sellers/${selectedConversation.sellerId}`} aria-label="Open seller profile">
                      <ParticipantAvatar conversation={selectedConversation} index={0} size="lg" />
                    </Link>
                  ) : (
                    <ParticipantAvatar conversation={selectedConversation} index={0} size="lg" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-lg font-black text-ink">{selectedConversation.productTitle ?? "Сообщения"}</p>
                    {selectedConversation.orderId ? (
                      <p className="mt-1 text-sm text-muted">
                        Order #{selectedConversation.orderId.slice(0, 8)} ·{" "}
                        {money(selectedConversation.amountCents ?? 0, selectedConversation.currency ?? "UAH", { preserveCurrency: true })}
                      </p>
                    ) : null}
                  </div>
                </div>
                {selectedConversation.orderId ? (
                  <Link className="app-button-secondary hidden h-10 shrink-0 px-3 text-sm sm:inline-flex" href={`/orders/${selectedConversation.orderId}`}>
                    Open order
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </div>
            <ChatPanel conversationId={selected} />
          </div>
        ) : (
          <section className="grid min-h-[620px] place-items-center p-8 text-center text-muted">
            Select an order to open its chat.
          </section>
        )}
      </section>
    </div>
  );
}

function ParticipantAvatar({ conversation, index, size }: { conversation?: Conversation; index: number; size: "md" | "lg" }) {
  const avatarUrl = conversation?.sellerAvatarUrl ?? null;
  const name = participantName(conversation);
  const box = size === "lg" ? "h-14 w-14 text-lg" : "h-12 w-12 text-sm";

  return (
    <span className={`relative grid ${box} shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br ${avatarGradient(index)} font-black text-white`}>
      {avatarUrl ? <img className="h-full w-full object-cover" src={avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
      {size === "md" ? (
        <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-card bg-card text-brand">
          <MessageCircle className="h-3 w-3" />
        </span>
      ) : null}
    </span>
  );
}

function participantName(conversation?: Conversation) {
  return conversation?.sellerDisplayName ?? conversation?.buyerDisplayName ?? "Participant";
}

function avatarGradient(index: number) {
  return [
    "from-violet-500 via-fuchsia-700 to-slate-950",
    "from-emerald-400 via-teal-700 to-slate-950",
    "from-amber-300 via-orange-700 to-slate-950",
    "from-sky-400 via-blue-700 to-slate-950"
  ][index % 4];
}

function formatTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
