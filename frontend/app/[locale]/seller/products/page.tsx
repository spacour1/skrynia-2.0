"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, Rocket } from "lucide-react";
import { apiFetch, type Category, type Game, type GameSection } from "@/lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth-store";
import { initialForm } from "./_components/constants";
import { LotFormFields } from "./_components/LotFormFields";
import { PreviewCard } from "./_components/PreviewCard";
import { SalesTips } from "./_components/SalesTips";
import { SellerListings } from "./_components/SellerListings";
import type { EditProduct, LotForm, SelectedMedia, SellerProduct } from "./_components/types";
import { uploadImage } from "@/lib/storage";

export default function SellerProductsPage() {
  return (
    <RequireAuth>
      <SellerProductsContent />
    </RequireAuth>
  );
}

function SellerProductsContent() {
  const client = useQueryClient();
  const user = useAuth((state) => state.user);
  const [form, setForm] = useState<LotForm>(initialForm);
  const [error, setError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [media, setMedia] = useState<SelectedMedia[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [editing, setEditing] = useState<EditProduct | null>(null);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Category[] }>("/marketplace/categories")
  });
  const games = useQuery({
    queryKey: ["games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games")
  });
  const selectedGame = useMemo(() => games.data?.games.find((game) => game.id === form.gameId), [form.gameId, games.data?.games]);
  const gameDetail = useQuery({
    queryKey: ["game", selectedGame?.slug],
    queryFn: () => apiFetch<{ game: Game; sections: GameSection[] }>(`/marketplace/games/${selectedGame?.slug}`),
    enabled: Boolean(selectedGame?.slug)
  });
  const products = useQuery({
    queryKey: ["seller-products"],
    queryFn: () => apiFetch<{ products: SellerProduct[] }>("/marketplace/seller/products")
  });

  useEffect(() => {
    const saved = window.localStorage.getItem("seller-lot-draft");
    if (saved) {
      try {
        setForm({ ...initialForm, ...JSON.parse(saved) });
      } catch {
        window.localStorage.removeItem("seller-lot-draft");
      }
    }
  }, []);

  useEffect(() => {
    if (!form.categoryId && categories.data?.categories[0]) {
      setField("categoryId", categories.data.categories[0].id);
    }
  }, [categories.data?.categories, form.categoryId]);

  const create = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch("/marketplace/products", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["seller-products"] }),
    onError: (err) => setError(err instanceof Error ? err.message : "Could not create product")
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/marketplace/products/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      setEditing(null);
      return client.invalidateQueries({ queryKey: ["seller-products"] });
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/marketplace/products/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["seller-products"] })
  });

  function setField<K extends keyof LotForm>(key: K, value: LotForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDraftSaved(false);
  }

  function addMedia(files: FileList | File[]) {
    const picked = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, 10 - media.length))
      .map((file) => ({
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        previewUrl: URL.createObjectURL(file)
      }));
    setMedia((current) => [...current, ...picked].slice(0, 10));
  }

  function removeMedia(id: string) {
    setMedia((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function uploadMedia() {
    const urls: string[] = [];
    const uploadIds: string[] = [];
    for (const item of media) {
      const uploaded = await uploadImage(item.file, "product_media");
      urls.push(uploaded.url);
      uploadIds.push(uploaded.id);
    }
    setUploadedUrls(urls);
    return uploadIds;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!form.categoryId) {
      setError("Выберите категорию лота.");
      return;
    }

    try {
      const mediaUploadIds = await uploadMedia();
      await create.mutateAsync({
        title: form.title,
        description: form.description,
        categoryId: form.categoryId,
        gameId: form.gameId || null,
        sectionId: form.sectionId || null,
        price: form.price.trim(),
        oldPrice: form.oldPrice.trim() ? form.oldPrice.trim() : null,
        currency: form.currency,
        stock: Number(form.stock),
        deliveryType: form.deliveryType,
        productType: form.productType,
        server: form.server || null,
        platform: form.platform || null,
        deliveryTemplate: form.deliveryTemplate || null,
        metadata: {
          shortDescription: form.shortDescription,
          region: form.region || undefined,
          rank: form.rank || undefined,
          deliveryTime: form.deliveryTime,
          autoDelivery: form.autoDelivery
        },
        mediaUploadIds
      });
      media.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setMedia([]);
      setUploadedUrls([]);
      setForm({ ...initialForm, categoryId: categories.data?.categories[0]?.id ?? "" });
      window.localStorage.removeItem("seller-lot-draft");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось опубликовать лот");
    }
  }

  function saveDraft() {
    window.localStorage.setItem("seller-lot-draft", JSON.stringify(form));
    setDraftSaved(true);
  }

  const selectedCategory = categories.data?.categories.find((category) => category.id === form.categoryId);
  const selectedSection = gameDetail.data?.sections.find((section) => section.id === form.sectionId);
  const completion = calculateCompletion(form, media.length);

  return (
    <div className="mx-auto max-w-[1720px] space-y-6 px-3 py-5 sm:px-5 lg:px-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-4">
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-muted shadow-soft transition hover:border-brand/60 hover:text-ink" type="button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-extrabold tracking-normal text-ink">Создание лота</h1>
            <p className="mt-1 text-sm text-muted">Заполните информацию о товаре или услуге. Чем подробнее - тем выше продажи.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="app-button-secondary h-12 px-5" type="button" onClick={saveDraft}>
            <Bookmark className="h-5 w-5" />
            {draftSaved ? "Черновик сохранен" : "Сохранить как черновик"}
          </button>
          <button className="app-button-action h-12 px-6" form="create-lot-form" disabled={create.isPending}>
            <Rocket className="h-5 w-5" />
            {create.isPending ? "Публикуем..." : "Опубликовать лот"}
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <LotFormFields
          form={form}
          setField={setField}
          categories={categories.data?.categories}
          games={games.data?.games}
          sections={gameDetail.data?.sections}
          selectedGame={selectedGame}
          media={media}
          addMedia={addMedia}
          removeMedia={removeMedia}
          error={error}
          uploadedUrls={uploadedUrls}
          onSubmit={submit}
        />

        <aside className="space-y-5 xl:sticky xl:top-28 xl:self-start">
          <PreviewCard
            form={form}
            imageUrl={media[0]?.previewUrl}
            gameName={selectedGame?.name}
            sectionName={selectedSection?.name}
            categoryName={selectedCategory?.name}
            sellerName={user?.displayName ?? "Admin"}
          />
          <SalesTips completion={completion} />
        </aside>
      </div>

      <SellerListings products={products.data?.products ?? []} editing={editing} setEditing={setEditing} update={update.mutate} remove={remove.mutate} />
    </div>
  );
}

function calculateCompletion(form: LotForm, mediaCount: number) {
  const checks = [
    form.title,
    form.shortDescription,
    form.description,
    form.categoryId,
    form.productType,
    form.price,
    form.stock,
    form.deliveryType,
    form.deliveryTime,
    form.server || form.platform || form.region || form.rank,
    mediaCount > 0
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
