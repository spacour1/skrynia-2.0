"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronRight,
  Clock,
  CloudUpload,
  DollarSign,
  Eye,
  Gamepad2,
  ImageIcon,
  Info,
  Lock,
  Package,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Trash2,
  Truck,
  X
} from "lucide-react";
import { apiFetch, money, type Category, type Game, type GameSection } from "@/lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/auth-store";
import { productMediaUrls } from "@/lib/product-media";

type SellerProduct = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  stock: number;
  status: string;
  categoryName: string;
  gameName?: string;
  sectionName?: string;
  deliveryType?: string;
  productType?: string;
  oldPriceCents?: number | null;
  salesCount?: number;
  metadata?: Record<string, unknown>;
  media?: { id: string; url: string; type: string; status?: string }[];
};

type EditProduct = {
  id: string;
  title: string;
  description: string;
  price: string;
  stock: number;
};

type LotForm = {
  title: string;
  shortDescription: string;
  description: string;
  categoryId: string;
  gameId: string;
  sectionId: string;
  productType: string;
  price: string;
  oldPrice: string;
  currency: string;
  stock: string;
  server: string;
  platform: string;
  region: string;
  rank: string;
  deliveryType: "manual" | "instant";
  deliveryTime: string;
  deliveryTemplate: string;
  autoDelivery: boolean;
  instantPublication: boolean;
};

type SelectedMedia = {
  id: string;
  file: File;
  previewUrl: string;
};

const initialForm: LotForm = {
  title: "",
  shortDescription: "",
  description: "",
  categoryId: "",
  gameId: "",
  sectionId: "",
  productType: "service",
  price: "",
  oldPrice: "",
  currency: "UAH",
  stock: "1",
  server: "",
  platform: "",
  region: "",
  rank: "",
  deliveryType: "manual",
  deliveryTime: "instant",
  deliveryTemplate: "",
  autoDelivery: false,
  instantPublication: true
};

const productTypes = [
  ["account", "Аккаунт"],
  ["key", "Ключ / код"],
  ["topup", "Пополнение"],
  ["boosting", "Бустинг"],
  ["service", "Услуга"],
  ["item", "Предмет"],
  ["currency", "Валюта"]
];

const deliveryTimes: Record<string, string> = {
  instant: "Сразу после оплаты",
  hour: "До 1 часа",
  day: "До 24 часов"
};

const formSteps = [
  { title: "Основная информация", text: "Расскажите покупателям о вашем товаре или услуге.", icon: Package },
  { title: "Категория", text: "Выберите категорию и тип товара или услуги.", icon: Gamepad2 },
  { title: "Цена и наличие", text: "Укажите цену товара и количество.", icon: DollarSign },
  { title: "Характеристики", text: "Укажите параметры, которые важны для покупателя.", icon: Shield },
  { title: "Доставка", text: "Выберите способ доставки и сроки выполнения.", icon: Truck },
  { title: "Медиа", text: "Добавьте скриншоты или видео для доказательства.", icon: ImageIcon },
  { title: "Дополнительно", text: "Дополнительные опции для вашего лота.", icon: Star }
];

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
    for (const item of media) {
      const body = new FormData();
      body.append("file", item.file);
      const uploaded = await apiFetch<{ url: string }>("/storage/upload", { method: "POST", body });
      urls.push(uploaded.url);
    }
    setUploadedUrls(urls);
    return urls;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!form.categoryId) {
      setError("Выберите категорию лота.");
      return;
    }

    try {
      const mediaUrls = await uploadMedia();
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
        media: mediaUrls
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
        <form id="create-lot-form" className="space-y-2" onSubmit={submit}>
          <FormSection step={1}>
            <FieldBlock label="Название лота" required>
              <Input name="title" value={form.title} onChange={(event) => setField("title", event.target.value)} maxLength={100} placeholder="Введите название лота" required />
              <Counter>{form.title.length}/100</Counter>
            </FieldBlock>
            <FieldBlock label="Краткое описание" required>
              <Textarea name="shortDescription" value={form.shortDescription} onChange={(event) => setField("shortDescription", event.target.value)} maxLength={120} placeholder="Кратко опишите главное преимущество" rows={1} />
              <Counter>{form.shortDescription.length}/120</Counter>
            </FieldBlock>
            <FieldBlock label="Подробное описание" required className="md:col-span-2">
              <Textarea
                name="description"
                value={form.description}
                onChange={(event) => setField("description", event.target.value)}
                maxLength={3000}
                minLength={20}
                placeholder="Опишите товар или услугу максимально подробно: характеристики, преимущества, важные детали..."
                rows={3}
                required
              />
              <Counter>{form.description.length}/3000</Counter>
            </FieldBlock>
          </FormSection>

          <FormSection step={2}>
            <FieldBlock label="Тип товара" required>
              <Select name="productType" value={form.productType} onChange={(event) => setField("productType", event.target.value)}>
                {productTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FieldBlock>
            <FieldBlock label="Игра">
              <Select
                name="gameId"
                value={form.gameId}
                onChange={(event) => {
                  setField("gameId", event.target.value);
                  setField("sectionId", "");
                }}
              >
                <option value="">Выберите игру</option>
                {games.data?.games.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
              </Select>
            </FieldBlock>
            <FieldBlock label="Раздел игры">
              <Select name="sectionId" value={form.sectionId} onChange={(event) => setField("sectionId", event.target.value)} disabled={!selectedGame}>
                <option value="">Выберите раздел</option>
                {gameDetail.data?.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </Select>
            </FieldBlock>
            <FieldBlock label="Подкатегория / тип услуги" required className="md:col-span-3">
              <Select name="categoryId" value={form.categoryId} onChange={(event) => setField("categoryId", event.target.value)} required>
                <option value="">Выберите подкатегорию</option>
                {categories.data?.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </FieldBlock>
          </FormSection>

          <FormSection step={3}>
            <FieldBlock label="Цена" required>
              <Input name="price" value={form.price} onChange={(event) => setField("price", event.target.value)} type="number" step="0.01" min="0" placeholder="0.00" required />
            </FieldBlock>
            <FieldBlock label="Старая цена">
              <Input name="oldPrice" value={form.oldPrice} onChange={(event) => setField("oldPrice", event.target.value)} type="number" step="0.01" min="0" placeholder="0.00" />
              <Hint>Старая цена будет зачеркнута и отображаться как скидка.</Hint>
            </FieldBlock>
            <FieldBlock label="Валюта" required>
              <Select name="currency" value={form.currency} onChange={(event) => setField("currency", event.target.value)}>
                <option value="UAH">UAH</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </Select>
            </FieldBlock>
            <FieldBlock label="Количество" required>
              <Input name="stock" value={form.stock} onChange={(event) => setField("stock", event.target.value)} type="number" min="1" required />
            </FieldBlock>
          </FormSection>

          <FormSection step={4}>
            <FieldBlock label="Сервер">
              <Select name="server" value={form.server} onChange={(event) => setField("server", event.target.value)}>
                <option value="">Выберите сервер</option>
                <option value="EU">EU</option>
                <option value="NA">NA</option>
                <option value="CIS">CIS</option>
              </Select>
            </FieldBlock>
            <FieldBlock label="Платформа">
              <Select name="platform" value={form.platform} onChange={(event) => setField("platform", event.target.value)}>
                <option value="">Выберите платформу</option>
                <option value="Steam">Steam</option>
                <option value="PlayStation">PlayStation</option>
                <option value="Xbox">Xbox</option>
                <option value="Mobile">Mobile</option>
              </Select>
            </FieldBlock>
            <FieldBlock label="Регион">
              <Select name="region" value={form.region} onChange={(event) => setField("region", event.target.value)}>
                <option value="">Выберите регион</option>
                <option value="EU">EU</option>
                <option value="UA">UA</option>
                <option value="Global">Global</option>
              </Select>
            </FieldBlock>
            <FieldBlock label="Ранг / уровень" className="md:col-span-3">
              <Input name="rank" value={form.rank} onChange={(event) => setField("rank", event.target.value)} placeholder="Например: Gold 3 / 45 уровень" />
              <Hint>Если параметр не важен - оставьте пустым.</Hint>
            </FieldBlock>
          </FormSection>

          <FormSection step={5}>
            <FieldBlock label="Способ доставки" required>
              <Select name="deliveryType" value={form.deliveryType} onChange={(event) => setField("deliveryType", event.target.value as LotForm["deliveryType"])}>
                <option value="manual">Ручная доставка</option>
                <option value="instant">Мгновенная доставка</option>
              </Select>
            </FieldBlock>
            <FieldBlock label="Срок выполнения" required>
              <Select name="deliveryTime" value={form.deliveryTime} onChange={(event) => setField("deliveryTime", event.target.value)}>
                <option value="instant">Сразу после оплаты</option>
                <option value="hour">До 1 часа</option>
                <option value="day">До 24 часов</option>
              </Select>
            </FieldBlock>
            <FieldBlock label="Комментарий продавца">
              <Textarea
                name="deliveryTemplate"
                value={form.deliveryTemplate}
                onChange={(event) => setField("deliveryTemplate", event.target.value)}
                maxLength={500}
                placeholder="Дополнительная информация для покупателя о процессе доставки"
                rows={3}
              />
              <Counter>{form.deliveryTemplate.length}/500</Counter>
            </FieldBlock>
          </FormSection>

          <FormSection step={6}>
            <MediaUploader media={media} addMedia={addMedia} removeMedia={removeMedia} />
          </FormSection>

          <FormSection step={7}>
            <Toggle checked={form.autoDelivery} onChange={(checked) => setField("autoDelivery", checked)} name="autoDelivery" title="Автоматическая доставка" text="Покупатель получит товар сразу после оплаты." />
            <Toggle checked={form.instantPublication} onChange={(checked) => setField("instantPublication", checked)} name="instantPublication" title="Мгновенная публикация" text="Опубликовать лот сразу после нажатия кнопки." />
            <p className="text-xs text-muted">
              Отметки «Хит» и «Рекомендовано SKRYNIA» назначает администрация площадки — это нельзя включить самостоятельно.
            </p>
          </FormSection>

          {error ? <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p> : null}
          {uploadedUrls.length ? <p className="text-sm text-emerald-400">Загружено файлов: {uploadedUrls.length}</p> : null}
        </form>

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

function MediaUploader({ media, addMedia, removeMedia }: { media: SelectedMedia[]; addMedia: (files: FileList | File[]) => void; removeMedia: (id: string) => void }) {
  return (
    <div className="space-y-4 md:col-span-3">
      <label
        className="flex min-h-[112px] cursor-pointer items-center justify-center gap-4 rounded-lg border border-dashed border-line bg-card/45 px-4 text-center transition hover:border-brand/60 hover:bg-panel/50"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addMedia(event.dataTransfer.files);
        }}
      >
        <CloudUpload className="h-10 w-10 text-muted" />
        <span>
          <span className="block font-bold text-ink">Перетащите файлы сюда или нажмите для загрузки</span>
          <span className="mt-1 block text-sm text-muted">PNG, JPG, WEBP до 8 МБ, до 10 файлов.</span>
        </span>
        <input className="sr-only" name="media" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => event.target.files && addMedia(event.target.files)} />
      </label>
      {media.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {media.map((item) => (
            <div key={item.id} className="group relative overflow-hidden rounded-lg border border-line bg-panel">
              <img className="aspect-[4/3] w-full object-cover" src={item.previewUrl} alt={item.file.name} />
              <button className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-black/60 text-white opacity-100 transition hover:bg-rose-500 sm:opacity-0 sm:group-hover:opacity-100" type="button" onClick={() => removeMedia(item.id)}>
                <X className="h-4 w-4" />
              </button>
              <p className="truncate px-2 py-2 text-xs text-muted">{item.file.name}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FormSection({ step, children }: { step: number; children: React.ReactNode }) {
  const item = formSteps[step - 1];
  const Icon = item.icon;
  return (
    <section className="grid overflow-hidden rounded-lg border border-line bg-card/80 shadow-soft backdrop-blur md:grid-cols-[280px_1fr]">
      <div className="flex gap-4 border-b border-line bg-panel/30 p-5 md:border-b-0 md:border-r">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-action text-sm font-black text-stone-950 shadow-soft">{step}</span>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-card text-muted">
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <h2 className="font-extrabold text-ink">{item.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{item.text}</p>
        </div>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-3">{children}</div>
    </section>
  );
}

function FieldBlock({ label, required, className = "", children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`relative block space-y-1.5 ${className}`}>
      <span className="text-xs font-bold text-ink">
        {label} {required ? <span className="text-rose-400">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`app-input h-10 w-full bg-surface/80 pr-12 text-sm ${props.className ?? ""}`} />;
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`app-input min-h-10 w-full resize-none bg-surface/80 pr-16 text-sm ${props.className ?? ""}`} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`app-input h-10 w-full bg-surface/80 text-sm ${props.className ?? ""}`} />;
}

function Counter({ children }: { children: React.ReactNode }) {
  return <span className="absolute bottom-2 right-3 text-xs text-muted">{children}</span>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
      <Info className="h-3.5 w-3.5 text-action" />
      {children}
    </span>
  );
}

function Toggle({ name, title, text, checked, onChange, badge }: { name: string; title: string; text: string; checked: boolean; onChange: (checked: boolean) => void; badge?: string }) {
  return (
    <label className="flex items-start gap-3 rounded-lg p-1">
      <input className="peer sr-only" name={name} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="mt-1 flex h-6 w-11 shrink-0 items-center rounded-full border border-line bg-muted/30 p-0.5 transition peer-checked:border-action/80 peer-checked:bg-action">
        <span className={`h-5 w-5 rounded-full bg-card shadow-soft transition ${checked ? "translate-x-5" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-extrabold text-ink">
          {title}
          {badge ? <span className="rounded-md bg-action px-2 py-0.5 text-[10px] font-black text-stone-950">{badge}</span> : null}
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted">{text}</span>
      </span>
    </label>
  );
}

function PreviewCard({
  form,
  imageUrl,
  gameName,
  sectionName,
  categoryName,
  sellerName
}: {
  form: LotForm;
  imageUrl?: string;
  gameName?: string;
  sectionName?: string;
  categoryName?: string;
  sellerName: string;
}) {
  const price = Number(form.price || 0);
  const oldPrice = Number(form.oldPrice || 0);
  const discount = oldPrice > price && price > 0 ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0;
  const title = form.title || "Название вашего лота";
  const subtitle = form.shortDescription || [gameName, sectionName, categoryName].filter(Boolean).join(" • ") || "Краткое преимущество появится здесь";

  return (
    <section className="rounded-lg border border-line bg-card/85 p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-action/10 text-action">
          <Eye className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-extrabold text-ink">Предпросмотр лота</h2>
          <p className="mt-1 text-sm text-muted">Так ваш лот увидят покупатели</p>
        </div>
      </div>

      <article className="mt-5 rounded-lg border border-line bg-surface/80 p-4">
        <div className="grid gap-4 sm:grid-cols-[180px_1fr] xl:grid-cols-[150px_1fr]">
          <div className="relative min-h-[180px] overflow-hidden rounded-lg bg-[radial-gradient(circle_at_35%_20%,rgba(251,191,36,.55),transparent_28%),linear-gradient(140deg,#1f2937,#3b1f11_45%,#111827)]">
            {imageUrl ? <img className="absolute inset-0 h-full w-full object-cover" src={imageUrl} alt={title} /> : null}
            <button className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg bg-black/40 text-white backdrop-blur" type="button">
              <Star className="h-5 w-5" />
            </button>
            {!imageUrl ? <span className="absolute bottom-4 left-4 text-5xl font-black text-white/20">{title.slice(0, 2).toUpperCase()}</span> : null}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded bg-violet-500/30 px-2 py-1 text-xs font-bold text-violet-100">{form.platform || "Платформа"}</span>
              <span className="rounded bg-blue-500/30 px-2 py-1 text-xs font-bold text-blue-100">{form.region || "Регион"}</span>
            </div>
            <h3 className="mt-3 text-xl font-black leading-7 text-ink">{title}</h3>
            <p className="mt-3 line-clamp-2 text-sm text-muted">{subtitle}</p>
            <div className="mt-4">
              <p className="text-2xl font-black text-ink">{money(Math.round(price * 100), form.currency)}</p>
              {oldPrice > 0 ? (
                <p className="mt-1 text-sm text-muted">
                  <span className="line-through">{money(Math.round(oldPrice * 100), form.currency)}</span>
                  {discount ? <span className="ml-2 rounded bg-rose-500/20 px-2 py-1 text-xs font-bold text-rose-300">-{discount}%</span> : null}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Badge icon={Clock} text={form.deliveryType === "instant" || form.autoDelivery ? "Мгновенная доставка" : deliveryTimes[form.deliveryTime]} />
          <Badge icon={Lock} text={`${form.stock || 0} шт. в наличии`} />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-panel font-black text-action">{sellerName.slice(0, 1).toUpperCase()}</span>
            <span className="truncate font-extrabold text-ink">{sellerName}</span>
            <span className="rounded bg-action px-2 py-0.5 text-[10px] font-black text-stone-950">PRO</span>
            <span className="flex items-center gap-1 text-sm text-muted">
              <Star className="h-4 w-4 fill-action text-action" /> 4.9
            </span>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
        </div>
      </article>
    </section>
  );
}

function SalesTips({ completion }: { completion: number }) {
  const tips = [
    "Подробное описание с преимуществами",
    "Качественные скриншоты товара",
    "Укажите все важные характеристики",
    "Конкурентная цена и акции"
  ];
  return (
    <section className="rounded-lg border border-action/35 bg-card/85 p-5 shadow-soft">
      <h2 className="flex items-center gap-2 font-extrabold text-ink">
        <Sparkles className="h-5 w-5 text-action" />
        Что повышает продажи
      </h2>
      <div className="mt-4 space-y-3">
        {tips.map((tip) => (
          <p key={tip} className="flex items-center gap-3 text-sm text-ink">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-action text-stone-950">
              <Check className="h-3.5 w-3.5" />
            </span>
            {tip}
          </p>
        ))}
      </div>
      <div className="mt-5 rounded-lg border border-action/25 bg-panel/40 p-4">
        <p className="flex gap-3 text-sm text-muted">
          <Sparkles className="h-5 w-5 shrink-0 text-action" />
          Лоты с полным заполнением продаются на 30-50% быстрее!
        </p>
        <p className="mt-4 text-sm font-bold text-ink">Заполнено: {completion}%</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-action transition-all" style={{ width: `${completion}%` }} />
        </div>
      </div>
    </section>
  );
}

function Badge({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  return (
    <span className="flex items-center gap-2 rounded-lg bg-panel/60 px-3 py-2 text-sm text-muted">
      <Icon className="h-4 w-4" />
      {text}
    </span>
  );
}

function SellerListings({
  products,
  editing,
  setEditing,
  update,
  remove
}: {
  products: SellerProduct[];
  editing: EditProduct | null;
  setEditing: (product: EditProduct | null) => void;
  update: (input: { id: string; body: Record<string, unknown> }) => void;
  remove: (id: string) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-card p-5 shadow-soft">
      <h2 className="text-xl font-extrabold text-ink">Мои лоты</h2>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {products.map((product) => {
          const mediaUrl = productMediaUrls(product)[0];
          return (
            <article key={product.id} className="rounded-lg border border-line bg-surface/60 p-4">
              {editing?.id === product.id ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    update({
                      id: product.id,
                      body: {
                        title: editing.title,
                        description: editing.description,
                        price: editing.price.trim(),
                        stock: editing.stock
                      }
                    });
                  }}
                >
                  <Input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
                  <Textarea rows={3} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input type="number" step="0.01" value={editing.price} onChange={(event) => setEditing({ ...editing, price: event.target.value })} />
                    <Input type="number" value={editing.stock} onChange={(event) => setEditing({ ...editing, stock: Number(event.target.value) })} />
                  </div>
                  <div className="flex gap-2">
                    <button className="app-button">Сохранить</button>
                    <button className="app-button-secondary" type="button" onClick={() => setEditing(null)}>
                      Отмена
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex gap-4">
                    {mediaUrl ? <img className="h-24 w-24 shrink-0 rounded-lg object-cover" src={mediaUrl} alt={product.title} /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-extrabold text-ink">{product.title}</h3>
                          <p className="mt-1 text-sm text-muted">{[product.gameName, product.sectionName, product.categoryName].filter(Boolean).join(" / ")}</p>
                          <p className="mt-1 text-xs text-muted">
                            {product.productType ?? "service"} · {product.deliveryType === "instant" ? "мгновенная доставка" : "ручная доставка"} · продано {product.salesCount ?? 0}
                          </p>
                        </div>
                        <div className="text-right">
                          {product.oldPriceCents ? <p className="text-xs text-muted line-through">{money(product.oldPriceCents, product.currency)}</p> : null}
                          <p className="font-extrabold text-ink">{money(product.priceCents, product.currency)}</p>
                          <StatusBadge status={product.status} />
                        </div>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm text-muted">{product.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="app-button-secondary px-3 py-1 text-sm" onClick={() => update({ id: product.id, body: { status: "active" } })}>
                      Активировать
                    </button>
                    <button className="app-button-secondary px-3 py-1 text-sm" onClick={() => update({ id: product.id, body: { status: "paused" } })}>
                      Пауза
                    </button>
                    <button
                      className="app-button-secondary px-3 py-1 text-sm"
                      onClick={() =>
                        setEditing({
                          id: product.id,
                          title: product.title,
                          description: product.description,
                          price: String(product.priceCents / 100),
                          stock: product.stock
                        })
                      }
                    >
                      Изменить
                    </button>
                    <button className="app-button-danger px-3 py-1 text-sm" onClick={() => remove(product.id)}>
                      <Trash2 className="h-4 w-4" />
                      Удалить
                    </button>
                  </div>
                </>
              )}
            </article>
          );
        })}
        {!products.length ? <p className="text-sm text-muted">Лотов пока нет.</p> : null}
      </div>
    </section>
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
