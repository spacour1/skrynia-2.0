"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { showAppToast } from "@/lib/toast-events";
import { catalogApi, type AdminCatalogItem, type CatalogStatus } from "@/lib/catalog-api";
import { Field, FormError, ImageSlot, StatusActions, StatusPill, Toggle } from "./catalog-ui";
import type { Selection } from "./types";
import { useAutoSlug } from "./useAutoSlug";

const TABS = ["main", "images", "display", "search", "seo"] as const;
type Tab = (typeof TABS)[number];

type ItemDraft = {
  name: string;
  icon: string;
  banner: string;
  logoImage: string;
  backgroundImage: string;
  description: string;
  shortDescription: string;
  aliases: string[];
  showOnHomepage: boolean;
  isPopular: boolean;
  isRecommended: boolean;
  homepageOrder: number;
  sortOrder: number;
  seoTitle: string;
  seoDescription: string;
};

function draftFromItem(item?: AdminCatalogItem): ItemDraft {
  return {
    name: item?.name ?? "",
    icon: item?.icon ?? "",
    banner: item?.banner ?? "",
    logoImage: item?.logoImage ?? "",
    backgroundImage: item?.backgroundImage ?? "",
    description: item?.description ?? "",
    shortDescription: item?.shortDescription ?? "",
    aliases: item?.aliases ?? [],
    showOnHomepage: item?.showOnHomepage ?? true,
    isPopular: item?.isPopular ?? false,
    isRecommended: item?.isRecommended ?? false,
    homepageOrder: item?.homepageOrder ?? 0,
    sortOrder: item?.sortOrder ?? 0,
    seoTitle: item?.seoTitle ?? "",
    seoDescription: item?.seoDescription ?? ""
  };
}

export function ItemForm({ item, groupId, onSelect }: { item?: AdminCatalogItem; groupId: string; onSelect: (s: Selection) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("main");
  const [draft, setDraft] = useState<ItemDraft>(() => draftFromItem(item));
  const [savedDraft, setSavedDraft] = useState<ItemDraft>(() => draftFromItem(item));
  const [aliasInput, setAliasInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDraft = !item || item.status === "draft";
  const { slug, setSlug } = useAutoSlug(draft.name, item?.slug ?? "", isDraft);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(savedDraft) || (isDraft && slug !== (item?.slug ?? "")), [draft, savedDraft, isDraft, slug, item?.slug]);

  function set<K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-tree"] });
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name,
        icon: draft.icon || null,
        banner: draft.banner || null,
        logoImage: draft.logoImage || null,
        backgroundImage: draft.backgroundImage || null,
        description: draft.description || null,
        shortDescription: draft.shortDescription || null,
        aliases: draft.aliases,
        showOnHomepage: draft.showOnHomepage,
        isPopular: draft.isPopular,
        isRecommended: draft.isRecommended,
        homepageOrder: draft.homepageOrder,
        sortOrder: draft.sortOrder,
        seoTitle: draft.seoTitle || null,
        seoDescription: draft.seoDescription || null
      };
      return item
        ? catalogApi.updateItem(item.id, { ...payload, slug: isDraft ? slug : undefined })
        : catalogApi.createItem({
            groupId,
            slug,
            ...Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value === null ? undefined : value]))
          } as Parameters<typeof catalogApi.createItem>[0]);
    },
    onSuccess: (data) => {
      invalidate();
      setSavedDraft(draft);
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

  const canSave = Boolean(draft.name && slug) && !save.isPending;

  // Ctrl+S saves; native beforeunload warns about unsaved edits on tab close/refresh.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSave && dirty) save.mutate();
      }
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirty) event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [canSave, dirty, save]);

  function addAlias() {
    const value = aliasInput.trim();
    if (!value || draft.aliases.includes(value)) return;
    set("aliases", [...draft.aliases, value]);
    setAliasInput("");
  }

  const seoTitlePreview = draft.seoTitle || draft.name || t("adminCatalog.item.title");
  const seoDescriptionPreview = draft.seoDescription || draft.shortDescription || draft.description;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-black text-ink">{item ? draft.name || t("adminCatalog.item.title") : t("adminCatalog.item.newTitle")}</h2>
          {item ? <StatusPill status={item.status} /> : null}
        </div>
        {dirty ? <span className="rounded-full bg-action/15 px-2 py-0.5 text-[10px] font-black uppercase text-action">{t("adminCatalog.unsaved")}</span> : null}
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel/40 p-1">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-black transition ${tab === key ? "bg-brand text-stone-950" : "text-muted hover:bg-panel hover:text-ink"}`}
            onClick={() => setTab(key)}
          >
            {t(`adminCatalog.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === "main" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("adminCatalog.nameLabel")}>
              <input className="app-input h-10 w-full" value={draft.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Slug">
              <input className="app-input h-10 w-full" value={slug} disabled={!isDraft} onChange={(e) => setSlug(e.target.value)} />
            </Field>
          </div>
          {!isDraft ? <p className="text-[11px] text-muted">{t("adminCatalog.item.slugLocked")}</p> : null}
          <Field label={t("adminCatalog.item.shortDescriptionLabel")}>
            <input className="app-input h-10 w-full" maxLength={300} value={draft.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} />
          </Field>
          <Field label={t("adminCatalog.item.descriptionLabel")}>
            <textarea className="app-input min-h-[110px] w-full" maxLength={2000} value={draft.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </div>
      ) : null}

      {tab === "images" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ImageSlot label={t("adminCatalog.iconLabel")} hint={t("adminCatalog.images.iconHint")} value={draft.icon} onChange={(url) => set("icon", url)} />
          <ImageSlot label={t("adminCatalog.images.logoLabel")} hint={t("adminCatalog.images.logoHint")} value={draft.logoImage} onChange={(url) => set("logoImage", url)} />
          <div className="sm:col-span-2">
            <ImageSlot label={t("adminCatalog.bannerLabel")} hint={t("adminCatalog.images.bannerHint")} value={draft.banner} onChange={(url) => set("banner", url)} wide />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <ImageSlot
              label={t("adminCatalog.images.backgroundLabel")}
              hint={t("adminCatalog.images.backgroundHint")}
              value={draft.backgroundImage}
              onChange={(url) => set("backgroundImage", url)}
              wide
            />
          </div>
        </div>
      ) : null}

      {tab === "display" ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label={t("adminCatalog.display.homepage")} hint={t("adminCatalog.display.homepageHint")} checked={draft.showOnHomepage} onChange={(v) => set("showOnHomepage", v)} />
            <Toggle label={t("adminCatalog.display.popular")} hint={t("adminCatalog.display.popularHint")} checked={draft.isPopular} onChange={(v) => set("isPopular", v)} />
            <Toggle label={t("adminCatalog.display.recommended")} hint={t("adminCatalog.display.recommendedHint")} checked={draft.isRecommended} onChange={(v) => set("isRecommended", v)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("adminCatalog.display.homepageOrderLabel")}>
              <input className="app-input h-10 w-full" type="number" value={draft.homepageOrder} onChange={(e) => set("homepageOrder", Number(e.target.value) || 0)} />
            </Field>
            <Field label={t("adminCatalog.sortOrderLabel")}>
              <input className="app-input h-10 w-full" type="number" value={draft.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value) || 0)} />
            </Field>
          </div>
          {item ? (
            <div className="rounded-lg border border-line bg-panel/40 p-3">
              <p className="text-xs font-black uppercase text-muted">{t("adminCatalog.display.whereShown")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <a className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline" href={`/games/${item.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" />
                  {t("adminCatalog.display.openGamePage")}
                </a>
                <a className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline" href="/" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" />
                  {t("adminCatalog.display.openHomepage")}
                </a>
                <a className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline" href={`/?q=${encodeURIComponent(draft.name)}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" />
                  {t("adminCatalog.display.checkSearch")}
                </a>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "search" ? (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-muted">{t("adminCatalog.searchTab.hint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {draft.aliases.map((alias) => (
              <span key={alias} className="inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-xs font-bold text-ink">
                {alias}
                <button type="button" className="text-muted hover:text-rose-400" onClick={() => set("aliases", draft.aliases.filter((a) => a !== alias))}>
                  ×
                </button>
              </span>
            ))}
            {!draft.aliases.length ? <span className="text-xs text-muted">{t("adminCatalog.searchTab.empty")}</span> : null}
          </div>
          <div className="flex gap-2">
            <input
              className="app-input h-10 flex-1"
              placeholder={t("adminCatalog.searchTab.placeholder")}
              value={aliasInput}
              maxLength={80}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAlias();
                }
              }}
            />
            <button type="button" className="app-button-secondary h-10 px-4 text-xs" onClick={addAlias} disabled={!aliasInput.trim()}>
              {t("adminCatalog.searchTab.add")}
            </button>
          </div>
        </div>
      ) : null}

      {tab === "seo" ? (
        <div className="space-y-3">
          <Field label={`${t("adminCatalog.seoTitleLabel")} (${draft.seoTitle.length}/200)`}>
            <input className="app-input h-10 w-full" maxLength={200} value={draft.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
          </Field>
          <Field label={`${t("adminCatalog.seoDescriptionLabel")} (${draft.seoDescription.length}/500)`}>
            <textarea className="app-input min-h-[90px] w-full" maxLength={500} value={draft.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
          </Field>
          <div className="rounded-lg border border-line bg-panel/40 p-4">
            <p className="mb-2 text-xs font-black uppercase text-muted">{t("adminCatalog.seoPreview")}</p>
            <p className="truncate text-base font-semibold text-sky-400">{seoTitlePreview}</p>
            <p className="truncate text-xs text-emerald-500">/games/{slug || "slug"}</p>
            {seoDescriptionPreview ? <p className="mt-1 line-clamp-2 text-sm text-muted">{seoDescriptionPreview}</p> : <p className="mt-1 text-sm italic text-muted/60">{t("adminCatalog.seoPreviewEmpty")}</p>}
          </div>
        </div>
      ) : null}

      <FormError error={save.error ?? setStatus.error ?? remove.error} />

      <div className="flex flex-wrap items-center gap-2">
        <button className="app-button h-10 px-4" disabled={!canSave} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {save.isPending ? t("adminCatalog.saving") : t("adminCatalog.save")}
        </button>
        {item ? <StatusActions status={item.status} onSetStatus={(s) => setStatus.mutate(s)} /> : null}
        {item && !confirmDelete ? (
          <button className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            {t("adminCatalog.delete")}
          </button>
        ) : null}
      </div>

      {item && confirmDelete ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4">
          <p className="text-sm font-black text-rose-400">{t("adminCatalog.deleteConfirm.title", { name: item.name })}</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            {t("adminCatalog.deleteConfirm.stats", { sections: item.sections.length, products: item.activeProductCount })}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">{t("adminCatalog.deleteConfirm.consequence")}</p>
          <div className="mt-3 flex gap-2">
            <button className="rounded-md bg-rose-500 px-3 py-2 text-xs font-black text-white hover:brightness-110" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? t("adminCatalog.saving") : t("adminCatalog.deleteConfirm.confirm")}
            </button>
            <button className="app-button-secondary h-8 px-3 text-xs" onClick={() => setConfirmDelete(false)}>
              {t("adminCatalog.deleteConfirm.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
