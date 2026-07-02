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
  Sparkles,
  Tag,
  UserRound,
  Wrench
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { GameIcon } from "@/components/GameIcon";
import { EmailNotVerifiedNotice } from "@/components/EmailNotVerifiedNotice";
import { apiFetch, isEmailNotVerifiedError, money, type Game, type GameSection } from "@/lib/api";
import { captureEvent } from "@/lib/posthog";
import { useAuth } from "@/lib/auth-store";
import { BOOLEAN_FIELD_KEYS, fieldLabel } from "@/lib/product-fields";

const catalogKinds = [
  { id: "games", title: "Игры", hint: "PC и консольные проекты" },
  { id: "mobile", title: "Мобильные игры", hint: "Мобильные проекты" },
  { id: "services", title: "Сервисы", hint: "Пополнения и услуги" },
  { id: "software", title: "Программы", hint: "Ключи и лицензии" }
];

function iconForSection(section: GameSection) {
  const key = `${section.slug} ${section.name}`.toLowerCase();
  if (/key|ключ/.test(key)) return KeyRound;
  if (/top.?up|пополнен/.test(key)) return CreditCard;
  if (/boost|буст/.test(key)) return Rocket;
  if (/account|аккаунт/.test(key)) return UserRound;
  if (/currency|gold|points|валют/.test(key)) return Coins;
  if (/item|skin|предмет|скин/.test(key)) return Tag;
  if (/plus/.test(key)) return Sparkles;
  return Wrench;
}

function schemaFieldsOf(section?: GameSection): string[] {
  const fields = (section?.schema as { fields?: unknown } | undefined)?.fields;
  return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : [];
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
  const [kind, setKind] = useState("games");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [gameId, setGameId] = useState("");
  const [gameOpen, setGameOpen] = useState(true);
  const [gameSearch, setGameSearch] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [autoDelivery, setAutoDelivery] = useState(true);
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [emailBlocked, setEmailBlocked] = useState(false);

  const games = useQuery({
    queryKey: ["games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games")
  });

  const selectedGame = games.data?.games.find((game) => game.id === gameId);
  const gameDetail = useQuery({
    queryKey: ["game", selectedGame?.slug],
    queryFn: () => apiFetch<{ game: Game; sections: GameSection[] }>(`/marketplace/games/${selectedGame?.slug}`),
    enabled: Boolean(selectedGame?.slug)
  });

  const visibleGames = useMemo(() => {
    const term = gameSearch.trim().toLowerCase();
    const list = games.data?.games ?? [];
    const byKind = kind === "mobile"
      ? list.filter((game) => /mobile|genshin|roblox|brawl|pubg/i.test(`${game.name} ${game.slug}`))
      : kind === "services"
        ? list.filter((game) => /steam|discord|telegram|service|playstation|xbox|nintendo|battle|riot|epic|spotify|netflix|youtube|apple|google|amazon/i.test(`${game.name} ${game.slug}`))
        : kind === "software"
          ? list.filter((game) => /windows|office|adobe|software|key/i.test(`${game.name} ${game.slug}`))
          : list;
    return term ? byKind.filter((game) => game.name.toLowerCase().includes(term) || game.slug.includes(term)) : byKind;
  }, [gameSearch, games.data?.games, kind]);

  const selectedSection = gameDetail.data?.sections.find((section) => section.id === sectionId);
  const schemaFields = useMemo(() => schemaFieldsOf(selectedSection), [selectedSection]);
  const priceNumber = Number(price || 0);
  const fee = Math.round(priceNumber * 0.025);

  useEffect(() => {
    setParams((current) => {
      const next: Record<string, string> = {};
      schemaFields.forEach((key) => {
        next[key] = current[key] ?? (key === "platform" && selectedGame ? selectedGame.name : "");
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const create = useMutation({
    mutationFn: async ({ draft }: { draft: boolean }) => {
      const { id } = await apiFetch<{ id: string }>("/marketplace/products", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          gameId,
          sectionId,
          price: price.trim(),
          currency: "UAH",
          stock: 1,
          deliveryType: autoDelivery ? "instant" : "manual",
          // The server is authoritative on productType (derived from the section record);
          // sending it here is just so the request body stays self-describing.
          productType: selectedSection?.productType ?? "service",
          deliveryTemplate: autoDelivery ? "Автовыдача после оплаты. Данные будут отправлены в чат заказа." : null,
          metadata: { catalogKind: kind, ...params }
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
          game_id: gameId,
          section_id: sectionId,
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

  function chooseGame(game: Game) {
    setGameId(game.id);
    setSectionId("");
    setGameOpen(false);
  }

  function validate(): string | null {
    if (!gameId) return "Выберите раздел.";
    if (!sectionId) return "Выберите тип предложения.";
    if (!title.trim()) return "Укажите название лота.";
    if (!description.trim()) return "Добавьте краткое описание.";
    if (!priceNumber || priceNumber < 1) return "Введите цену.";
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
                <span className="text-ink">{catalogKinds.find((item) => item.id === kind)?.title}</span>
                <ChevronRight className="h-4 w-4" />
                <span className={selectedGame ? "text-ink" : undefined}>{selectedGame?.name ?? "Раздел"}</span>
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
                  {catalogKinds.find((item) => item.id === kind)?.title}
                </span>
                <ChevronDown className="h-4 w-4 text-muted" />
              </button>

              {catalogOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-lg border border-line bg-card shadow-lift">
                  <div className="p-2">
                    {catalogKinds.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition hover:bg-panel"
                        onClick={() => {
                          setKind(item.id);
                          setGameId("");
                          setSectionId("");
                          setCatalogOpen(false);
                          setGameOpen(true);
                        }}
                      >
                        <span>
                          <span className="block font-bold text-ink">{item.title}</span>
                          <span className="block text-xs text-muted">{item.hint}</span>
                        </span>
                        {item.id === kind ? <Check className="h-4 w-4 text-brand" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <Label>Раздел</Label>
              <button
                className="mt-2 flex h-12 w-full items-center justify-between rounded-lg border border-line bg-card px-4 text-left font-bold text-ink shadow-soft transition hover:border-brand/60"
                type="button"
                onClick={() => setGameOpen((value) => !value)}
              >
                <span className="flex items-center gap-3">
                  {selectedGame ? <GameIcon name={selectedGame.name} slug={selectedGame.slug} className="h-7 w-7 rounded-md" /> : <Gamepad2 className="h-5 w-5 text-muted" />}
                  {selectedGame?.name ?? "Выберите игру или сервис"}
                </span>
                <ChevronDown className="h-4 w-4 text-muted" />
              </button>

              {gameOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-lg border border-line bg-card shadow-lift">
                  <div className="relative border-b border-line p-3">
                    <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input className="app-input h-10 w-full pl-10" value={gameSearch} onChange={(event) => setGameSearch(event.target.value)} placeholder="Поиск раздела..." />
                  </div>
                  <div className="max-h-[260px] overflow-y-auto p-2">
                    {visibleGames.map((game) => (
                      <button key={game.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition hover:bg-panel" onClick={() => chooseGame(game)}>
                        <span className="flex items-center gap-3">
                          <GameIcon name={game.name} slug={game.slug} className="h-8 w-8 rounded-md" />
                          <span className="font-bold text-ink">{game.name}</span>
                        </span>
                        {game.id === gameId ? <Check className="h-4 w-4 text-brand" /> : null}
                      </button>
                    ))}
                    {!visibleGames.length ? <p className="p-3 text-sm text-muted">Ничего не найдено.</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <Label>Тип предложения</Label>
            {!selectedGame ? (
              <p className="rounded-lg border border-line bg-panel/25 px-4 py-3 text-sm text-muted">Сначала выберите раздел (игру или сервис).</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {(gameDetail.data?.sections ?? []).map((section) => {
                  const Icon = iconForSection(section);
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
                {gameDetail.isLoading ? <p className="text-sm text-muted">Загружаем варианты...</p> : null}
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
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {schemaFields.map((fieldKey) => (
                  <ParamField
                    key={fieldKey}
                    fieldKey={fieldKey}
                    value={params[fieldKey] ?? ""}
                    onChange={(value) => setParams((current) => ({ ...current, [fieldKey]: value }))}
                  />
                ))}
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
                {selectedGame ? <GameIcon name={selectedGame.name} slug={selectedGame.slug} className="h-12 w-12 rounded-lg" /> : <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand/10 text-brand"><Gamepad2 className="h-6 w-6" /></span>}
                <div>
                  <p className="font-black text-ink">{selectedGame?.name ?? "Раздел не выбран"}</p>
                  <span className="mt-1 inline-flex rounded bg-brand/10 px-2 py-0.5 text-xs font-black text-brand">{catalogKinds.find((item) => item.id === kind)?.title}</span>
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

function ParamField({ fieldKey, value, onChange }: { fieldKey: string; value: string; onChange: (value: string) => void }) {
  const label = fieldLabel(fieldKey);
  if (BOOLEAN_FIELD_KEYS.has(fieldKey)) {
    return (
      <label className="block space-y-2">
        <span className="block text-xs font-bold text-muted">{label}</span>
        <select className="app-input h-11 w-full" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Выберите</option>
          <option value="yes">Да</option>
          <option value="no">Нет</option>
        </select>
      </label>
    );
  }
  return (
    <label className="block space-y-2">
      <span className="block text-xs font-bold text-muted">{label}</span>
      <input className="app-input h-11 w-full" value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Введите: ${label.toLowerCase()}`} />
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
