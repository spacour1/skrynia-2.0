"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Package, Plus, Store, Trash2 } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { SchemaBuilder } from "@/components/admin/catalog/SchemaBuilder";
import { ApiError } from "@/lib/api";
import { showAppToast } from "@/lib/toast-events";
import {
  catalogApi,
  type AdminCatalogGroup,
  type AdminCatalogItem,
  type AdminCatalogSection,
  type CatalogStatus
} from "@/lib/catalog-api";

type Selection =
  | { kind: "group"; id: string }
  | { kind: "item"; id: string; groupId: string }
  | { kind: "section"; id: string; itemId: string }
  | { kind: "new-group" }
  | { kind: "new-item"; groupId: string }
  | { kind: "new-section"; itemId: string }
  | null;

const STATUS_LABELS: Record<CatalogStatus, string> = {
  draft: "Черновик",
  active: "Активно",
  hidden: "Скрыто",
  archived: "В архиве",
  deleted: "Удалено"
};

const STATUS_COLORS: Record<CatalogStatus, string> = {
  draft: "bg-panel text-muted",
  active: "bg-emerald-500/15 text-emerald-500",
  hidden: "bg-amber-500/15 text-amber-500",
  archived: "bg-zinc-500/15 text-zinc-400",
  deleted: "bg-rose-500/15 text-rose-400"
};

export default function AdminCatalogPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminCatalogContent />
    </RequireAuth>
  );
}

function AdminCatalogContent() {
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
          <h1 className="text-lg font-black text-ink">Конструктор каталога</h1>
          <button className="app-button-secondary h-9 px-3 text-xs" onClick={() => setSelection({ kind: "new-group" })}>
            <Plus className="h-3.5 w-3.5" />
            Группа
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
            {!groups.length ? <p className="p-3 text-sm text-muted">Пока нет групп каталога.</p> : null}
          </div>
        )}
      </aside>

      <section className="app-card min-h-[400px] p-5">
        {selection ? (
          <DetailPanel selection={selection} groups={groups} onSelect={setSelection} />
        ) : (
          <div className="grid min-h-[360px] place-items-center text-center text-muted">
            Выберите элемент слева или создайте новую группу.
          </div>
        )}
      </section>
    </div>
  );
}

function GroupNode({
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
  const active = selection?.kind === "group" && selection.id === group.id;
  return (
    <div className="rounded-lg border border-line/60">
      <button
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition ${active ? "bg-brand/10 text-ink" : "hover:bg-panel/50"}`}
        onClick={() => onSelect({ kind: "group", id: group.id })}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 cursor-pointer text-muted transition ${expanded ? "rotate-90" : ""}`} onClick={(e) => { e.stopPropagation(); onToggle(); }} />
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
            Добавить item
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
  const active = selection?.kind === "item" && selection.id === item.id;
  return (
    <div className="rounded-lg border border-line/40">
      <button
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${active ? "bg-brand/10 text-ink" : "hover:bg-panel/40"}`}
        onClick={() => onSelect({ kind: "item", id: item.id, groupId })}
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 cursor-pointer text-muted transition ${expanded ? "rotate-90" : ""}`} onClick={(e) => { e.stopPropagation(); onToggle(); }} />
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
            Добавить раздел
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: CatalogStatus }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_COLORS[status]}`}>{STATUS_LABELS[status]}</span>;
}

function DetailPanel({ selection, groups, onSelect }: { selection: NonNullable<Selection>; groups: AdminCatalogGroup[]; onSelect: (s: Selection) => void }) {
  if (selection.kind === "new-group") return <GroupForm onSelect={onSelect} />;
  if (selection.kind === "group") {
    const group = groups.find((g) => g.id === selection.id);
    if (!group) return null;
    return <GroupForm group={group} onSelect={onSelect} />;
  }
  if (selection.kind === "new-item") return <ItemForm groupId={selection.groupId} onSelect={onSelect} />;
  if (selection.kind === "item") {
    const item = groups.flatMap((g) => g.items).find((i) => i.id === selection.id);
    if (!item) return null;
    return <ItemForm item={item} groupId={selection.groupId} onSelect={onSelect} />;
  }
  if (selection.kind === "new-section") return <SectionForm itemId={selection.itemId} onSelect={onSelect} />;
  if (selection.kind === "section") {
    const section = groups.flatMap((g) => g.items).flatMap((i) => i.sections).find((s) => s.id === selection.id);
    if (!section) return null;
    return <SectionForm section={section} itemId={selection.itemId} onSelect={onSelect} />;
  }
  return null;
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-rose-500/10 p-3 text-sm font-bold text-rose-400">{error instanceof ApiError ? error.message : "Что-то пошло не так"}</p>;
}

function GroupForm({ group, onSelect }: { group?: AdminCatalogGroup; onSelect: (s: Selection) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(group?.name ?? "");
  const [slug, setSlug] = useState(group?.slug ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const isDraft = !group || group.status === "draft";

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-tree"] });
  }

  const save = useMutation({
    mutationFn: () =>
      group
        ? catalogApi.updateGroup(group.id, { name, slug: isDraft ? slug : undefined, description })
        : catalogApi.createGroup({ name, slug, description }),
    onSuccess: (data) => {
      invalidate();
      showAppToast({ title: group ? "Группа обновлена" : "Группа создана" });
      if (!group) onSelect({ kind: "group", id: data.group.id });
    }
  });

  const setStatus = useMutation({
    mutationFn: (status: CatalogStatus) => catalogApi.updateGroup(group!.id, { status }),
    onSuccess: () => {
      invalidate();
      showAppToast({ title: "Статус обновлён" });
    }
  });

  const remove = useMutation({
    mutationFn: () => catalogApi.deleteGroup(group!.id),
    onSuccess: (result) => {
      invalidate();
      showAppToast({ title: result.hardDeleted ? "Группа удалена" : "Группа помечена как удалённая" });
      onSelect(null);
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-ink">{group ? "Группа каталога" : "Новая группа"}</h2>
        {group ? <StatusPill status={group.status} /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название">
          <input className="app-input h-10" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug">
          <input className="app-input h-10" value={slug} disabled={!isDraft} onChange={(e) => setSlug(e.target.value)} />
        </Field>
      </div>
      <Field label="Описание">
        <textarea className="app-input min-h-20" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <FormError error={save.error} />

      <div className="flex flex-wrap gap-2">
        <button className="app-button h-10 px-4" disabled={save.isPending || !name || !slug} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Сохранить
        </button>
        {group ? <StatusActions status={group.status} onSetStatus={(s) => setStatus.mutate(s)} /> : null}
        {group ? (
          <button className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10" onClick={() => remove.mutate()}>
            <Trash2 className="h-3.5 w-3.5" />
            Удалить
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ItemForm({ item, groupId, onSelect }: { item?: AdminCatalogItem; groupId: string; onSelect: (s: Selection) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(item?.name ?? "");
  const [slug, setSlug] = useState(item?.slug ?? "");
  const isDraft = !item || item.status === "draft";

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-tree"] });
  }

  const save = useMutation({
    mutationFn: () =>
      item
        ? catalogApi.updateItem(item.id, { name, slug: isDraft ? slug : undefined })
        : catalogApi.createItem({ groupId, name, slug }),
    onSuccess: (data) => {
      invalidate();
      showAppToast({ title: item ? "Item обновлён" : "Item создан" });
      if (!item) onSelect({ kind: "item", id: data.item.id, groupId });
    }
  });

  const setStatus = useMutation({
    mutationFn: (status: CatalogStatus) => catalogApi.updateItem(item!.id, { status }),
    onSuccess: () => {
      invalidate();
      showAppToast({ title: "Статус обновлён" });
    }
  });

  const remove = useMutation({
    mutationFn: () => catalogApi.deleteItem(item!.id),
    onSuccess: (result) => {
      invalidate();
      showAppToast({ title: result.hardDeleted ? "Item удалён" : "Item помечен как удалённый" });
      onSelect({ kind: "group", id: groupId });
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-ink">{item ? "Item каталога" : "Новый item"}</h2>
        {item ? <StatusPill status={item.status} /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название">
          <input className="app-input h-10" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug">
          <input className="app-input h-10" value={slug} disabled={!isDraft} onChange={(e) => setSlug(e.target.value)} />
        </Field>
      </div>

      <FormError error={save.error} />

      <div className="flex flex-wrap gap-2">
        <button className="app-button h-10 px-4" disabled={save.isPending || !name || !slug} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Сохранить
        </button>
        {item ? <StatusActions status={item.status} onSetStatus={(s) => setStatus.mutate(s)} /> : null}
        {item ? (
          <button className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10" onClick={() => remove.mutate()}>
            <Trash2 className="h-3.5 w-3.5" />
            Удалить
          </button>
        ) : null}
      </div>
    </div>
  );
}

const LISTING_TYPES = ["account", "key", "topup", "boosting", "service", "item", "currency"];
const DELIVERY_TYPES = ["manual", "instant", "service"];

function SectionForm({ section, itemId, onSelect }: { section?: AdminCatalogSection; itemId: string; onSelect: (s: Selection) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(section?.name ?? "");
  const [slug, setSlug] = useState(section?.slug ?? "");
  const [categoryId, setCategoryId] = useState(section?.categoryId ?? "");
  const [listingType, setListingType] = useState(section?.listingType ?? "service");
  const [deliveryTypes, setDeliveryTypes] = useState<string[]>(section?.allowedDeliveryTypes ?? ["manual", "instant"]);
  const isDraft = !section || section.status === "draft";

  const categories = useQuery({ queryKey: ["legacy-categories"], queryFn: () => catalogApi.categories() });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-tree"] });
  }

  const save = useMutation({
    mutationFn: () =>
      section
        ? catalogApi.updateSection(section.id, { name, slug: isDraft ? slug : undefined, categoryId, listingType, allowedDeliveryTypes: deliveryTypes })
        : catalogApi.createSection({ itemId, categoryId, name, slug, listingType, allowedDeliveryTypes: deliveryTypes }),
    onSuccess: (data) => {
      invalidate();
      showAppToast({ title: section ? "Раздел обновлён" : "Раздел создан" });
      if (!section) onSelect({ kind: "section", id: data.section.id, itemId });
    }
  });

  const publish = useMutation({
    mutationFn: () => catalogApi.publishSection(section!.id),
    onSuccess: () => {
      invalidate();
      showAppToast({ title: "Раздел опубликован" });
    },
    onError: (err) => showAppToast({ title: err instanceof ApiError ? err.message : "Не удалось опубликовать" })
  });
  const hide = useMutation({
    mutationFn: () => catalogApi.hideSection(section!.id),
    onSuccess: () => invalidate()
  });
  const archive = useMutation({
    mutationFn: () => catalogApi.archiveSection(section!.id),
    onSuccess: () => invalidate()
  });

  const remove = useMutation({
    mutationFn: () => catalogApi.deleteSection(section!.id),
    onSuccess: (result) => {
      invalidate();
      showAppToast({ title: result.hardDeleted ? "Раздел удалён" : "Раздел помечен как удалённый" });
      // itemId's real groupId isn't known here - deselect instead of guessing a wrong one.
      onSelect(null);
    },
    onError: (err) => showAppToast({ title: err instanceof ApiError ? err.message : "Не удалось удалить" })
  });

  function toggleDeliveryType(type: string) {
    setDeliveryTypes((current) => (current.includes(type) ? current.filter((t) => t !== type) : [...current, type]));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-ink">{section ? "Раздел каталога" : "Новый раздел"}</h2>
        {section ? <StatusPill status={section.status} /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название">
          <input className="app-input h-10" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug">
          <input className="app-input h-10" value={slug} disabled={!isDraft} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Listing type">
          <select className="app-input h-10" value={listingType} onChange={(e) => setListingType(e.target.value)}>
            {LISTING_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Категория (уровень риска)">
          <select className="app-input h-10" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Выберите категорию</option>
            {(categories.data?.categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} · risk: {category.riskLevel}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Способы доставки">
          <div className="flex flex-wrap gap-3 pt-2 text-sm font-bold text-muted">
            {DELIVERY_TYPES.map((type) => (
              <label key={type} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={deliveryTypes.includes(type)} onChange={() => toggleDeliveryType(type)} />
                {type}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <FormError error={save.error} />

      <div className="flex flex-wrap gap-2">
        <button className="app-button h-10 px-4" disabled={save.isPending || !name || !slug || !categoryId} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Сохранить
        </button>
        {section && section.status !== "active" ? (
          <button className="app-button-action h-10 px-4" disabled={publish.isPending} onClick={() => publish.mutate()}>
            Опубликовать
          </button>
        ) : null}
        {section && section.status === "active" ? (
          <button className="app-button-secondary h-10 px-4" disabled={hide.isPending} onClick={() => hide.mutate()}>
            Скрыть
          </button>
        ) : null}
        {section && section.status !== "archived" ? (
          <button className="app-button-secondary h-10 px-4" disabled={archive.isPending} onClick={() => archive.mutate()}>
            В архив
          </button>
        ) : null}
        {section ? (
          <button className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10" onClick={() => remove.mutate()}>
            <Trash2 className="h-3.5 w-3.5" />
            Удалить
          </button>
        ) : null}
      </div>

      {section ? (
        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-black uppercase text-brand">Схема параметров ({section.productCount} лотов)</h3>
          <div className="mt-3">
            <SchemaBuilder sectionId={section.id} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusActions({ status, onSetStatus }: { status: CatalogStatus; onSetStatus: (status: CatalogStatus) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("active")}>
          Опубликовать
        </button>
      ) : null}
      {status !== "hidden" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("hidden")}>
          Скрыть
        </button>
      ) : null}
      {status !== "archived" ? (
        <button className="app-button-secondary h-10 px-3 text-xs" onClick={() => onSetStatus("archived")}>
          В архив
        </button>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
