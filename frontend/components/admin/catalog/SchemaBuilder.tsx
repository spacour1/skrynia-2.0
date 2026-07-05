"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import {
  CATALOG_FIELD_TYPES,
  catalogApi,
  emptyCatalogField,
  type CatalogField,
  type CatalogSchema
} from "@/lib/catalog-api";
import { ApiError } from "@/lib/api";
import { showAppToast } from "@/lib/toast-events";

export function SchemaBuilder({ sectionId }: { sectionId: string }) {
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ["admin-catalog-schema-versions", sectionId],
    queryFn: () => catalogApi.listSchemaVersions(sectionId)
  });
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [fields, setFields] = useState<CatalogField[]>([]);
  const [error, setError] = useState("");

  const allVersions = versions.data?.versions ?? [];
  const draftVersion = allVersions.find((v) => v.id === selectedVersionId) ?? allVersions.find((v) => v.status === "draft");
  const isEditable = draftVersion?.status === "draft";

  useEffect(() => {
    if (draftVersion) setFields(draftVersion.schema.fields.map((f) => ({ ...f })));
  }, [draftVersion?.id]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-schema-versions", sectionId] });
    queryClient.invalidateQueries({ queryKey: ["admin-catalog-tree"] });
  }

  const createDraft = useMutation({
    mutationFn: () => {
      const base: CatalogSchema = { fields: allVersions.find((v) => v.status === "active")?.schema.fields ?? [] };
      return catalogApi.createSchemaVersion(sectionId, base);
    },
    onSuccess: (data) => {
      invalidate();
      setSelectedVersionId(data.version.id);
    }
  });

  const saveDraft = useMutation({
    mutationFn: () => catalogApi.updateSchemaVersion(sectionId, draftVersion!.id, { fields }),
    onSuccess: () => {
      invalidate();
      showAppToast({ title: "Черновик схемы сохранён" });
      setError("");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось сохранить")
  });

  const publish = useMutation({
    mutationFn: () => catalogApi.publishSchemaVersion(sectionId, draftVersion!.id),
    onSuccess: () => {
      invalidate();
      showAppToast({ title: "Схема опубликована" });
      setError("");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось опубликовать")
  });

  function updateField(index: number, patch: Partial<CatalogField>) {
    setFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function addField() {
    setFields((current) => [...current, emptyCatalogField(current.length)]);
  }

  function removeField(index: number) {
    setFields((current) => current.filter((_, i) => i !== index));
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((field, i) => ({ ...field, sortOrder: i }));
    });
  }

  if (versions.isLoading) {
    return (
      <div className="grid min-h-[160px] place-items-center text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-muted">Версии схемы:</p>
        {allVersions.map((version) => (
          <button
            key={version.id}
            className={`rounded-full px-3 py-1 text-xs font-black transition ${
              (selectedVersionId ?? draftVersion?.id) === version.id ? "bg-brand text-stone-950" : "bg-panel text-muted hover:text-ink"
            }`}
            onClick={() => setSelectedVersionId(version.id)}
          >
            v{version.version} · {version.status}
          </button>
        ))}
        <button
          className="app-button-secondary h-8 px-3 text-xs"
          type="button"
          disabled={createDraft.isPending}
          onClick={() => createDraft.mutate()}
        >
          <Plus className="h-3.5 w-3.5" />
          Новый черновик
        </button>
      </div>

      {!draftVersion ? (
        <p className="rounded-lg border border-dashed border-line/70 bg-panel/25 p-4 text-sm text-muted">
          У этого раздела ещё нет схемы. Создайте черновик, чтобы добавить поля.
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <FieldRow
                key={index}
                field={field}
                editable={isEditable}
                onChange={(patch) => updateField(index, patch)}
                onRemove={() => removeField(index)}
                onMoveUp={index > 0 ? () => moveField(index, -1) : undefined}
                onMoveDown={index < fields.length - 1 ? () => moveField(index, 1) : undefined}
              />
            ))}
            {isEditable ? (
              <button className="app-button-secondary h-10 w-full" type="button" onClick={addField}>
                <Plus className="h-4 w-4" />
                Добавить поле
              </button>
            ) : null}
          </div>

          {error ? <p className="text-sm font-bold text-rose-500">{error}</p> : null}

          {isEditable ? (
            <div className="flex flex-wrap gap-2">
              <button className="app-button h-10 px-4" type="button" disabled={saveDraft.isPending} onClick={() => saveDraft.mutate()}>
                {saveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Сохранить черновик
              </button>
              <button className="app-button-action h-10 px-4" type="button" disabled={publish.isPending || !fields.length} onClick={() => publish.mutate()}>
                {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Опубликовать эту версию
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted">Эта версия {draftVersion.status === "active" ? "активна" : "в архиве"} - редактирование недоступно, создайте новый черновик.</p>
          )}

          <SchemaPreview fields={fields} />
        </>
      )}
    </div>
  );
}

function FieldRow({
  field,
  editable,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown
}: {
  field: CatalogField;
  editable: boolean;
  onChange: (patch: Partial<CatalogField>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const needsOptions = field.type === "select" || field.type === "multiselect";
  const isNumber = field.type === "number";

  return (
    <div className="rounded-lg border border-line bg-panel/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_160px]">
        <input
          className="app-input h-10"
          placeholder="Key (rank, mmr...)"
          value={field.key}
          disabled={!editable}
          onChange={(e) => onChange({ key: e.target.value.trim() })}
        />
        <input
          className="app-input h-10"
          placeholder="Название поля"
          value={field.label}
          disabled={!editable}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <select className="app-input h-10" value={field.type} disabled={!editable} onChange={(e) => onChange({ type: e.target.value as CatalogField["type"] })}>
          {CATALOG_FIELD_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-bold text-muted">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={field.required} disabled={!editable} onChange={(e) => onChange({ required: e.target.checked })} />
          Обязательное
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={field.filterable} disabled={!editable} onChange={(e) => onChange({ filterable: e.target.checked })} />
          Показывать в фильтрах
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={field.showInCard} disabled={!editable} onChange={(e) => onChange({ showInCard: e.target.checked })} />
          Показывать в карточке
        </label>
      </div>

      {needsOptions ? (
        <div className="mt-2">
          <input
            className="app-input h-10 w-full"
            placeholder="Варианты через запятую: Herald, Guardian, Divine"
            disabled={!editable}
            value={(field.options ?? []).join(", ")}
            onChange={(e) => onChange({ options: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })}
          />
        </div>
      ) : null}

      {isNumber ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            className="app-input h-10"
            type="number"
            placeholder="Min"
            disabled={!editable}
            value={field.min ?? ""}
            onChange={(e) => onChange({ min: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
          <input
            className="app-input h-10"
            type="number"
            placeholder="Max"
            disabled={!editable}
            value={field.max ?? ""}
            onChange={(e) => onChange({ max: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
      ) : null}

      {editable ? (
        <div className="mt-2 flex items-center gap-2">
          {onMoveUp ? (
            <button className="rounded-md border border-line p-1.5 text-muted hover:text-ink" type="button" onClick={onMoveUp}>
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {onMoveDown ? (
            <button className="rounded-md border border-line p-1.5 text-muted hover:text-ink" type="button" onClick={onMoveDown}>
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button className="ml-auto inline-flex items-center gap-1 rounded-md border border-rose-500/30 px-2 py-1 text-xs font-bold text-rose-400 hover:bg-rose-500/10" type="button" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
            Удалить поле
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SchemaPreview({ fields }: { fields: CatalogField[] }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <p className="text-xs font-black uppercase text-brand">Preview: форма продавца</p>
      <div className="mt-3 space-y-3">
        {fields.map((field) => (
          <div key={field.key || field.label}>
            <label className="text-sm font-bold text-ink">
              {field.label || field.key || "Без названия"}
              {field.required ? <span className="text-rose-500"> *</span> : null}
            </label>
            {field.type === "textarea" ? (
              <textarea className="app-input mt-1 w-full" disabled placeholder={field.placeholder} />
            ) : field.type === "select" ? (
              <select className="app-input mt-1 w-full" disabled>
                {(field.options ?? []).map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : field.type === "multiselect" ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {(field.options ?? []).map((option) => (
                  <span key={option} className="rounded-full border border-line px-2 py-1 text-xs text-muted">
                    {option}
                  </span>
                ))}
              </div>
            ) : field.type === "boolean" || field.type === "checkbox" ? (
              <label className="mt-1 flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" disabled /> {field.helpText || "Да / нет"}
              </label>
            ) : (
              <input className="app-input mt-1 w-full" disabled type={field.type === "number" ? "number" : "text"} placeholder={field.placeholder} />
            )}
            {field.helpText && field.type !== "boolean" && field.type !== "checkbox" ? <p className="mt-1 text-xs text-muted">{field.helpText}</p> : null}
          </div>
        ))}
        {!fields.length ? <p className="text-sm text-muted">Пока нет полей.</p> : null}
      </div>
    </div>
  );
}
