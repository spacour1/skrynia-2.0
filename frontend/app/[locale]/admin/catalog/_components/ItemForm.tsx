"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { showAppToast } from "@/lib/toast-events";
import { catalogApi, type AdminCatalogItem, type CatalogStatus } from "@/lib/catalog-api";
import { Field, FormError, StatusActions, StatusPill } from "./catalog-ui";
import type { Selection } from "./types";
import { useAutoSlug } from "./useAutoSlug";

export function ItemForm({ item, groupId, onSelect }: { item?: AdminCatalogItem; groupId: string; onSelect: (s: Selection) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState(item?.name ?? "");
  const isDraft = !item || item.status === "draft";
  const { slug, setSlug } = useAutoSlug(name, item?.slug ?? "", isDraft);
  const [icon, setIcon] = useState(item?.icon ?? "");
  const [banner, setBanner] = useState(item?.banner ?? "");
  const [sortOrder, setSortOrder] = useState(item?.sortOrder ?? 0);
  const [seoTitle, setSeoTitle] = useState(item?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(item?.seoDescription ?? "");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-tree"] });
  }

  const save = useMutation({
    mutationFn: () =>
      item
        ? catalogApi.updateItem(item.id, {
            name,
            slug: isDraft ? slug : undefined,
            icon: icon || null,
            banner: banner || null,
            sortOrder,
            seoTitle: seoTitle || null,
            seoDescription: seoDescription || null
          })
        : catalogApi.createItem({
            groupId,
            name,
            slug,
            icon: icon || undefined,
            banner: banner || undefined,
            sortOrder,
            seoTitle: seoTitle || undefined,
            seoDescription: seoDescription || undefined
          }),
    onSuccess: (data) => {
      invalidate();
      showAppToast({ title: item ? t("adminCatalog.item.updated") : t("adminCatalog.item.created") });
      if (!item) onSelect({ kind: "item", id: data.item.id, groupId });
    }
  });

  const setStatus = useMutation({
    mutationFn: (status: CatalogStatus) => catalogApi.updateItem(item!.id, { status }),
    onSuccess: () => {
      invalidate();
      showAppToast({ title: t("adminCatalog.statusUpdated") });
    }
  });

  const remove = useMutation({
    mutationFn: () => catalogApi.deleteItem(item!.id),
    onSuccess: (result) => {
      invalidate();
      showAppToast({ title: result.hardDeleted ? t("adminCatalog.item.deletedHard") : t("adminCatalog.item.deletedSoft") });
      onSelect({ kind: "group", id: groupId });
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-ink">{item ? t("adminCatalog.item.title") : t("adminCatalog.item.newTitle")}</h2>
        {item ? <StatusPill status={item.status} /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("adminCatalog.nameLabel")}>
          <input className="app-input h-10" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug">
          <input className="app-input h-10" value={slug} disabled={!isDraft} onChange={(e) => setSlug(e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("adminCatalog.iconLabel")}>
          <input className="app-input h-10" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </Field>
        <Field label={t("adminCatalog.bannerLabel")}>
          <input className="app-input h-10" value={banner} onChange={(e) => setBanner(e.target.value)} />
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
        {item ? <StatusActions status={item.status} onSetStatus={(s) => setStatus.mutate(s)} /> : null}
        {item ? (
          <button className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10" onClick={() => remove.mutate()}>
            <Trash2 className="h-3.5 w-3.5" />
            {t("adminCatalog.delete")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
