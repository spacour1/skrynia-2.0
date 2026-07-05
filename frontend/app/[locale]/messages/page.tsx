"use client";

import { useEffect, useMemo, useState } from "react";
import Link, { useRouter } from "@/lib/navigation";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, Flag, MessageCircle, Package, ReceiptText, Search, UserRound } from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { RequireAuth } from "@/components/RequireAuth";
import { ReportModal } from "@/components/ReportModal";
import { apiFetch, money, type ConversationContext, type ConversationGroup } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const ACTIVE_ORDER_STATUSES = ["pending", "paid", "in_progress", "delivered", "disputed"];
const EXPANDED_GROUPS_STORAGE_KEY = "skrynia:messages:expanded-groups";

export default function MessagesPage() {
  return (
    <RequireAuth>
      <MessagesContent />
    </RequireAuth>
  );
}

function MessagesContent() {
  const { t } = useI18n();
  const router = useRouter();
  const chatTabs: Array<[string, string]> = [
    ["all", t("messages.tabAll")],
    ["active", t("messages.tabActive")],
    ["finished", t("messages.tabFinished")]
  ];
  const searchParams = useSearchParams();
  const selectedFromQuery = searchParams.get("conversationId") ?? "";
  const [selectedConversationId, setSelectedConversationId] = useState(selectedFromQuery);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [reportTargetUserId, setReportTargetUserId] = useState<string | null>(null);
  const conversations = useQuery({
    queryKey: ["chat-conversations-grouped"],
    queryFn: () => apiFetch<{ groups: ConversationGroup[] }>("/chat/conversations/grouped")
  });

  const allGroups = conversations.data?.groups ?? [];
  const hasSearch = Boolean(q.trim());

  useEffect(() => {
    if (selectedFromQuery) setSelectedConversationId(selectedFromQuery);
  }, [selectedFromQuery]);

  useEffect(() => {
    const stored = window.localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setExpandedGroupIds(new Set(parsed.filter((item): item is string => typeof item === "string")));
      }
    } catch {
      window.localStorage.removeItem(EXPANDED_GROUPS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(EXPANDED_GROUPS_STORAGE_KEY, JSON.stringify(Array.from(expandedGroupIds)));
  }, [expandedGroupIds]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allGroups
      .map((group) => {
        const totalContextCount = group.contexts.length;
        const peerMatches = !term || group.peerDisplayName.toLowerCase().includes(term) || group.peerUserId.toLowerCase().includes(term);
        const contexts = group.contexts.filter((context) => {
          const active = contextIsActive(context);
          const matchesTab = tab === "all" || (tab === "active" && active) || (tab === "finished" && !active);
          if (!matchesTab) return false;
          if (peerMatches) return true;
          return contextSearchText(context, t).includes(term);
        });
        return { ...group, contexts, totalContextCount };
      })
      .filter((group) => group.contexts.length > 0);
  }, [allGroups, q, tab, t]);

  const selected = selectedConversationId || filtered[0]?.contexts[0]?.conversationId || "";
  const selectedGroup =
    filtered.find((group) => group.contexts.some((context) => context.conversationId === selected)) ??
    allGroups.find((group) => group.contexts.some((context) => context.conversationId === selected));
  const selectedContext = selectedGroup?.contexts.find((context) => context.conversationId === selected);

  // Auto-expand the active conversation's group once when it becomes selected, without
  // permanently forcing it open - otherwise the user could never collapse that group again.
  useEffect(() => {
    if (!selectedGroup) return;
    setExpandedGroupIds((current) =>
      current.has(selectedGroup.peerUserId) ? current : new Set(current).add(selectedGroup.peerUserId)
    );
  }, [selectedGroup?.peerUserId]);

  function selectConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    router.replace(`/messages?conversationId=${conversationId}`);
  }

  function toggleGroup(peerUserId: string) {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(peerUserId)) {
        next.delete(peerUserId);
      } else {
        next.add(peerUserId);
      }
      return next;
    });
  }

  return (
    <div className="grid min-h-[calc(100vh-130px)] overflow-hidden rounded-lg border border-line bg-card shadow-lift lg:grid-cols-[400px_minmax(0,1fr)]">
      <aside className="border-b border-line bg-card lg:border-b-0 lg:border-r">
        <div className="border-b border-line p-5">
          <h1 className="text-2xl font-black text-ink">{t("messages.title")}</h1>
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="app-input h-12 w-full pl-10" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("messages.searchPlaceholder")} />
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
          {filtered.map((group, index) => {
            const expanded = hasSearch || expandedGroupIds.has(group.peerUserId);
            // Collapsed groups show the open chat if it belongs here, so collapsing never
            // hides the conversation the user is currently reading; otherwise fall back to
            // the most recent active context.
            const collapsedContext =
              group.contexts.find((context) => context.conversationId === selected) ??
              group.contexts.find(contextIsActive) ??
              group.contexts[0];
            const visibleContexts = expanded ? group.contexts : collapsedContext ? [collapsedContext] : [];

            return (
              <article key={group.peerUserId} className="mb-2 rounded-xl border border-line/60 bg-surface/35 p-2">
                <div
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-panel/45"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleGroup(group.peerUserId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleGroup(group.peerUserId);
                    }
                  }}
                >
                  <Link
                    className="shrink-0 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/60"
                    href={`/users/${group.peerUserId}`}
                    aria-label={t("messages.openUserProfile")}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <GroupAvatar group={group} index={index} size="md" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        className="min-w-0 truncate font-black text-ink transition hover:text-brand"
                        href={`/users/${group.peerUserId}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {group.peerDisplayName}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-black text-muted">{group.totalContextCount}</span>
                        {group.totalUnreadCount ? <UnreadBadge count={group.totalUnreadCount} /> : null}
                        <span className="text-xs text-muted">{formatTime(group.lastMessageAt)}</span>
                        <ChevronDown className={`h-4 w-4 text-muted transition ${expanded ? "rotate-180" : ""}`} />
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-bold text-muted">{group.lastMessageBody || t("messages.selectContext")}</p>
                  </div>
                </div>

                <div className="mt-1 space-y-1">
                  {visibleContexts.map((context) => {
                    const active = selected === context.conversationId;
                    return (
                      <button
                        key={context.conversationId}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                          active ? "bg-brand/12 text-ink ring-1 ring-brand/45" : "text-muted hover:bg-panel/65 hover:text-ink"
                        }`}
                        onClick={() => selectConversation(context.conversationId)}
                      >
                        <ContextIcon type={context.type} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black">{contextTitle(context, t)}</span>
                          <span className="mt-0.5 block truncate text-xs">{context.lastMessageBody || contextSubtitle(context, t)}</span>
                        </span>
                        {context.unreadCount ? <UnreadBadge count={context.unreadCount} /> : null}
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
          {!filtered.length ? (
            <div className="grid min-h-[240px] place-items-center p-6 text-center">
              <div>
                <MessageCircle className="mx-auto h-10 w-10 text-muted" />
                <p className="mt-3 text-sm text-muted">{t("messages.noChats")}</p>
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="min-w-0 bg-surface/30">
        {selected && selectedGroup && selectedContext ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-line bg-card px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <Link
                    className="shrink-0 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/60"
                    href={`/users/${selectedGroup.peerUserId}`}
                    aria-label={t("messages.openUserProfile")}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <GroupAvatar group={selectedGroup} index={0} size="lg" />
                  </Link>
                  <div className="min-w-0">
                    <Link
                      className="block truncate text-base font-black text-ink transition hover:text-brand"
                      href={`/users/${selectedGroup.peerUserId}`}
                      aria-label={t("messages.openUserProfile")}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {selectedGroup.peerDisplayName}
                    </Link>
                    <p className="truncate text-sm text-muted">{contextTitle(selectedContext, t)}</p>
                    {selectedContext.orderId ? (
                      <p className="mt-1 text-sm text-muted">
                        {t("messages.order")} #{selectedContext.orderId.slice(0, 8)} /{" "}
                        {money(selectedContext.amountCents ?? 0, selectedContext.currency ?? "UAH", { preserveCurrency: true })}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="app-button-secondary h-10 px-3 text-sm"
                    onClick={() => setReportTargetUserId(selectedGroup.peerUserId)}
                  >
                    <Flag className="h-4 w-4" />
                    {t("messages.report")}
                  </button>
                  {selectedContext.orderId ? (
                    <Link className="app-button-secondary hidden h-10 px-3 text-sm sm:inline-flex" href={`/orders/${selectedContext.orderId}`}>
                      {t("messages.openOrder")}
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
            <ChatPanel
              conversationId={selected}
              disabledNotice={selectedContext.blocked ? t("messages.blockedNotice") : undefined}
            />
          </div>
        ) : (
          <section className="grid min-h-[620px] place-items-center p-8 text-center text-muted">
            {t("messages.selectChat")}
          </section>
        )}
      </section>

      {reportTargetUserId ? <ReportModal kind="user" targetId={reportTargetUserId} onClose={() => setReportTargetUserId(null)} /> : null}
    </div>
  );
}

function contextIsActive(context: ConversationContext) {
  return !context.orderStatus || ACTIVE_ORDER_STATUSES.includes(context.orderStatus);
}

function contextTitle(context: ConversationContext, t: (key: string, params?: Record<string, string | number>) => string) {
  if (context.type === "direct") return t("messages.contextDirect");
  if (context.type === "order") return t("messages.contextOrder", { id: context.orderId?.slice(0, 8) ?? "" });
  return context.productTitle ?? context.label;
}

function contextSubtitle(context: ConversationContext, t: (key: string) => string) {
  if (context.type === "direct") return t("messages.contextDirectHint");
  if (context.type === "order") return context.orderStatus ?? t("messages.contextOrderHint");
  return t("messages.contextProductHint");
}

function contextSearchText(context: ConversationContext, t: (key: string, params?: Record<string, string | number>) => string) {
  return [
    context.conversationId,
    contextTitle(context, t),
    context.productTitle,
    context.orderId,
    context.orderStatus,
    context.lastMessageBody
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function GroupAvatar({ group, index, size }: { group: ConversationGroup; index: number; size: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 text-lg" : "h-12 w-12 text-sm";

  return (
    <span className={`relative grid ${box} shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br ${avatarGradient(index)} font-black text-white`}>
      {group.peerAvatarUrl ? <img className="h-full w-full object-cover" src={group.peerAvatarUrl} alt="" /> : group.peerDisplayName.slice(0, 1).toUpperCase()}
      {group.isOnline ? <span className="absolute bottom-1 right-1 h-3 w-3 rounded-full border-2 border-card bg-emerald-400" /> : null}
    </span>
  );
}

function ContextIcon({ type }: { type: ConversationContext["type"] }) {
  const Icon = type === "order" ? ReceiptText : type === "product" ? Package : UserRound;
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel text-brand">
      <Icon className="h-4 w-4" />
    </span>
  );
}

function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-black text-stone-950">
      {count}
    </span>
  );
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
