import { apiFetch } from "./api";
import {
  attachCatalogAsset,
  uploadImage as createStorageUpload
} from "./storage";

export type CatalogStatus = "draft" | "active" | "hidden" | "archived" | "deleted";

export const CATALOG_ITEM_TYPES = ["game", "mobile", "platform", "service"] as const;
export type CatalogItemType = (typeof CATALOG_ITEM_TYPES)[number];

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
  requiresModeration: boolean;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
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
  logoImage: string | null;
  backgroundImage: string | null;
  description: string | null;
  shortDescription: string | null;
  aliases: string[];
  catalogType: CatalogItemType;
  showOnHomepage: boolean;
  isPopular: boolean;
  isRecommended: boolean;
  homepageOrder: number;
  activeProductCount: number;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  status: CatalogStatus;
  sections: AdminCatalogSection[];
};

export type AdminCatalogGroup = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
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

  createGroup: (input: {
    name: string;
    slug: string;
    description?: string;
    icon?: string;
    sortOrder?: number;
    seoTitle?: string;
    seoDescription?: string;
  }) => apiFetch<{ group: AdminCatalogGroup }>("/admin/catalog/groups", { method: "POST", body: JSON.stringify(input) }),
  updateGroup: (id: string, input: Record<string, unknown>) =>
    apiFetch<{ group: AdminCatalogGroup }>(`/admin/catalog/groups/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteGroup: (id: string) => apiFetch<{ hardDeleted: boolean }>(`/admin/catalog/groups/${id}`, { method: "DELETE" }),

  createItem: (input: {
    groupId: string;
    name: string;
    slug: string;
    icon?: string;
    banner?: string;
    logoImage?: string;
    backgroundImage?: string;
    description?: string;
    shortDescription?: string;
    aliases?: string[];
    catalogType?: CatalogItemType;
    showOnHomepage?: boolean;
    isPopular?: boolean;
    isRecommended?: boolean;
    homepageOrder?: number;
    sortOrder?: number;
    seoTitle?: string;
    seoDescription?: string;
  }) => apiFetch<{ item: AdminCatalogItem }>("/admin/catalog/items", { method: "POST", body: JSON.stringify(input) }),

  uploadImage: async (file: File) => {
    const upload = await createStorageUpload(file, "catalog_asset");
    return attachCatalogAsset(upload.id);
  },
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
    seoTitle?: string;
    seoDescription?: string;
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

// Labels live in i18n (adminCatalog.fieldType.*) - this is just the stable value order
// for rendering the type <select>, resolved to a label via useI18n() in the component.
export const CATALOG_FIELD_TYPES: CatalogFieldType[] = ["text", "textarea", "number", "select", "multiselect", "boolean", "checkbox"];

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

// i18n-exempt: transliteration data, not UI copy - these are Cyrillic source characters
// being mapped to Latin, not user-facing strings.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", // i18n-exempt
  и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", // i18n-exempt
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", // i18n-exempt
  ь: "", ю: "iu", я: "ia", ъ: "", ы: "y", э: "e", ё: "e" // i18n-exempt
};

// Admin catalog forms auto-generate a slug from the entered name (including Cyrillic
// group/item/section names) so admins don't have to hand-type ASCII slugs themselves.
export function slugify(name: string): string {
  const transliterated = name
    .toLowerCase()
    .split("")
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join("");
  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
