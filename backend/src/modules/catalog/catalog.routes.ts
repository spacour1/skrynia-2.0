import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/errors.js";
import { getActiveSchemaForSection, getPublicCatalogTree, getPublicGroupBySlug, getPublicItemBySlug } from "./catalog.service.js";

const router = Router();

// Public catalog reads - only ever returns 'active' groups/items/sections. Mounted at
// /marketplace/catalog to sit next to the existing /marketplace/categories and
// /marketplace/games read endpoints.

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const groups = await getPublicCatalogTree();
    res.json({ groups });
  })
);

router.get(
  "/groups",
  asyncHandler(async (_req, res) => {
    const groups = await getPublicCatalogTree();
    res.json({ groups: groups.map(({ items, ...group }) => group) });
  })
);

router.get(
  "/groups/:slug",
  asyncHandler(async (req, res) => {
    const slug = z.string().min(1).parse(req.params.slug);
    const group = await getPublicGroupBySlug(slug);
    res.json({ group });
  })
);

router.get(
  "/items/:slug",
  asyncHandler(async (req, res) => {
    const slug = z.string().min(1).parse(req.params.slug);
    const item = await getPublicItemBySlug(slug);
    res.json({ item });
  })
);

router.get(
  "/sections/:id/schema",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const schema = await getActiveSchemaForSection(id);
    res.json({ schema: schema ?? { fields: [] } });
  })
);

export default router;
