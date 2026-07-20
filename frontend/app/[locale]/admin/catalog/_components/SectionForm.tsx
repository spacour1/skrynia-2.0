"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { SchemaBuilder } from "@/components/admin/catalog/SchemaBuilder";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { showAppToast } from "@/lib/toast-events";
import { catalogApi, type AdminCatalogSection } from "@/lib/catalog-api";
import { Field, FormError, StatusPill } from "./catalog-ui";
import type { Selection } from "./types";
import { useAutoSlug } from "./useAutoSlug";

const LISTING_TYPES = ["account", "key", "topup", "boosting", "service", "item", "currency"];
// "service" is a listing (product) type, not a delivery mechanism — the backend and
// products.delivery_type accept manual/instant only.
const DELIVERY_TYPES = ["manual", "instant"];

export function SectionForm({ section, itemId, onSelect }: { section?: AdminCatalogSection; itemId: string; onSelect: (s: Selection) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState(section?.name ?? "");
  const isDraft = !section || section.status === "draft";
  const { slug, setSlug } = useAutoSlug(name, section?.slug ?? "", isDraft);
  const [categoryId, setCategoryId] = useState(section?.categoryId ?? "");
  const [listingType, setListingType] = useState(section?.listingType ?? "service");
  const [deliveryTypes, setDeliveryTypes] = useState<string[]>(section?.allowedDeliveryTypes ?? ["manual", "instant"]);
  const [requiresModeration, setRequiresModeration] = useState(section?.requiresModeration ?? false);
  const [sortOrder, setSortOrder] = useState(section?.sortOrder ?? 0);
  const [seoTitle, setSeoTitle] = useState(section?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(section?.seoDescription ?? "");

  const categories = useQuery({ queryKey: ["legacy-categories"], queryFn: () => catalogApi.categories() });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-tree"] });
  }

  const save = useMutation({
    mutationFn: () =>
      section
        ? catalogApi.updateSection(section.id, {
            name,
            slug: isDraft ? slug : undefined,
            categoryId,
            listingType,
            allowedDeliveryTypes: deliveryTypes,
            requiresModeration,
            sortOrder,
            seoTitle: seoTitle || null,
            seoDescription: seoDescription || null
          })
        : catalogApi.createSection({
            itemId,
            categoryId,
            name,
            slug,
            listingType,
            allowedDeliveryTypes: deliveryTypes,
            requiresModeration,
            sortOrder,
            seoTitle: seoTitle || undefined,
            seoDescription: seoDescription || undefined
          }),
    onSuccess: (data) => {
      invalidate();
      showAppToast({ title: section ? t("adminCatalog.section.updated") : t("adminCatalog.section.created") });
      if (!section) onSelect({ kind: "section", id: data.section.id, itemId });
    }
  });

  const publish = useMutation({
    mutationFn: () => catalogApi.publishSection(section!.id),
    onSuccess: () => {
      invalidate();
      showAppToast({ title: t("adminCatalog.section.published") });
    },
    onError: (err) => showAppToast({ title: err instanceof ApiError ? err.message : t("adminCatalog.section.publishFailed") })
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
      showAppToast({ title: result.hardDeleted ? t("adminCatalog.section.deletedHard") : t("adminCatalog.section.deletedSoft") });
      // itemId's real groupId isn't known here - deselect instead of guessing a wrong one.
      onSelect(null);
    },
    onError: (err) => showAppToast({ title: err instanceof ApiError ? err.message : t("adminCatalog.section.deleteFailed") })
  });

  function toggleDeliveryType(type: string) {
    setDeliveryTypes((current) => (current.includes(type) ? current.filter((t) => t !== type) : [...current, type]));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-ink">{section ? t("adminCatalog.section.title") : t("adminCatalog.section.newTitle")}</h2>
        {section ? <StatusPill status={section.status} /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("adminCatalog.nameLabel")}>
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
        <Field label={t("adminCatalog.categoryLabel")}>
          <select className="app-input h-10" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("adminCatalog.selectCategory")}</option>
            {(categories.data?.categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {t("adminCatalog.categoryOption", { name: category.name, risk: category.riskLevel })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("adminCatalog.deliveryTypesLabel")}>
          <div className="flex flex-wrap gap-3 pt-2 text-sm font-bold text-muted">
            {DELIVERY_TYPES.map((type) => (
              <label key={type} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={deliveryTypes.includes(type)} onChange={() => toggleDeliveryType(type)} />
                {type}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t("adminCatalog.sortOrderLabel")}>
          <input className="app-input h-10" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
        </Field>
      </div>

      <label className="inline-flex items-center gap-1.5 text-sm font-bold text-muted">
        <input type="checkbox" checked={requiresModeration} onChange={(e) => setRequiresModeration(e.target.checked)} />
        {t("adminCatalog.requiresModerationLabel")}
      </label>

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
        <button className="app-button h-10 px-4" disabled={save.isPending || !name || !slug || !categoryId} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("adminCatalog.save")}
        </button>
        {section && section.status !== "active" ? (
          <button className="app-button-action h-10 px-4" disabled={publish.isPending} onClick={() => publish.mutate()}>
            {t("adminCatalog.publish")}
          </button>
        ) : null}
        {section && section.status === "active" ? (
          <button className="app-button-secondary h-10 px-4" disabled={hide.isPending} onClick={() => hide.mutate()}>
            {t("adminCatalog.hide")}
          </button>
        ) : null}
        {section && section.status !== "archived" ? (
          <button className="app-button-secondary h-10 px-4" disabled={archive.isPending} onClick={() => archive.mutate()}>
            {t("adminCatalog.archive")}
          </button>
        ) : null}
        {section ? (
          <button className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10" onClick={() => remove.mutate()}>
            <Trash2 className="h-3.5 w-3.5" />
            {t("adminCatalog.delete")}
          </button>
        ) : null}
      </div>

      {section ? (
        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-black uppercase text-brand">{t("adminCatalog.section.schemaTitle", { count: section.productCount })}</h3>
          <div className="mt-3">
            <SchemaBuilder sectionId={section.id} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
