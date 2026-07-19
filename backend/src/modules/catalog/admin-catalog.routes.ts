import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import {
  invalidateCatalogCaches,
  invalidateProductCacheBatch,
  loadGameProductCacheContexts,
  loadSectionProductCacheContexts
} from "../marketplace/marketplace-cache.service.js";
import {
  createCatalogGroup,
  createCatalogItem,
  createCatalogSection,
  createSchemaVersion,
  deleteCatalogGroup,
  deleteCatalogItem,
  deleteCatalogSection,
  getAdminCatalogTree,
  listSchemaVersions,
  publishCatalogSection,
  publishSchemaVersion,
  setCatalogSectionStatus,
  updateCatalogGroup,
  updateCatalogItem,
  updateCatalogSection,
  updateSchemaVersion
} from "./catalog.service.js";

const router = Router();

// Catalog builder is admin-only, unlike the broader admin.routes.ts (which also lets
// moderators through for trust & safety tools). Nothing here is a moderation action.
router.use(authenticate, requireRole("admin"));

const STATUS_VALUES = ["draft", "active", "hidden", "archived"] as const;

async function invalidateItemCaches(itemId: string) {
  const contexts = await loadGameProductCacheContexts(itemId);
  await invalidateProductCacheBatch(contexts, { gameIds: [itemId] });
}

async function invalidateSectionCaches(sectionId: string) {
  const contexts = await loadSectionProductCacheContexts(sectionId);
  await invalidateProductCacheBatch(contexts, { sectionIds: [sectionId] });
}

const groupSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  description: z.string().max(2000).optional().nullable(),
  icon: z.string().max(100).optional().nullable(),
  sortOrder: z.number().int().optional(),
  seoTitle: z.string().max(200).optional().nullable(),
  seoDescription: z.string().max(500).optional().nullable(),
  status: z.enum(STATUS_VALUES).optional()
});

const itemSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  description: z.string().max(2000).optional().nullable(),
  shortDescription: z.string().max(300).optional().nullable(),
  icon: z.string().max(500).optional().nullable(),
  banner: z.string().max(500).optional().nullable(),
  logoImage: z.string().max(500).optional().nullable(),
  backgroundImage: z.string().max(500).optional().nullable(),
  aliases: z.array(z.string().min(1).max(80)).max(30).optional(),
  catalogType: z.enum(["game", "mobile", "platform", "service"]).optional(),
  showOnHomepage: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  isRecommended: z.boolean().optional(),
  homepageOrder: z.number().int().optional(),
  sortOrder: z.number().int().optional(),
  seoTitle: z.string().max(200).optional().nullable(),
  seoDescription: z.string().max(500).optional().nullable(),
  status: z.enum(STATUS_VALUES).optional()
});

const sectionSchema = z.object({
  itemId: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  description: z.string().max(2000).optional().nullable(),
  listingType: z.string().optional(),
  allowedDeliveryTypes: z.array(z.string()).optional(),
  requiresModeration: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  seoTitle: z.string().max(200).optional().nullable(),
  seoDescription: z.string().max(500).optional().nullable(),
  status: z.enum(STATUS_VALUES).optional()
});

router.get(
  "/tree",
  asyncHandler(async (_req: AuthedRequest, res) => {
    const groups = await getAdminCatalogTree();
    res.json({ groups });
  })
);

// --- Groups ---------------------------------------------------------------

router.post(
  "/groups",
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = groupSchema.parse(req.body);
    const group = await createCatalogGroup(input, req.user.id);
    await invalidateCatalogCaches();
    res.status(201).json({ group });
  })
);

router.patch(
  "/groups/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = groupSchema.partial().parse(req.body);
    const group = await updateCatalogGroup(id, input, req.user.id);
    await invalidateCatalogCaches();
    res.json({ group });
  })
);

router.delete(
  "/groups/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await deleteCatalogGroup(id, req.user.id);
    await invalidateCatalogCaches();
    res.json(result);
  })
);

// --- Items -----------------------------------------------------------------

router.post(
  "/items",
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = itemSchema.parse(req.body);
    const item = await createCatalogItem(input, req.user.id);
    await invalidateItemCaches(item.id);
    res.status(201).json({ item });
  })
);

router.patch(
  "/items/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = itemSchema.partial().parse(req.body);
    const item = await updateCatalogItem(id, input, req.user.id);
    await invalidateItemCaches(id);
    res.json({ item });
  })
);

router.delete(
  "/items/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await deleteCatalogItem(id, req.user.id);
    await invalidateItemCaches(id);
    res.json(result);
  })
);

// --- Sections ----------------------------------------------------------------

router.post(
  "/sections",
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = sectionSchema.parse(req.body);
    const section = await createCatalogSection(input, req.user.id);
    await invalidateSectionCaches(section.id);
    res.status(201).json({ section });
  })
);

router.patch(
  "/sections/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = sectionSchema.partial().parse(req.body);
    const section = await updateCatalogSection(id, input, req.user.id);
    await invalidateSectionCaches(id);
    res.json({ section });
  })
);

router.delete(
  "/sections/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await deleteCatalogSection(id, req.user.id);
    await invalidateSectionCaches(id);
    res.json(result);
  })
);

// --- Section schema versions -------------------------------------------------

router.get(
  "/sections/:id/schema",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const versions = await listSchemaVersions(id);
    res.json({ versions });
  })
);

router.post(
  "/sections/:id/schema",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({ schema: z.unknown() }).parse(req.body);
    const version = await createSchemaVersion(id, input.schema, req.user.id);
    await invalidateSectionCaches(id);
    res.status(201).json({ version });
  })
);

router.patch(
  "/sections/:id/schema/:schemaId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const schemaId = z.string().uuid().parse(req.params.schemaId);
    const input = z.object({ schema: z.unknown() }).parse(req.body);
    const version = await updateSchemaVersion(id, schemaId, input.schema, req.user.id);
    await invalidateSectionCaches(id);
    res.json({ version });
  })
);

// Not in the original endpoint list verbatim, but required to actually move a schema
// version from draft to active - /sections/:id/publish (below) only flips the *section's*
// own status and requires a schema to already be active first.
router.post(
  "/sections/:id/schema/:schemaId/publish",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const schemaId = z.string().uuid().parse(req.params.schemaId);
    const version = await publishSchemaVersion(id, schemaId, req.user.id);
    await invalidateSectionCaches(id);
    res.json({ version });
  })
);

// --- Section lifecycle -----------------------------------------------------

router.post(
  "/sections/:id/publish",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const section = await publishCatalogSection(id, req.user.id);
    await invalidateSectionCaches(id);
    res.json({ section });
  })
);

router.post(
  "/sections/:id/unhide",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const section = await publishCatalogSection(id, req.user.id);
    await invalidateSectionCaches(id);
    res.json({ section });
  })
);

router.post(
  "/sections/:id/archive",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const section = await setCatalogSectionStatus(id, "archived", req.user.id);
    await invalidateSectionCaches(id);
    res.json({ section });
  })
);

router.post(
  "/sections/:id/hide",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const section = await setCatalogSectionStatus(id, "hidden", req.user.id);
    await invalidateSectionCaches(id);
    res.json({ section });
  })
);

export default router;
