"use client";

import { ChevronRight, Package, Plus, Store } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { AdminCatalogGroup, AdminCatalogItem } from "@/lib/catalog-api";
import { StatusPill } from "./catalog-ui";
import type { Selection } from "./types";

export function GroupNode({
  group,
  expanded,
  expandedItems,
  onToggle,
  onToggleItem,
  selection,
  onSelect
}: {
  group: AdminCatalogGroup;
  expanded: boolean;
  expandedItems: Set<string>;
  onToggle: () => void;
  onToggleItem: (itemId: string) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useI18n();
  const active = selection?.kind === "group" && selection.id === group.id;
  return (
    <div className="rounded-lg border border-line/60">
      <button
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition ${active ? "bg-brand/10 text-ink" : "hover:bg-panel/50"}`}
        onClick={() => onSelect({ kind: "group", id: group.id })}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 cursor-pointer text-muted transition ${expanded ? "rotate-90" : ""}`} onClick={(event) => { event.stopPropagation(); onToggle(); }} />
        <Store className="h-4 w-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate text-sm font-black">{group.name}</span>
        <StatusPill status={group.status} />
      </button>

      {expanded ? (
        <div className="space-y-1 border-t border-line/60 p-2 pl-6">
          {group.items.map((item) => (
            <ItemNode
              key={item.id}
              item={item}
              groupId={group.id}
              expanded={expandedItems.has(item.id)}
              onToggle={() => onToggleItem(item.id)}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
          <button className="mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-brand hover:bg-brand/10" onClick={() => onSelect({ kind: "new-item", groupId: group.id })}>
            <Plus className="h-3.5 w-3.5" />
            {t("adminCatalog.addItem")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ItemNode({
  item,
  groupId,
  expanded,
  onToggle,
  selection,
  onSelect
}: {
  item: AdminCatalogItem;
  groupId: string;
  expanded: boolean;
  onToggle: () => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useI18n();
  const active = selection?.kind === "item" && selection.id === item.id;
  return (
    <div className="rounded-lg border border-line/40">
      <button
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${active ? "bg-brand/10 text-ink" : "hover:bg-panel/40"}`}
        onClick={() => onSelect({ kind: "item", id: item.id, groupId })}
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 cursor-pointer text-muted transition ${expanded ? "rotate-90" : ""}`} onClick={(event) => { event.stopPropagation(); onToggle(); }} />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.name}</span>
        <StatusPill status={item.status} />
      </button>

      {expanded ? (
        <div className="space-y-1 border-t border-line/40 p-2 pl-5">
          {item.sections.map((section) => (
            <button
              key={section.id}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-bold transition ${
                selection?.kind === "section" && selection.id === section.id ? "bg-brand/10 text-ink" : "text-muted hover:bg-panel/40 hover:text-ink"
              }`}
              onClick={() => onSelect({ kind: "section", id: section.id, itemId: item.id })}
            >
              <Package className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{section.name}</span>
              <StatusPill status={section.status} />
            </button>
          ))}
          <button className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-brand hover:bg-brand/10" onClick={() => onSelect({ kind: "new-section", itemId: item.id })}>
            <Plus className="h-3.5 w-3.5" />
            {t("adminCatalog.addSection")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
