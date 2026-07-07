"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { showAppToast } from "@/lib/toast-events";
import { catalogApi, type AdminCatalogGroup, type CatalogStatus } from "@/lib/catalog-api";
import { Field, FormError, StatusActions, StatusPill } from "./catalog-ui";
import type { Selection } from "./types";
import { useAutoSlug } from "./useAutoSlug";

export function GroupForm({ group, onSelect }: { group?: AdminCatalogGroup; onSelect: (s: Selection) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState(group?.name ?? "");
  const isDraft = !group || group.status === "draft";
  const { slug, setSlug } = useAutoSlug(name, group?.slug ?? "", isDraft);
  const [description, setDescription] = useState(group?.description ?? "");
  const [icon, setIcon] = useState(group?.icon ?? "");
  const [sortOrder, setSortOrder] = useState(group?.sortOrder ?? 0);
  const [seoTitle, setSeoTitle] = useState(group?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(group?.seoDescription ?? "");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-tree"] });
  }

  const save = useMutation({
    mutationFn: () =>
      group
        ? catalogApi.updateGroup(group.id, {
            name,
            slug: isDraft ? slug : undefined,
            description,
            icon: icon || null,
            sortOrder,
            seoTitle: seoTitle || null,
            seoDescription: seoDescription || null
          })
        : catalogApi.createGroup({ name, slug, description, icon: icon || undefined, sortOrder, seoTitle: seoTitle || undefined, seoDescription: seoDescription || undefined }),
    onSuccess: (data) => {
      invalidate();
      showAppToast({ title: group ? t("adminCatalog.group.updated") : t("adminCatalog.group.created") });
      if (!group) onSelect({ kind: "group", id: data.group.id });
    }
  });

  const setStatus = useMutation({
    mutationFn: (status: CatalogStatus) => catalogApi.updateGroup(group!.id, { status }),
    onSuccess: () => {
      invalidate();
      showAppToast({ title: t("adminCatalog.statusUpdated") });
    }
  });

  const remove = useMutation({
    mutationFn: () => catalogApi.deleteGroup(group!.id),
    onSuccess: (result) => {
      invalidate();
      showAppToast({ title: result.hardDeleted ? t("adminCatalog.group.deletedHard") : t("adminCatalog.group.deletedSoft") });
      onSelect(null);
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-ink">{group ? t("adminCatalog.group.title") : t("adminCatalog.group.newTitle")}</h2>
        {group ? <StatusPill status={group.status} /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("adminCatalog.nameLabel")}>
          <input className="app-input h-10" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug">
          <input className="app-input h-10" value={slug} disabled={!isDraft} onChange={(e) => setSlug(e.target.value)} />
        </Field>
      </div>
      <Field label={t("adminCatalog.descriptionLabel")}>
        <textarea className="app-input min-h-20" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("adminCatalog.iconLabel")}>
          <input className="app-input h-10" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </Field>
        <Field label={t("adminCatalog.sortOrderLabel")}>
          <input className="app-input h-10" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("adminCatalog.seoTitleLabel")}>
          <input className="app-input h-10" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
        </Field>
        <Field label={t("adminCatalog.seoDescriptionLabel")}>
          <input className="app-input h-10" value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} />
        </Field>
      </div>

      <FormError error={save.error} />

      <div className="flex flex-wrap gap-2">
        <button className="app-button h-10 px-4" disabled={save.isPending || !name || !slug} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("adminCatalog.save")}
        </button>
        {group ? <StatusActions status={group.status} onSetStatus={(s) => setStatus.mutate(s)} /> : null}
        {group ? (
          <button className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10" onClick={() => remove.mutate()}>
            <Trash2 className="h-3.5 w-3.5" />
            {t("adminCatalog.delete")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
