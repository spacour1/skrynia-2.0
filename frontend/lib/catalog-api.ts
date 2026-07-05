import { apiFetch } from "./api";

export type CatalogStatus = "draft" | "active" | "hidden" | "archived" | "deleted";

export type CatalogFieldType = "text" | "textarea" | "number" | "select" | "multiselect" | "boolean" | "checkbox";

export type CatalogField = {
  key: string;
  label: string;
  type: CatalogFieldType;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  min?: number;
  max?: number;
  filterable: boolean;
  showInCard: boolean;
  sortOrder: number;
};

export type CatalogSchema = { fields: CatalogField[] };

export type CatalogSchemaVersion = {
  id: string;
  sectionId: string;
  version: number;
  schema: CatalogSchema;
  status: "draft" | "active" | "archived";
  createdAt: string;
  publishedAt?: string | null;
};

export type AdminCatalogSection = {
  id: string;
  slug: string;
  name: string;
  listingType: string;
  allowedDeliveryTypes: string[];
  categoryId: string | null;
  status: CatalogStatus;
  currentSchemaVersion: number | null;
  productCount: number;
};

export type AdminCatalogItem = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  banner: string | null;
  status: CatalogStatus;
  sections: AdminCatalogSection[];
};

export type AdminCatalogGroup = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  status: CatalogStatus;
  items: AdminCatalogItem[];
};

export type PublicCatalogSection = {
  id: string;
  slug: string;
  name: string;
  listingType: string;
  allowedDeliveryTypes: string[];
  categoryRiskLevel: string | null;
};

export type PublicCatalogItem = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  banner: string | null;
  sections: PublicCatalogSection[];
};

export type PublicCatalogGroup = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  items: PublicCatalogItem[];
};

export type LegacyCategory = { id: string; slug: string; name: string; description: string | null; riskLevel: string };

export const catalogApi = {
  publicTree: () => apiFetch<{ groups: PublicCatalogGroup[] }>("/marketplace/catalog"),
  sectionSchema: (sectionId: string) => apiFetch<{ schema: CatalogSchema }>(`/marketplace/catalog/sections/${sectionId}/schema`),
  // Sections still need a legacy category for its risk_level (drives moderation
  // strictness) - the catalog builder doesn't invent its own risk taxonomy.
  categories: () => apiFetch<{ categories: LegacyCategory[] }>("/marketplace/categories"),

  adminTree: () => apiFetch<{ groups: AdminCatalogGroup[] }>("/admin/catalog/tree"),

  createGroup: (input: { name: string; slug: string; description?: string; icon?: string; sortOrder?: number }) =>
    apiFetch<{ group: AdminCatalogGroup }>("/admin/catalog/groups", { method: "POST", body: JSON.stringify(input) }),
  updateGroup: (id: string, input: Record<string, unknown>) =>
    apiFetch<{ group: AdminCatalogGroup }>(`/admin/catalog/groups/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteGroup: (id: string) => apiFetch<{ hardDeleted: boolean }>(`/admin/catalog/groups/${id}`, { method: "DELETE" }),

  createItem: (input: { groupId: string; name: string; slug: string; icon?: string; banner?: string; sortOrder?: number }) =>
    apiFetch<{ item: AdminCatalogItem }>("/admin/catalog/items", { method: "POST", body: JSON.stringify(input) }),
  updateItem: (id: string, input: Record<string, unknown>) =>
    apiFetch<{ item: AdminCatalogItem }>(`/admin/catalog/items/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteItem: (id: string) => apiFetch<{ hardDeleted: boolean }>(`/admin/catalog/items/${id}`, { method: "DELETE" }),

  createSection: (input: {
    itemId: string;
    categoryId: string;
    name: string;
    slug: string;
    listingType?: string;
    allowedDeliveryTypes?: string[];
    requiresModeration?: boolean;
    sortOrder?: number;
  }) => apiFetch<{ section: AdminCatalogSection }>("/admin/catalog/sections", { method: "POST", body: JSON.stringify(input) }),
  updateSection: (id: string, input: Record<string, unknown>) =>
    apiFetch<{ section: AdminCatalogSection }>(`/admin/catalog/sections/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteSection: (id: string) => apiFetch<{ hardDeleted: boolean }>(`/admin/catalog/sections/${id}`, { method: "DELETE" }),

  publishSection: (id: string) => apiFetch<{ section: AdminCatalogSection }>(`/admin/catalog/sections/${id}/publish`, { method: "POST" }),
  unhideSection: (id: string) => apiFetch<{ section: AdminCatalogSection }>(`/admin/catalog/sections/${id}/unhide`, { method: "POST" }),
  archiveSection: (id: string) => apiFetch<{ section: AdminCatalogSection }>(`/admin/catalog/sections/${id}/archive`, { method: "POST" }),
  hideSection: (id: string) => apiFetch<{ section: AdminCatalogSection }>(`/admin/catalog/sections/${id}/hide`, { method: "POST" }),

  listSchemaVersions: (sectionId: string) =>
    apiFetch<{ versions: CatalogSchemaVersion[] }>(`/admin/catalog/sections/${sectionId}/schema`),
  createSchemaVersion: (sectionId: string, schema: CatalogSchema) =>
    apiFetch<{ version: CatalogSchemaVersion }>(`/admin/catalog/sections/${sectionId}/schema`, {
      method: "POST",
      body: JSON.stringify({ schema })
    }),
  updateSchemaVersion: (sectionId: string, schemaId: string, schema: CatalogSchema) =>
    apiFetch<{ version: CatalogSchemaVersion }>(`/admin/catalog/sections/${sectionId}/schema/${schemaId}`, {
      method: "PATCH",
      body: JSON.stringify({ schema })
    }),
  publishSchemaVersion: (sectionId: string, schemaId: string) =>
    apiFetch<{ version: CatalogSchemaVersion }>(`/admin/catalog/sections/${sectionId}/schema/${schemaId}/publish`, {
      method: "POST"
    })
};

export const CATALOG_FIELD_TYPES: { value: CatalogFieldType; label: string }[] = [
  { value: "text", label: "Текст" },
  { value: "textarea", label: "Текст (многострочный)" },
  { value: "number", label: "Число" },
  { value: "select", label: "Список (один вариант)" },
  { value: "multiselect", label: "Список (несколько вариантов)" },
  { value: "boolean", label: "Да / Нет" },
  { value: "checkbox", label: "Флажок" }
];

export function emptyCatalogField(sortOrder: number): CatalogField {
  return {
    key: "",
    label: "",
    type: "text",
    required: false,
    filterable: false,
    showInCard: true,
    sortOrder
  };
}
