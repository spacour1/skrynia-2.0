"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "@/lib/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  CreditCard,
  Gamepad2,
  Grid2X2,
  KeyRound,
  Rocket,
  Search,
  Tag,
  UserRound,
  Wrench
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { GameIcon } from "@/components/GameIcon";
import { EmailNotVerifiedNotice } from "@/components/EmailNotVerifiedNotice";
import { apiFetch, isEmailNotVerifiedError, money } from "@/lib/api";
import { captureEvent } from "@/lib/posthog";
import { useAuth } from "@/lib/auth-store";
import { catalogApi, type CatalogField, type PublicCatalogItem } from "@/lib/catalog-api";

// listingType is a small backend-controlled enum (not a client-side guess over free text),
// so mapping it to an icon here is fine - unlike the old regex-over-name/slug classifier.
function iconForListingType(listingType: string) {
  switch (listingType) {
    case "key":
      return KeyRound;
    case "topup":
      return CreditCard;
    case "boosting":
      return Rocket;
    case "account":
      return UserRound;
    case "currency":
      return Coins;
    case "item":
      return Tag;
    default:
      return Wrench;
  }
}

function emptyValueFor(field: CatalogField): unknown {
  if (field.type === "multiselect") return [];
  if (field.type === "boolean" || field.type === "checkbox") return false;
  return "";
}

function isEmptyValue(value: unknown) {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || value === "";
}

export default function SellerCreatePage() {
  return (
    <RequireAuth>
      <SellerCreateContent />
    </RequireAuth>
  );
}

function SellerCreateContent() {
  const router = useRouter();
  const user = useAuth((state) => state.user);
  const [groupId, setGroupId] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [itemOpen, setItemOpen] = useState(true);
  const [itemSearch, setItemSearch] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [autoDelivery, setAutoDelivery] = useState(true);
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [emailBlocked, setEmailBlocked] = useState(false);

  const catalog = useQuery({
    queryKey: ["public-catalog-tree"],
    queryFn: () => catalogApi.publicTree()
  });
  const groups = catalog.data?.groups ?? [];

  useEffect(() => {
    if (!groupId && groups.length) setGroupId(groups[0].id);
  }, [groupId, groups]);

  const selectedGroup = groups.find((group) => group.id === groupId);
  const selectedItem = selectedGroup?.items.find((item) => item.id === itemId);
  const selectedSection = selectedItem?.sections.find((section) => section.id === sectionId);

  const visibleItems = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    const list = selectedGroup?.items ?? [];
    return term ? list.filter((item) => item.name.toLowerCase().includes(term) || item.slug.includes(term)) : list;
  }, [itemSearch, selectedGroup]);

  const schemaQuery = useQuery({
    queryKey: ["section-schema", sectionId],
    queryFn: () => catalogApi.sectionSchema(sectionId),
    enabled: Boolean(sectionId)
  });
  const schemaFields = schemaQuery.data?.schema.fields ?? [];

  const priceNumber = Number(price || 0);
  const fee = Math.round(priceNumber * 0.025);

  useEffect(() => {
    setParams((current) => {
      const next: Record<string, unknown> = {};
      schemaFields.forEach((field) => {
        next[field.key] = field.key in current ? current[field.key] : emptyValueFor(field);
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, schemaQuery.data]);

  const create = useMutation({
    mutationFn: async ({ draft }: { draft: boolean }) => {
      const { id } = await apiFetch<{ id: string }>("/marketplace/products", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          sectionId,
          price: price.trim(),
          currency: "UAH",
          stock: 1,
          deliveryType: autoDelivery ? "instant" : "manual",
          deliveryTemplate: autoDelivery ? "Автовыдача после оплаты. Данные будут отправлены в чат заказа." : null,
          // sectionId alone drives category/game/section/productType server-side (see
          // resolveCategorization) - the section's own schema decides which metadata keys
          // are valid, so there's nothing else client-side to send here.
          metadata: params
        })
      });
      if (draft) {
        await apiFetch(`/marketplace/products/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "paused" })
        });
      }
      return { id, draft };
    },
    onSuccess: ({ id, draft }) => {
      if (!draft) {
        captureEvent("seller_listing_created", {
          product_id: id,
          section_id: sectionId
        });
      }
      router.push(draft ? "/seller/products" : `/products/${id}`);
    },
    onError: (err) => {
      if (isEmailNotVerifiedError(err)) {
        setEmailBlocked(true);
        setError("");
        return;
      }
      setEmailBlocked(false);
      setError(err instanceof Error ? err.message : "Не удалось создать лот");
    }
  });

  function chooseItem(item: PublicCatalogItem) {
    setItemId(item.id);
    setSectionId("");
    setItemOpen(false);
  }

  function validate(): string | null {
    if (!groupId) return "Выберите группу каталога.";
    if (!itemId) return "Выберите раздел.";
    if (!sectionId) return "Выберите тип предложения.";
    if (!title.trim()) return "Укажите название лота.";
    if (!description.trim()) return "Добавьте краткое описание.";
    if (!priceNumber || priceNumber < 1) return "Введите цену.";
    for (const field of schemaFields) {
      if (field.required && isEmptyValue(params[field.key])) return `Заполните поле «${field.label}».`;
    }
    return null;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const validationError = validate();
    if (validationError) return setError(validationError);
    create.mutate({ draft: false });
  }

  function saveDraft() {
    setError("");
    const validationError = validate();
    if (validationError) return setError(validationError);
    create.mutate({ draft: true });
  }

  return (
    <div className="mx-auto grid max-w-[1320px] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form className="app-card overflow-hidden bg-card/95" onSubmit={submit}>
        <div className="border-b border-line bg-panel/35 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-ink">Создать лот</h1>
              <nav className="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold text-muted">
                <span className="text-ink">{selectedGroup?.name ?? "Группа"}</span>
                <ChevronRight className="h-4 w-4" />
                <span className={selectedItem ? "text-ink" : undefined}>{selectedItem?.name ?? "Раздел"}</span>
                <ChevronRight className="h-4 w-4" />
                <span className={selectedSection ? "text-brand" : undefined}>{selectedSection?.name ?? "Тип предложения"}</span>
              </nav>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-brand">{priceNumber ? money(priceNumber * 100, "UAH") : "0,00 UAH"}</p>
              <p className="mt-1 text-xs text-muted">Комиссия 2.5% ({money(fee * 100, "UAH")})</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="relative">
              <Label>Категория</Label>
              <button
                type="button"
                className="mt-2 flex h-12 w-full items-center justify-between rounded-lg border border-line bg-card px-4 text-left font-bold text-ink shadow-soft transition hover:border-brand/60"
                onClick={() => setCatalogOpen((value) => !value)}
              >
                <span className="flex items-center gap-3">
                  <Grid2X2 className="h-5 w-5 text-brand" />
                  {selectedGroup?.name ?? "Выберите группу"}
                </span>
                <ChevronDown className="h-4 w-4 text-muted" />
              </button>

              {catalogOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-lg border border-line bg-card shadow-lift">
                  <div className="p-2">
                    {groups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition hover:bg-panel"
                        onClick={() => {
                          setGroupId(group.id);
                          setItemId("");
                          setSectionId("");
                          setCatalogOpen(false);
                          setItemOpen(true);
                        }}
                      >
                        <span>
                          <span className="block font-bold text-ink">{group.name}</span>
                          {group.description ? <span className="block text-xs text-muted">{group.description}</span> : null}
                        </span>
                        {group.id === groupId ? <Check className="h-4 w-4 text-brand" /> : null}
                      </button>
                    ))}
                    {!groups.length ? <p className="p-3 text-sm text-muted">Каталог ещё не настроен.</p> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <Label>Раздел</Label>
              <button
                className="mt-2 flex h-12 w-full items-center justify-between rounded-lg border border-line bg-card px-4 text-left font-bold text-ink shadow-soft transition hover:border-brand/60"
                type="button"
                onClick={() => setItemOpen((value) => !value)}
              >
                <span className="flex items-center gap-3">
                  {selectedItem ? <GameIcon name={selectedItem.name} slug={selectedItem.slug} className="h-7 w-7 rounded-md" /> : <Gamepad2 className="h-5 w-5 text-muted" />}
                  {selectedItem?.name ?? "Выберите игру или сервис"}
                </span>
                <ChevronDown className="h-4 w-4 text-muted" />
              </button>

              {itemOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-lg border border-line bg-card shadow-lift">
                  <div className="relative border-b border-line p-3">
                    <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input className="app-input h-10 w-full pl-10" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Поиск раздела..." />
                  </div>
                  <div className="max-h-[260px] overflow-y-auto p-2">
                    {visibleItems.map((item) => (
                      <button key={item.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition hover:bg-panel" onClick={() => chooseItem(item)}>
                        <span className="flex items-center gap-3">
                          <GameIcon name={item.name} slug={item.slug} className="h-8 w-8 rounded-md" />
                          <span className="font-bold text-ink">{item.name}</span>
                        </span>
                        {item.id === itemId ? <Check className="h-4 w-4 text-brand" /> : null}
                      </button>
                    ))}
                    {!visibleItems.length ? <p className="p-3 text-sm text-muted">Ничего не найдено.</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <Label>Тип предложения</Label>
            {!selectedItem ? (
              <p className="rounded-lg border border-line bg-panel/25 px-4 py-3 text-sm text-muted">Сначала выберите раздел (игру или сервис).</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {(selectedItem.sections ?? []).map((section) => {
                  const Icon = iconForListingType(section.listingType);
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={`flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-black transition hover:border-brand/70 ${sectionId === section.id ? "border-brand bg-brand/10 text-brand" : "border-line bg-panel/25 text-muted"}`}
                      onClick={() => setSectionId(section.id)}
                    >
                      <Icon className="h-4 w-4" />
                      {section.name}
                    </button>
                  );
                })}
                {!selectedItem.sections?.length ? <p className="text-sm text-muted">В этом разделе пока нет доступных типов предложений.</p> : null}
              </div>
            )}
            {selectedSection?.categoryRiskLevel === "high" ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Эта категория повышенного риска (аккаунты, бустинг, подарочные карты). Указывайте только проверенные
                  данные и не передавайте доступы вне чата заказа — такие лоты проходят более строгую модерацию.
                </p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <Label>Основная информация</Label>
            <Field label="Название лота" counter={`${title.length} / 80`}>
              <input className="app-input h-11 w-full" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Dota 2 аккаунт 5500 MMR + 10K часов" />
            </Field>
            <Field label="Краткое описание" counter={`${description.length} / 500`}>
              <textarea className="app-input min-h-[92px] w-full resize-y leading-6" maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Опишите основные особенности товара, что входит в аккаунт, преимущества и т.д." />
            </Field>
          </section>

          <section className="space-y-3">
            <Label>Параметры</Label>
            {!selectedSection ? (
              <p className="rounded-lg border border-line bg-panel/25 px-4 py-3 text-sm text-muted">Сначала выберите тип предложения, чтобы увидеть параметры.</p>
            ) : schemaQuery.isLoading ? (
              <p className="text-sm text-muted">Загружаем параметры...</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {schemaFields.map((field) => (
                  <ParamField key={field.key} field={field} value={params[field.key]} onChange={(value) => setParams((current) => ({ ...current, [field.key]: value }))} />
                ))}
                {!schemaFields.length ? <p className="text-sm text-muted sm:col-span-2">У этого типа предложения нет дополнительных параметров.</p> : null}
              </div>
            )}
            <label className="flex items-center justify-between rounded-lg border border-line bg-panel/25 px-4 py-3">
              <span>
                <span className="block text-sm font-black text-ink">Автовыдача после покупки</span>
                <span className="mt-1 block text-xs text-muted">Покупатель получит данные сразу после оплаты</span>
              </span>
              <input className="h-5 w-5 accent-[rgb(var(--color-brand))]" type="checkbox" checked={autoDelivery} onChange={(event) => setAutoDelivery(event.target.checked)} />
            </label>
          </section>

          <section className="space-y-3">
            <Label>Цена</Label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
              <input className="app-input h-12 w-full" type="number" min="1" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Введите цену" />
              <select className="app-input h-12 w-full" value="UAH" disabled>
                <option>UAH</option>
              </select>
            </div>
            <p className="text-xs text-muted">Комиссия площадки: 2.5% от суммы сделки</p>
          </section>

          {emailBlocked ? <EmailNotVerifiedNotice /> : null}
          {error ? <p className="rounded-lg bg-rose-500/10 p-3 text-sm font-bold text-rose-400">{error}</p> : null}

          <div className="grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
            <button className="app-button-secondary h-12" type="button" disabled={create.isPending} onClick={saveDraft}>
              Сохранить как черновик
            </button>
            <button className="app-button-action h-12" type="submit" disabled={create.isPending}>
              <Rocket className="h-4 w-4" />
              {create.isPending ? "Публикуем..." : "Опубликовать лот"}
            </button>
          </div>
        </div>
      </form>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <section className="app-card overflow-hidden">
          <div className="border-b border-line bg-panel/35 p-5">
            <h2 className="font-black text-ink">Предпросмотр</h2>
          </div>
          <div className="p-5">
            <div className="rounded-lg border border-line bg-panel/25 p-4">
              <div className="flex items-center gap-3">
                {selectedItem ? <GameIcon name={selectedItem.name} slug={selectedItem.slug} className="h-12 w-12 rounded-lg" /> : <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand/10 text-brand"><Gamepad2 className="h-6 w-6" /></span>}
                <div>
                  <p className="font-black text-ink">{selectedItem?.name ?? "Раздел не выбран"}</p>
                  <span className="mt-1 inline-flex rounded bg-brand/10 px-2 py-0.5 text-xs font-black text-brand">{selectedGroup?.name ?? "Группа"}</span>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-sm">
                <PreviewLine label="Тип предложения" value={selectedSection?.name ?? "Не выбран"} />
                <PreviewLine label="Название лота" value={title || "Dota 2 аккаунт + 5500 MMR + 10K часов"} />
                <PreviewLine label="Продавец" value={user?.displayName ?? "Seller"} />
                <PreviewLine label="Цена" value={priceNumber ? money(priceNumber * 100, "UAH") : "1 499.00 UAH"} strong />
                <PreviewLine label="Комиссия площадки" value={priceNumber ? money(fee * 100, "UAH") : "2.5%"} />
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">Предпросмотр носит ознакомительный характер. Итоговое отображение может отличаться.</p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function ParamField({ field, value, onChange }: { field: CatalogField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === "select") {
    return (
      <label className="block space-y-2">
        <span className="block text-xs font-bold text-muted">{field.label}{field.required ? " *" : ""}</span>
        <select className="app-input h-11 w-full" value={(value as string) ?? ""} onChange={(event) => onChange(event.target.value)}>
          <option value="">Выберите</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {field.helpText ? <span className="block text-xs text-muted">{field.helpText}</span> : null}
      </label>
    );
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-2 sm:col-span-2">
        <span className="block text-xs font-bold text-muted">{field.label}{field.required ? " *" : ""}</span>
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((option) => {
            const active = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${active ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:border-brand/50"}`}
                onClick={() => onChange(active ? selected.filter((item) => item !== option) : [...selected, option])}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.type === "boolean" || field.type === "checkbox") {
    return (
      <label className="flex items-center justify-between rounded-lg border border-line bg-panel/25 px-4 py-3">
        <span className="text-sm font-bold text-ink">{field.label}{field.required ? " *" : ""}</span>
        <input className="h-5 w-5 accent-[rgb(var(--color-brand))]" type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="block space-y-2 sm:col-span-2">
        <span className="block text-xs font-bold text-muted">{field.label}{field.required ? " *" : ""}</span>
        <textarea className="app-input min-h-20 w-full" value={(value as string) ?? ""} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }

  return (
    <label className="block space-y-2">
      <span className="block text-xs font-bold text-muted">{field.label}{field.required ? " *" : ""}</span>
      <input
        className="app-input h-11 w-full"
        type={field.type === "number" ? "number" : "text"}
        min={field.type === "number" ? field.min : undefined}
        max={field.type === "number" ? field.max : undefined}
        value={(value as string | number) ?? ""}
        placeholder={field.placeholder ?? `Введите: ${field.label.toLowerCase()}`}
        onChange={(event) => onChange(field.type === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)}
      />
      {field.helpText ? <span className="block text-xs text-muted">{field.helpText}</span> : null}
    </label>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-black text-ink">{children}</h2>;
}

function Field({ label, counter, children }: { label: string; counter?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center justify-between gap-3 text-xs font-bold text-muted">
        <span>{label}</span>
        {counter ? <span>{counter}</span> : null}
      </span>
      {children}
    </label>
  );
}

function PreviewLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={strong ? "mt-1 text-xl font-black text-brand" : "mt-1 font-bold text-ink"}>{value}</p>
    </div>
  );
}
