import type { CatalogStatus } from "@/lib/catalog-api";

export type Selection =
  | { kind: "group"; id: string }
  | { kind: "item"; id: string; groupId: string }
  | { kind: "section"; id: string; itemId: string }
  | { kind: "new-group" }
  | { kind: "new-item"; groupId: string }
  | { kind: "new-section"; itemId: string }
  | null;

export const STATUS_COLORS: Record<CatalogStatus, string> = {
  draft: "bg-panel text-muted",
  active: "bg-emerald-500/15 text-emerald-500",
  hidden: "bg-amber-500/15 text-amber-500",
  archived: "bg-zinc-500/15 text-zinc-400",
  deleted: "bg-rose-500/15 text-rose-400"
};
