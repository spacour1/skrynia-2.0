"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { useI18n } from "@/lib/i18n";
import { catalogApi, type AdminCatalogGroup } from "@/lib/catalog-api";
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

  const tree = useQuery({
    queryKey: ["admin-catalog-tree"],
    queryFn: () => catalogApi.adminTree()
  });
  const groups = tree.data?.groups ?? [];

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
          <h1 className="text-lg font-black text-ink">{t("adminCatalog.title")}</h1>
          <button className="app-button-secondary h-9 px-3 text-xs" onClick={() => setSelection({ kind: "new-group" })}>
            <Plus className="h-3.5 w-3.5" />
            {t("adminCatalog.addGroup")}
          </button>
        </div>

        {tree.isLoading ? (
          <div className="grid min-h-[200px] place-items-center text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {groups.map((group) => (
              <GroupNode
                key={group.id}
                group={group}
                expanded={expandedGroups.has(group.id)}
                expandedItems={expandedItems}
                onToggle={() => toggle(expandedGroups, setExpandedGroups, group.id)}
                onToggleItem={(itemId) => toggle(expandedItems, setExpandedItems, itemId)}
                selection={selection}
                onSelect={setSelection}
              />
            ))}
            {!groups.length ? <p className="p-3 text-sm text-muted">{t("adminCatalog.emptyGroups")}</p> : null}
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
    if (!group) return null;
    return <GroupForm key={group.id} group={group} onSelect={onSelect} />;
  }
  if (selection.kind === "new-item") return <ItemForm key={`new-item:${selection.groupId}`} groupId={selection.groupId} onSelect={onSelect} />;
  if (selection.kind === "item") {
    const item = groups.flatMap((g) => g.items).find((i) => i.id === selection.id);
    if (!item) return null;
    return <ItemForm key={item.id} item={item} groupId={selection.groupId} onSelect={onSelect} />;
  }
  if (selection.kind === "new-section") return <SectionForm key={`new-section:${selection.itemId}`} itemId={selection.itemId} onSelect={onSelect} />;
  if (selection.kind === "section") {
    const section = groups.flatMap((g) => g.items).flatMap((i) => i.sections).find((s) => s.id === selection.id);
    if (!section) return null;
    return <SectionForm key={section.id} section={section} itemId={selection.itemId} onSelect={onSelect} />;
  }
  return null;
}
