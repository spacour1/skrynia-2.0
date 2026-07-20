import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { inTx, pool, type DbClient } from "../../db/pool.js";
import { ApiError, asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { moneyToCents } from "../../common/validation.js";
import type { AuthedRequest } from "../../common/types.js";
import { DELIVERY_TYPES, PRODUCT_TYPES } from "../../domain/enums.js";
import { resolveActiveSectionChain, validateLotMetadata } from "../catalog/catalog.service.js";
import { addSellerPresence, attachCardMetadata, buildDynamicUpdate } from "./marketplace.helpers.js";
import { mediaAggWithStatus } from "./marketplace.sql.js";
import {
  invalidateProductCacheBatch,
  invalidateProductCaches,
  type ProductCacheContext
} from "./marketplace-cache.service.js";
import {
  attachStorageObject,
  buildMediaUrl,
  enqueueStorageDeletion
} from "../storage/storage.service.js";

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
  deliveryType: z.enum(DELIVERY_TYPES).default("manual"),
  productType: z.enum(PRODUCT_TYPES).optional(),
  oldPrice: z.string().optional().nullable(),
  server: z.string().max(80).optional().nullable(),
  platform: z.string().max(80).optional().nullable(),
  deliveryTemplate: z.string().max(5000).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  mediaUploadIds: z
    .array(z.string().uuid())
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, "Upload IDs must be unique")
    .optional(),
  // The legacy URL contract is deliberately rejected instead of silently stripping it.
  media: z.undefined().optional()
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
    res.json({
      products: await attachCardMetadata(await addSellerPresence(result.rows))
    });
  })
);

// Always called inside the same transaction as the product row change: a failure between
// the delete and the insert must roll the whole operation back, never leave a listing
// stripped of its media.
async function replaceProductMedia(
  client: pg.PoolClient,
  productId: string,
  uploadIds: string[],
  ownerId: string
) {
  const previous = await client.query<{ storageObjectId: string | null }>(
    `select storage_object_id as "storageObjectId"
     from product_media
     where product_id = $1
     for update`,
    [productId]
  );

  const objects = [];
  for (const uploadId of uploadIds) {
    objects.push(
      await attachStorageObject(client, {
        uploadId,
        ownerId,
        purpose: "product_media"
      })
    );
  }

  await client.query(`delete from product_media where product_id = $1`, [productId]);
  if (objects.length) {
    const values: unknown[] = [productId];
    const rows = objects.map((object, index) => {
      values.push(buildMediaUrl(object.objectKey), index, object.id);
      return `($1, $${values.length - 2}, $${values.length - 1}, $${values.length})`;
    });
    await client.query(
      `insert into product_media(product_id, url, sort_order, storage_object_id)
       values ${rows.join(", ")}`,
      values
    );
  }

  for (const old of previous.rows) {
    if (old.storageObjectId) {
      await enqueueStorageDeletion(client, old.storageObjectId);
    }
  }
}

type Categorization = {
  categoryId: string;
  gameId: string | null;
  sectionId: string | null;
  productType: string | null;
  /** null = no restriction (sectionless legacy path); a section always has a concrete list. */
  allowedDeliveryTypes: string[] | null;
  activeSchemaVersion: number | null;
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
async function resolveCategorization(
  input: { categoryId?: string | null; gameId?: string | null; sectionId?: string | null },
  db: DbClient = pool,
  lockSection = false
): Promise<Categorization> {
  if (input.sectionId) {
    const chain = await resolveActiveSectionChain(input.sectionId, db, { lock: lockSection });
    if (input.gameId && input.gameId !== chain.gameId) {
      throw badRequest("Section does not belong to the selected game");
    }
    return {
      categoryId: chain.categoryId,
      gameId: chain.gameId,
      sectionId: chain.sectionId,
      productType: chain.productType,
      allowedDeliveryTypes: chain.allowedDeliveryTypes,
      activeSchemaVersion: chain.schemaVersion
    };
  }
  if (!input.categoryId) throw badRequest("categoryId or sectionId is required");
  return {
    categoryId: input.categoryId,
    gameId: input.gameId ?? null,
    sectionId: null,
    productType: null,
    allowedDeliveryTypes: null,
    activeSchemaVersion: null
  };
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
    const created = await inTx(async (client) => {
      const categorization = await resolveCategorization(input, client, true);
      assertDeliveryTypeAllowed(categorization.allowedDeliveryTypes, input.deliveryType);
      // The section's schema (not the frontend) decides which metadata keys are valid.
      const { metadata, schemaVersion } = await validateLotMetadata(categorization.sectionId, input.metadata, client);
      if (schemaVersion !== categorization.activeSchemaVersion) {
        throw new ApiError(400, "The section schema changed while validating metadata", "validation_error");
      }
      const result = await client.query(
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
      if (input.mediaUploadIds?.length) {
        await replaceProductMedia(
          client,
          result.rows[0].id,
          input.mediaUploadIds,
          req.user.id
        );
      }
      return { productId: result.rows[0].id as string, categorization };
    });
    await invalidateProductCaches({
      productId: created.productId,
      sellerId: req.user.id,
      categoryId: created.categorization.categoryId,
      gameId: created.categorization.gameId,
      sectionId: created.categorization.sectionId
    });
    res.status(201).json({ id: created.productId });
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

    const result = await inTx(async (client) => {
      const existing = await client.query<
        ProductCacheContext & {
          deliveryType: string;
          metadata: Record<string, unknown>;
          schemaVersion: number | null;
        }
      >(
        `select id as "productId", seller_id as "sellerId", category_id as "categoryId",
                game_id as "gameId", section_id as "sectionId", delivery_type as "deliveryType",
                metadata, schema_version as "schemaVersion"
         from products where id = $1 and status != 'deleted'
         for update`,
        [id]
      );
      const existingProduct = existing.rows[0];
      if (!existingProduct) throw notFound("Product not found");
      if (existingProduct.sellerId !== req.user.id && req.user.role !== "admin") throw forbidden();

      const existingSectionId = existingProduct.sectionId ?? null;
      const targetSectionId = input.sectionId === undefined ? existingSectionId : input.sectionId;
      const sectionChanged = input.sectionId !== undefined && targetSectionId !== existingSectionId;
      const metadataProvided = input.metadata !== undefined;
      if (sectionChanged && !metadataProvided) {
        throw new ApiError(400, "metadata is required when changing sectionId", "validation_error");
      }

      let categorization: {
        categoryId?: string | null;
        gameId?: string | null;
        sectionId?: string | null;
        productType?: string | null;
      };
      let allowedDeliveryTypes: string[] | null | undefined;
      let activeSchemaVersion: number | null | undefined;

      if (input.sectionId) {
        const resolved = await resolveCategorization(input, client, true);
        categorization = resolved;
        allowedDeliveryTypes = resolved.allowedDeliveryTypes;
        activeSchemaVersion = resolved.activeSchemaVersion;
      } else if (input.sectionId === null && sectionChanged) {
        if (!input.categoryId) throw badRequest("categoryId is required when clearing sectionId");
        categorization = {
          categoryId: input.categoryId,
          gameId: input.gameId ?? null,
          sectionId: null,
          productType: input.productType
        };
        allowedDeliveryTypes = null;
        activeSchemaVersion = null;
      } else {
        // A section owns its category, game, and product type. Ignore those client fields
        // unless this is a legacy sectionless listing.
        categorization = existingSectionId
          ? { categoryId: undefined, gameId: undefined, sectionId: undefined, productType: undefined }
          : { categoryId: input.categoryId, gameId: input.gameId, sectionId: undefined, productType: input.productType };

        const needsActiveChainCheck = metadataProvided || input.deliveryType !== undefined || input.status === "active";
        if (needsActiveChainCheck && existingSectionId) {
          const chain = await resolveActiveSectionChain(existingSectionId, client, { lock: true });
          allowedDeliveryTypes = chain.allowedDeliveryTypes;
          activeSchemaVersion = chain.schemaVersion;
          if (input.status === "active") {
            categorization.categoryId = chain.categoryId;
            categorization.gameId = chain.gameId;
            categorization.productType = chain.productType;
          }
        }
      }

      if (allowedDeliveryTypes) {
        assertDeliveryTypeAllowed(allowedDeliveryTypes, input.deliveryType ?? existingProduct.deliveryType);
      }
      if (
        input.status === "active" &&
        targetSectionId &&
        !metadataProvided &&
        existingProduct.schemaVersion !== activeSchemaVersion
      ) {
        throw new ApiError(
          400,
          "metadata must be resubmitted before activating a product with an outdated schema",
          "validation_error"
        );
      }

      let validatedMetadata: Record<string, unknown> | undefined;
      let schemaVersion: number | null | undefined;
      if (metadataProvided || input.status === "active") {
        const rawMetadata = metadataProvided ? input.metadata ?? {} : existingProduct.metadata;
        const validated = await validateLotMetadata(targetSectionId, rawMetadata, client);
        if (targetSectionId && validated.schemaVersion !== activeSchemaVersion) {
          throw new ApiError(400, "The section schema changed while validating metadata", "validation_error");
        }
        validatedMetadata = validated.metadata;
        schemaVersion = validated.schemaVersion;
      }

      const priceCents = input.price === undefined ? undefined : moneyToCents(input.price);
      const oldPriceCents = input.oldPrice === undefined ? undefined : input.oldPrice === null ? null : moneyToCents(input.oldPrice);
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
        product_type: categorization.productType,
        old_price_cents: oldPriceCents,
        server: input.server,
        platform: input.platform,
        delivery_template: input.deliveryTemplate,
        metadata: validatedMetadata,
        schema_version: schemaVersion,
        status: input.status
      });

      let context: ProductCacheContext = existingProduct;
      if (sets.length) {
        sets.push("updated_at = now()");
        const updated = await client.query<ProductCacheContext>(
          `update products set ${sets.join(", ")} where id = $1
           returning id as "productId", seller_id as "sellerId", category_id as "categoryId",
                     game_id as "gameId", section_id as "sectionId"`,
          values
        );
        context = updated.rows[0];
      }
      if (input.mediaUploadIds !== undefined) {
        await replaceProductMedia(
          client,
          id,
          input.mediaUploadIds,
          req.user.id
        );
      }
      return { existingProduct, updatedProduct: context };
    });
    await invalidateProductCacheBatch([result.existingProduct, result.updatedProduct]);
    res.json({ ok: true });
  })
);

router.delete(
  "/products/:id",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const existing = await pool.query<ProductCacheContext>(
      `select id as "productId", seller_id as "sellerId", category_id as "categoryId",
              game_id as "gameId", section_id as "sectionId"
       from products where id = $1 and status != 'deleted'`,
      [id]
    );
    const existingProduct = existing.rows[0];
    if (!existingProduct) throw notFound("Product not found");
    if (existingProduct.sellerId !== req.user.id && req.user.role !== "admin") throw forbidden();
    await pool.query(`update products set status = 'deleted', updated_at = now() where id = $1`, [id]);
    await invalidateProductCaches(existingProduct);
    res.status(204).send();
  })
);

export default router;
