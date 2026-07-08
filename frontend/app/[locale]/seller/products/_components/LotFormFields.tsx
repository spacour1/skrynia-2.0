"use client";

import type { FormEvent } from "react";
import type { Category, Game, GameSection } from "@/lib/api";
import { productTypes } from "./constants";
import { Counter, FieldBlock, FormSection, Hint, Input, Select, Textarea, Toggle } from "./form-kit";
import { MediaUploader } from "./MediaUploader";
import type { LotForm, SelectedMedia } from "./types";

export function LotFormFields({
  form,
  setField,
  categories,
  games,
  sections,
  selectedGame,
  media,
  addMedia,
  removeMedia,
  error,
  uploadedUrls,
  onSubmit
}: {
  form: LotForm;
  setField: <K extends keyof LotForm>(key: K, value: LotForm[K]) => void;
  categories?: Category[];
  games?: Game[];
  sections?: GameSection[];
  selectedGame?: Game;
  media: SelectedMedia[];
  addMedia: (files: FileList | File[]) => void;
  removeMedia: (id: string) => void;
  error: string;
  uploadedUrls: string[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form id="create-lot-form" className="space-y-2" onSubmit={onSubmit}>
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
            {games?.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </Select>
        </FieldBlock>
        <FieldBlock label="Раздел игры">
          <Select name="sectionId" value={form.sectionId} onChange={(event) => setField("sectionId", event.target.value)} disabled={!selectedGame}>
            <option value="">Выберите раздел</option>
            {sections?.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </Select>
        </FieldBlock>
        <FieldBlock label="Подкатегория / тип услуги" required className="md:col-span-3">
          <Select name="categoryId" value={form.categoryId} onChange={(event) => setField("categoryId", event.target.value)} required>
            <option value="">Выберите подкатегорию</option>
            {categories?.map((category) => (
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
  );
}
