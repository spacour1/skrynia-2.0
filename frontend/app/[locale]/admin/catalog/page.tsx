"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";
import { catalogApi, type AdminCatalogGroup, type CatalogStatus } from "@/lib/catalog-api";
import { GroupNode } from "./_components/catalog-tree";
import { GroupForm } from "./_components/GroupForm";
import { ItemForm } from "./_components/ItemForm";
import { SectionForm } from "./_components/SectionForm";
import type { Selection } from "./_components/types";

export default function AdminCatalogPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminCatalogContent />
    </RequireAuth>
  );
}

function AdminCatalogContent() {
  const { t } = useI18n();
  const [selection, setSelection] = useState<Selection>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [treeSearch, setTreeSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CatalogStatus | "all">("all");

  const tree = useQuery({
    queryKey: ["admin-catalog-tree"],
    queryFn: () => catalogApi.adminTree()
  });
  const groups = tree.data?.groups ?? [];

  const activeItemCount = useMemo(() => groups.reduce((sum, group) => sum + group.items.filter((item) => item.status === "active").length, 0), [groups]);

  const filtering = Boolean(treeSearch.trim()) || statusFilter !== "all";
  const visibleGroups = useMemo(() => {
    if (!filtering) return groups;
    const query = treeSearch.trim().toLowerCase();
    return groups
      .map((group) => {
        const items = group.items.filter((item) => {
          if (statusFilter !== "all" && item.status !== statusFilter) return false;
          if (!query) return true;
          return (
            item.name.toLowerCase().includes(query) ||
            item.slug.toLowerCase().includes(query) ||
            (item.aliases ?? []).some((alias) => alias.toLowerCase().includes(query))
          );
        });
        const groupMatches = !query || group.name.toLowerCase().includes(query) || group.slug.toLowerCase().includes(query);
        if (!items.length && !(groupMatches && statusFilter === "all")) return null;
        return { ...group, items };
      })
      .filter((group): group is AdminCatalogGroup => group !== null);
  }, [groups, filtering, treeSearch, statusFilter]);

  function toggle(set: Set<string>, setter: (next: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="app-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black text-ink">{t("adminCatalog.title")}</h1>
            <p className="text-[11px] text-muted">{t("adminCatalog.activeCount", { count: activeItemCount })}</p>
          </div>
          <button className="app-button-secondary h-9 px-3 text-xs" onClick={() => setSelection({ kind: "new-group" })}>
            <Plus className="h-3.5 w-3.5" />
            {t("adminCatalog.addGroup")}
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              className="app-input h-9 w-full pl-8 text-sm"
              placeholder={t("adminCatalog.treeSearchPlaceholder")}
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
            />
          </div>
          <select className="app-input h-9 w-[110px] text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CatalogStatus | "all")}>
            <option value="all">{t("adminCatalog.filterAll")}</option>
            <option value="draft">{t("adminCatalog.status.draft")}</option>
            <option value="active">{t("adminCatalog.status.active")}</option>
            <option value="hidden">{t("adminCatalog.status.hidden")}</option>
            <option value="archived">{t("adminCatalog.status.archived")}</option>
          </select>
        </div>

        {tree.isLoading ? (
          <div className="grid min-h-[200px] place-items-center text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {visibleGroups.map((group) => (
              <GroupNode
                key={group.id}
                group={group}
                expanded={filtering || expandedGroups.has(group.id)}
                expandedItems={expandedItems}
                onToggle={() => toggle(expandedGroups, setExpandedGroups, group.id)}
                onToggleItem={(itemId) => toggle(expandedItems, setExpandedItems, itemId)}
                selection={selection}
                onSelect={setSelection}
              />
            ))}
            {!visibleGroups.length ? <p className="p-3 text-sm text-muted">{filtering ? t("adminCatalog.emptyFiltered") : t("adminCatalog.emptyGroups")}</p> : null}
          </div>
        )}
      </aside>

      <section className="app-card min-h-[400px] p-5">
        {selection ? (
          <DetailPanel selection={selection} groups={groups} onSelect={setSelection} />
        ) : (
          <div className="grid min-h-[360px] place-items-center text-center text-muted">
            {t("adminCatalog.selectPrompt")}
          </div>
        )}
      </section>
    </div>
  );
}

function DetailPanel({ selection, groups, onSelect }: { selection: NonNullable<Selection>; groups: AdminCatalogGroup[]; onSelect: (s: Selection) => void }) {
  if (selection.kind === "new-group") return <GroupForm key="new-group" onSelect={onSelect} />;
  if (selection.kind === "group") {
    const group = groups.find((g) => g.id === selection.id);
    if (!group) return <MissingSelection />;
    return <GroupForm key={group.id} group={group} onSelect={onSelect} />;
  }
  if (selection.kind === "new-item") return <ItemForm key={`new-item:${selection.groupId}`} groupId={selection.groupId} onSelect={onSelect} />;
  if (selection.kind === "item") {
    const item = groups.flatMap((g) => g.items).find((i) => i.id === selection.id);
    if (!item) return <MissingSelection />;
    return <ItemForm key={item.id} item={item} groupId={selection.groupId} onSelect={onSelect} />;
  }
  if (selection.kind === "new-section") return <SectionForm key={`new-section:${selection.itemId}`} itemId={selection.itemId} onSelect={onSelect} />;
  if (selection.kind === "section") {
    const section = groups.flatMap((g) => g.items).flatMap((i) => i.sections).find((s) => s.id === selection.id);
    if (!section) return <MissingSelection />;
    return <SectionForm key={section.id} section={section} itemId={selection.itemId} onSelect={onSelect} />;
  }
  return null;
}

function MissingSelection() {
  const { t } = useI18n();
  return <div className="grid min-h-[360px] place-items-center text-center text-sm text-muted">{t("adminCatalog.missingSelection")}</div>;
}
