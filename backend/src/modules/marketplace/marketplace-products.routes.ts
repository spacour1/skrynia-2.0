import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { cacheDel, cacheDelPattern } from "../../common/redis.js";
import { moneyToCents } from "../../common/validation.js";
import type { AuthedRequest } from "../../common/types.js";
import { resolveActiveSectionChain, validateLotMetadata } from "../catalog/catalog.service.js";
import { addSellerPresence, attachCardMetadata, buildDynamicUpdate } from "./marketplace.helpers.js";
import { mediaAggWithStatus } from "./marketplace.sql.js";

const router = Router();

const productSchema = z.object({
  // categoryId is accepted only as a fallback for sectionless listings; when sectionId is
  // present the server derives the category from game_sections instead of trusting the client.
  categoryId: z.string().uuid().optional(),
  gameId: z.string().uuid().optional().nullable(),
  sectionId: z.string().uuid().optional().nullable(),
  title: z.string().min(4).max(140),
  description: z.string().min(20).max(5000),
  price: z.string(),
  currency: z.string().length(3).default("UAH"),
  stock: z.coerce.number().int().min(0).max(100000).default(1),
  deliveryType: z.enum(["manual", "instant"]).default("manual"),
  productType: z.enum(["account", "key", "topup", "boosting", "service", "item", "currency"]).optional(),
  oldPrice: z.string().optional().nullable(),
  server: z.string().max(80).optional().nullable(),
  platform: z.string().max(80).optional().nullable(),
  deliveryTemplate: z.string().max(5000).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  media: z.array(z.string().url()).max(10).optional()
});

router.get(
  "/seller/products",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
              p.status, p.delivery_type as "deliveryType", p.server, p.platform, p.metadata,
              p.section_id as "sectionId", p.schema_version as "schemaVersion",
              p.product_type as "productType", p.old_price_cents as "oldPriceCents",
              p.sales_count as "salesCount", p.is_hot as "isHot", p.is_recommended as "isRecommended",
              p.created_at as "createdAt",
              c.id as "categoryId", c.name as "categoryName",
              g.id as "gameId", g.name as "gameName",
              gs.name as "sectionName",
              ${mediaAggWithStatus}
       from products p
       join categories c on c.id = p.category_id
       left join games g on g.id = p.game_id
       left join game_sections gs on gs.id = p.section_id
       left join product_media pm on pm.product_id = p.id
       where p.seller_id = $1 and p.status != 'deleted'
       group by p.id, c.id, g.id, gs.id
       order by p.created_at desc`,
      [req.user.id]
    );
    res.json({ products: await attachCardMetadata(addSellerPresence(result.rows)) });
  })
);

async function replaceProductMedia(productId: string, urls: string[]) {
  await pool.query(`delete from product_media where product_id = $1`, [productId]);
  if (!urls.length) return;
  const values: unknown[] = [productId];
  const rows = urls.map((url, index) => {
    values.push(url, index);
    return `($1, $${values.length - 1}, $${values.length})`;
  });
  await pool.query(
    `insert into product_media(product_id, url, sort_order) values ${rows.join(", ")}`,
    values
  );
}

type Categorization = {
  categoryId: string;
  gameId: string | null;
  sectionId: string | null;
  productType: string | null;
  /** null = no restriction (sectionless legacy path); a section always has a concrete list. */
  allowedDeliveryTypes: string[] | null;
};

/**
 * The category — and product type — a product belongs to must follow from its section,
 * not from whatever the client happened to send (the frontend used to guess productType
 * from the section's name via regex; that guess can now disagree with the section's own
 * record). When a sectionId is given, this requires the *entire* group -> item -> section
 * chain to be active and the section to have a published schema (resolveActiveSectionChain
 * is the single source of truth for that gate - see catalog.service.ts). Ignores (and
 * validates) any client-supplied categoryId/gameId/productType against the section's own
 * record.
 */
async function resolveCategorization(input: { categoryId?: string | null; gameId?: string | null; sectionId?: string | null }): Promise<Categorization> {
  if (input.sectionId) {
    const chain = await resolveActiveSectionChain(input.sectionId);
    if (input.gameId && input.gameId !== chain.gameId) {
      throw badRequest("Section does not belong to the selected game");
    }
    return {
      categoryId: chain.categoryId,
      gameId: chain.gameId,
      sectionId: chain.sectionId,
      productType: chain.productType,
      allowedDeliveryTypes: chain.allowedDeliveryTypes
    };
  }
  if (!input.categoryId) throw badRequest("categoryId or sectionId is required");
  return { categoryId: input.categoryId, gameId: input.gameId ?? null, sectionId: null, productType: null, allowedDeliveryTypes: null };
}

function assertDeliveryTypeAllowed(allowedDeliveryTypes: string[] | null | undefined, deliveryType: string) {
  if (allowedDeliveryTypes && !allowedDeliveryTypes.includes(deliveryType)) {
    throw badRequest(`This section does not allow delivery type "${deliveryType}"`);
  }
}

router.post(
  "/products",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = productSchema.parse(req.body);
    const categorization = await resolveCategorization(input);
    assertDeliveryTypeAllowed(categorization.allowedDeliveryTypes, input.deliveryType);
    // The section's schema (not the frontend) decides which metadata keys are valid - see
    // catalog.validation.ts. Unknown keys are dropped; missing required ones reject the lot.
    const { metadata, schemaVersion } = await validateLotMetadata(categorization.sectionId, input.metadata);
    const result = await pool.query(
      `insert into products(
         seller_id, category_id, game_id, section_id, title, description, price_cents, old_price_cents,
         currency, stock, delivery_type, product_type, server, platform, delivery_template, metadata, schema_version
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       returning id`,
      [
        req.user.id,
        categorization.categoryId,
        categorization.gameId,
        categorization.sectionId,
        input.title,
        input.description,
        moneyToCents(input.price),
        input.oldPrice ? moneyToCents(input.oldPrice) : null,
        input.currency.toUpperCase(),
        input.stock,
        input.deliveryType,
        categorization.productType ?? input.productType ?? "service",
        input.server ?? null,
        input.platform ?? null,
        input.deliveryTemplate ?? null,
        metadata,
        schemaVersion
      ]
    );
    if (input.media?.length) await replaceProductMedia(result.rows[0].id, input.media);
    await cacheDelPattern("marketplace:products:*");
    await cacheDel("marketplace:games");
    res.status(201).json({ id: result.rows[0].id });
  })
);

const productPatchSchema = productSchema.partial().extend({
  status: z.enum(["active", "paused"]).optional(),
  // Overridden without the base schema's `.default({})`: a PATCH that omits metadata must
  // leave it untouched, not silently wipe it back to {} on every unrelated field update.
  metadata: z.record(z.string(), z.unknown()).optional().nullable()
});

router.patch(
  "/products/:id",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = productPatchSchema.parse(req.body);

    const existing = await pool.query(
      `select seller_id, section_id as "sectionId", delivery_type as "deliveryType" from products where id = $1 and status != 'deleted'`,
      [id]
    );
    if (!existing.rows[0]) throw notFound("Product not found");
    if (existing.rows[0].seller_id !== req.user.id && req.user.role !== "admin") throw forbidden();

    // Only re-derive categorization when the caller is actually changing the section;
    // otherwise leave category/game/section untouched rather than trusting a stray categoryId.
    // sectionId === null is a deliberate "detach from this section" request and needs its
    // own categoryId to fall back to, same as creating a sectionless listing does.
    let categorization: { categoryId?: string | null; gameId?: string | null; sectionId?: string | null; productType?: string | null };
    // null = "no restriction known yet"; undefined stays undefined only for the "section
    // unchanged and nothing that needs re-checking" case below.
    let allowedDeliveryTypes: string[] | null | undefined;
    if (input.sectionId) {
      const resolved = await resolveCategorization(input);
      categorization = resolved;
      allowedDeliveryTypes = resolved.allowedDeliveryTypes;
    } else if (input.sectionId === null) {
      if (!input.categoryId) throw badRequest("categoryId is required when clearing sectionId");
      categorization = { categoryId: input.categoryId, gameId: input.gameId ?? null, sectionId: null, productType: input.productType };
      allowedDeliveryTypes = null;
    } else {
      categorization = { categoryId: input.categoryId, gameId: input.gameId, sectionId: undefined, productType: undefined };

      // sectionId isn't changing, but touching metadata/deliveryType or reactivating the lot
      // still requires the *existing* section to be a fully active chain right now - plain
      // cosmetic edits (title/description/price/media) on a lot sitting in an archived
      // section stay allowed and never reach this check.
      const needsActiveChainCheck = input.metadata != null || input.deliveryType !== undefined || input.status === "active";
      if (needsActiveChainCheck && existing.rows[0].sectionId) {
        allowedDeliveryTypes = (await resolveActiveSectionChain(existing.rows[0].sectionId)).allowedDeliveryTypes;
      }
    }
    if (allowedDeliveryTypes) {
      assertDeliveryTypeAllowed(allowedDeliveryTypes, input.deliveryType ?? existing.rows[0].deliveryType);
    }

    const priceCents = input.price === undefined ? undefined : moneyToCents(input.price);
    const oldPriceCents = input.oldPrice === undefined ? undefined : input.oldPrice === null ? null : moneyToCents(input.oldPrice);

    // Only re-validate metadata when the caller is actually sending new metadata content;
    // an explicit null (clear to {}) or an omitted field needs no schema check. schema_version
    // is only updated alongside a metadata re-validation - changing sectionId alone (without
    // resending metadata in the same request) leaves the old metadata/version pair as-is
    // rather than silently pointing schema_version at a schema for a different section.
    const effectiveSectionId = categorization.sectionId !== undefined ? categorization.sectionId : existing.rows[0].sectionId;
    let validatedMetadata: Record<string, unknown> | null | undefined = input.metadata;
    let schemaVersion: number | undefined;
    if (input.metadata != null) {
      const validated = await validateLotMetadata(effectiveSectionId, input.metadata);
      validatedMetadata = validated.metadata;
      schemaVersion = validated.schemaVersion ?? undefined;
    }

    const { sets, values } = buildDynamicUpdate(id, {
      category_id: categorization.categoryId,
      game_id: categorization.gameId,
      section_id: categorization.sectionId,
      title: input.title,
      description: input.description,
      price_cents: priceCents,
      currency: input.currency?.toUpperCase(),
      stock: input.stock,
      delivery_type: input.deliveryType,
      product_type: categorization.productType ?? input.productType,
      old_price_cents: oldPriceCents,
      server: input.server,
      platform: input.platform,
      delivery_template: input.deliveryTemplate,
      // metadata's column is `not null default '{}'`, so an explicit null "clears" to {}
      // rather than to an actual SQL null.
      metadata: validatedMetadata === null ? {} : validatedMetadata,
      schema_version: schemaVersion,
      status: input.status
    });
    if (sets.length) {
      sets.push("updated_at = now()");
      await pool.query(`update products set ${sets.join(", ")} where id = $1`, values);
    }
    if (input.media !== undefined) await replaceProductMedia(id, input.media);
    await cacheDel(`marketplace:product:${id}`);
    await cacheDelPattern("marketplace:products:*");
    await cacheDel("marketplace:games");
    res.json({ ok: true });
  })
);

router.delete(
  "/products/:id",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const existing = await pool.query(`select seller_id from products where id = $1 and status != 'deleted'`, [id]);
    if (!existing.rows[0]) throw notFound("Product not found");
    if (existing.rows[0].seller_id !== req.user.id && req.user.role !== "admin") throw forbidden();
    await pool.query(`update products set status = 'deleted', updated_at = now() where id = $1`, [id]);
    await cacheDel(`marketplace:product:${id}`);
    await cacheDelPattern("marketplace:products:*");
    await cacheDel("marketplace:games");
    res.status(204).send();
  })
);

export default router;
