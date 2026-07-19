import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import { authenticateOptional } from "../../common/middleware/auth.js";
import type { AuthedRequest } from "../../common/types.js";
import { cacheGet, cacheSet } from "../../common/redis.js";
import { moneyToCents, paginationSchema } from "../../common/validation.js";
import { getActiveSchemaForSection, getSchemaByVersion } from "../catalog/catalog.service.js";
import { buildMetadataFilterClauses } from "../catalog/catalog.validation.js";
import { addSellerPresence, attachCardMetadata } from "./marketplace.helpers.js";
import { mediaAgg } from "./marketplace.sql.js";

const router = Router();

const searchSchema = paginationSchema.extend({
  q: z.string().optional(),
  category: z.string().optional(),
  game: z.string().optional(),
  section: z.string().optional(),
  // sectionId (not the `section` slug above, which is only unique per item) scopes
  // metadata filters to one section's schema - a slug alone can't identify which schema
  // to validate `meta[...]` filter keys against.
  sectionId: z.string().uuid().optional(),
  // Shape is `{ [fieldKey]: string | { min?: string; max?: string } }`, validated at
  // request time against the section's active schema (see buildMetadataFilterClauses) -
  // not worth statically typing here since it's entirely schema-driven.
  meta: z.record(z.string(), z.unknown()).optional(),
  server: z.string().optional(),
  platform: z.string().optional(),
  deliveryType: z.enum(["manual", "instant"]).optional(),
  productType: z.enum(["account", "key", "topup", "boosting", "service", "item", "currency"]).optional(),
  hot: z.coerce.boolean().optional(),
  recommended: z.coerce.boolean().optional(),
  min: z.string().optional(),
  max: z.string().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  discountOnly: z.coerce.boolean().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "rating", "sales", "discount"]).default("newest")
});

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const rows = await cacheGet("categories");
    if (rows) return res.json({ categories: rows });
    const result = await pool.query(
      `select c.id, c.slug, c.name, c.description, c.risk_level as "riskLevel",
              count(p.id) filter (where product_seller.is_banned = false)::int as "activeProductCount"
       from categories c
       left join products p on p.category_id = c.id and p.status = 'active'
       left join users product_seller on product_seller.id = p.seller_id
       group by c.id
       order by c.name`
    );
    await cacheSet("categories", result.rows, 60 * 10);
    res.json({ categories: result.rows });
  })
);

router.get(
  "/games",
  asyncHandler(async (_req, res) => {
    const cached = await cacheGet("marketplace:games");
    if (cached) return res.json({ games: cached });
    const result = await pool.query(
      `select g.id, g.slug, g.name, g.publisher, g.icon_url as "iconUrl", g.popularity,
              g.banner, g.logo_image as "logoImage", g.short_description as "shortDescription",
              g.catalog_type as "catalogType",
              g.show_on_homepage as "showOnHomepage", g.is_popular as "isPopular",
              g.is_recommended as "isRecommended", g.homepage_order as "homepageOrder",
              g.created_at as "createdAt",
              count(distinct p.id) filter (where product_seller.is_banned = false)::int as "lotCount"
       from games g
       left join products p on p.game_id = g.id and p.status = 'active'
       left join users product_seller on product_seller.id = p.seller_id
       where g.is_active = true
       group by g.id
       order by g.homepage_order asc, g.popularity desc, g.name asc`
    );
    await cacheSet("marketplace:games", result.rows, 60 * 5);
    res.json({ games: result.rows });
  })
);

router.get(
  "/games/:slug",
  asyncHandler(async (req, res) => {
    const slug = z.string().min(1).max(120).parse(req.params.slug);
    const game = await pool.query(
      `select id, slug, name, publisher, icon_url as "iconUrl", popularity,
              banner, logo_image as "logoImage", background_image as "backgroundImage",
              description, short_description as "shortDescription",
              seo_title as "seoTitle", seo_description as "seoDescription"
       from games
       where slug = $1 and is_active = true`,
      [slug]
    );
    if (!game.rows[0]) throw notFound("Game not found");

    const sections = await pool.query(
      `select gs.id, gs.slug, gs.name, gs.description, gs.sort_order as "sortOrder",
              gs.schema, gs.product_type as "productType", c.slug as "categorySlug", c.name as "categoryName",
              c.risk_level as "categoryRiskLevel",
              count(p.id) filter (where product_seller.is_banned = false)::int as "lotCount"
       from game_sections gs
       left join categories c on c.id = gs.category_id
       left join products p on p.section_id = gs.id and p.status = 'active'
       left join users product_seller on product_seller.id = p.seller_id
       where gs.game_id = $1 and gs.is_active = true
       group by gs.id, c.id
       order by gs.sort_order asc, gs.name asc`,
      [game.rows[0].id]
    );
    res.json({ game: game.rows[0], sections: sections.rows });
  })
);

router.get(
  "/suggest",
  asyncHandler(async (req, res) => {
    const q = z.string().trim().min(1).max(80).parse(req.query.q);
    const pattern = `%${q}%`;

    const games = await pool.query(
      `select g.id, g.slug, g.name, g.publisher, g.icon_url as "iconUrl", g.popularity,
              count(distinct p.id) filter (where product_seller.is_banned = false)::int as "lotCount"
       from games g
       left join products p on p.game_id = g.id and p.status = 'active'
       left join users product_seller on product_seller.id = p.seller_id
       where g.is_active = true
         and (g.name ilike $1 or g.slug ilike $1 or coalesce(g.publisher, '') ilike $1
              or exists (select 1 from unnest(g.aliases) alias where alias ilike $1))
       group by g.id
       order by
         case when lower(g.name) like lower($2) then 0 else 1 end,
         g.popularity desc,
         g.name asc
       limit 6`,
      [pattern, `${q}%`]
    );

    const products = await pool.query(
      `select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency,
              p.product_type as "productType", p.delivery_type as "deliveryType",
              p.metadata, p.is_hot as "isHot", p.old_price_cents as "oldPriceCents",
              g.slug as "gameSlug", g.name as "gameName",
              c.name as "categoryName",
              u.display_name as "sellerDisplayName",
              ${mediaAgg}
       from products p
       join categories c on c.id = p.category_id
       left join games g on g.id = p.game_id
       join users u on u.id = p.seller_id
       left join product_media pm on pm.product_id = p.id and pm.status = 'approved'
       where p.status = 'active'
         and p.stock > 0
         and u.is_banned = false
         and (
           p.title ilike $1
           or p.description ilike $1
           or coalesce(g.name, '') ilike $1
           or c.name ilike $1
           or p.product_type ilike $1
         )
       group by p.id, c.id, g.id, u.id
       order by
         case when lower(p.title) like lower($2) then 0 else 1 end,
         p.is_hot desc,
         p.sales_count desc,
         p.created_at desc
       limit 8`,
      [pattern, `${q}%`]
    );

    res.json({ games: games.rows, products: products.rows });
  })
);

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const input = searchSchema.parse(req.query);
    const cacheKey = `marketplace:products:${JSON.stringify(input)}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const offset = (input.page - 1) * input.limit;
    const values: unknown[] = [];
    const where = ["p.status = 'active'", "p.stock > 0", "u.is_banned = false"];

    if (input.q) {
      values.push(input.q);
      where.push(`(
        to_tsvector('english', p.title || ' ' || p.description) @@ plainto_tsquery('english', $${values.length})
        or p.title ilike '%' || $${values.length} || '%'
        or p.description ilike '%' || $${values.length} || '%'
        or coalesce(g.name, '') ilike '%' || $${values.length} || '%'
        or c.name ilike '%' || $${values.length} || '%'
      )`);
    }
    if (input.category) {
      values.push(input.category);
      where.push(`c.slug = $${values.length}`);
    }
    if (input.game) {
      values.push(input.game);
      where.push(`g.slug = $${values.length}`);
    }
    if (input.section) {
      values.push(input.section);
      where.push(`gs.slug = $${values.length}`);
    }
    if (input.sectionId) {
      values.push(input.sectionId);
      where.push(`p.section_id = $${values.length}`);
    }
    if (input.meta && Object.keys(input.meta).length) {
      // Metadata filters only make sense scoped to one section's schema - a slug/game
      // combo can't tell us which schema to validate the filter keys against.
      if (!input.sectionId) throw badRequest("sectionId is required when filtering by meta");
      const schema = await getActiveSchemaForSection(input.sectionId);
      if (!schema) throw badRequest("This section has no active schema to filter by");
      const { clauses, values: metaValues } = buildMetadataFilterClauses(schema, input.meta, values.length);
      where.push(...clauses);
      values.push(...metaValues);
    }
    if (input.server) {
      values.push(input.server);
      where.push(`lower(coalesce(p.server, '')) = lower($${values.length})`);
    }
    if (input.platform) {
      values.push(input.platform);
      where.push(`lower(coalesce(p.platform, '')) = lower($${values.length})`);
    }
    if (input.deliveryType) {
      values.push(input.deliveryType);
      where.push(`p.delivery_type = $${values.length}`);
    }
    if (input.productType) {
      values.push(input.productType);
      where.push(`p.product_type = $${values.length}`);
    }
    if (input.hot !== undefined) {
      values.push(input.hot);
      where.push(`p.is_hot = $${values.length}`);
    }
    if (input.recommended !== undefined) {
      values.push(input.recommended);
      where.push(`p.is_recommended = $${values.length}`);
    }
    if (input.min !== undefined) {
      values.push(moneyToCents(input.min));
      where.push(`p.price_cents >= $${values.length}`);
    }
    if (input.max !== undefined) {
      values.push(moneyToCents(input.max));
      where.push(`p.price_cents <= $${values.length}`);
    }
    if (input.discountOnly) {
      where.push(`p.old_price_cents is not null and p.old_price_cents > p.price_cents`);
    }
    const having: string[] = [];
    if (input.minRating !== undefined) {
      values.push(input.minRating);
      having.push(`coalesce(avg(r.rating), 0) >= $${values.length}`);
    }

    const orderBy =
      input.sort === "price_asc"
        ? '"priceCents" asc'
        : input.sort === "price_desc"
          ? '"priceCents" desc'
          : input.sort === "rating"
            ? `"sellerRating" desc nulls last`
            : input.sort === "sales"
              ? '"salesCount" desc, "createdAt" desc'
              : input.sort === "discount"
                ? '(coalesce("oldPriceCents", "priceCents") - "priceCents") desc'
                : '"createdAt" desc';

    values.push(input.limit, offset);
    const baseQuery = `
      select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
              p.delivery_type as "deliveryType", p.server, p.platform, p.metadata,
              p.section_id as "sectionId", p.schema_version as "schemaVersion",
              p.product_type as "productType", p.old_price_cents as "oldPriceCents",
              p.sales_count as "salesCount", p.is_hot as "isHot", p.is_recommended as "isRecommended",
              p.created_at as "createdAt",
              c.slug as "categorySlug", c.name as "categoryName",
              g.slug as "gameSlug", g.name as "gameName",
              gs.slug as "sectionSlug", gs.name as "sectionName",
              u.id as "sellerId", u.display_name as "sellerDisplayName",
              coalesce(avg(r.rating), 0)::float as "sellerRating",
              count(distinct r.id)::int as "sellerReviewCount",
              count(distinct pf.user_id)::int as "favoriteCount",
              ${mediaAgg}
      from products p
      join categories c on c.id = p.category_id
      left join games g on g.id = p.game_id
      left join game_sections gs on gs.id = p.section_id
      join users u on u.id = p.seller_id
      left join reviews r on r.seller_id = u.id
      left join product_favorites pf on pf.product_id = p.id
      left join product_media pm on pm.product_id = p.id and pm.status = 'approved'
      where ${where.join(" and ")}
      group by p.id, c.id, g.id, gs.id, u.id
      ${having.length ? `having ${having.join(" and ")}` : ""}
    `;
    const result = await pool.query(
      `with filtered as (${baseQuery})
       select filtered.*, count(*) over()::int as total
       from filtered
       order by ${orderBy}
       limit $${values.length - 1} offset $${values.length}`,
      values
    );
    const total = result.rows[0]?.total ?? 0;
    const products = await attachCardMetadata(addSellerPresence(result.rows.map(({ total: _total, ...row }) => row)));
    const payload = { products, page: input.page, limit: input.limit, total };
    await cacheSet(cacheKey, payload, 30);
    res.json(payload);
  })
);

router.get(
  "/products/:id",
  authenticateOptional,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const viewer = (req as Partial<AuthedRequest>).user;
    // Only fully public payloads are ever cached (see cacheSet below), so a cache hit is
    // always safe to serve to anyone.
    const cached = await cacheGet(`marketplace:product:${id}`);
    if (cached) return res.json(cached);
    const result = await pool.query(
      `select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
              p.status, p.delivery_type as "deliveryType",
              p.product_type as "productType", p.old_price_cents as "oldPriceCents",
              p.sales_count as "salesCount", p.is_hot as "isHot", p.is_recommended as "isRecommended",
              p.server, p.platform, p.metadata, p.created_at as "createdAt",
              p.schema_version as "schemaVersion",
              c.id as "categoryId", c.slug as "categorySlug", c.name as "categoryName",
              g.id as "gameId", g.slug as "gameSlug", g.name as "gameName",
              gs.id as "sectionId", gs.slug as "sectionSlug", gs.name as "sectionName",
              u.id as "sellerId", u.display_name as "sellerDisplayName",
              u.is_banned as "sellerIsBanned",
              coalesce(avg(r.rating), 0)::float as "sellerRating",
              count(distinct r.id)::int as "sellerReviewCount",
              count(distinct pf.user_id)::int as "favoriteCount",
              ${mediaAgg}
       from products p
       join categories c on c.id = p.category_id
       left join games g on g.id = p.game_id
       left join game_sections gs on gs.id = p.section_id
       join users u on u.id = p.seller_id
       left join reviews r on r.seller_id = u.id
       left join product_favorites pf on pf.product_id = p.id
       left join product_media pm on pm.product_id = p.id and pm.status = 'approved'
       where p.id = $1 and p.status != 'deleted'
       group by p.id, c.id, g.id, gs.id, u.id`,
      [id]
    );
    if (!result.rows[0]) throw notFound("Product not found");

    // Public visibility matches the list endpoint: active product, seller not banned.
    // (Unlike the list, a sold-out active product stays reachable by direct link - the
    // page shows real stock instead of 404ing bookmarks/SEO.) The owner and staff can
    // still open non-public listings as a preview.
    const detailRow = result.rows[0] as { status: string; sellerIsBanned: boolean; sellerId: string };
    const isPubliclyVisible = detailRow.status === "active" && !detailRow.sellerIsBanned;
    const canPreview = Boolean(viewer && (viewer.id === detailRow.sellerId || viewer.role === "admin" || viewer.role === "moderator"));
    if (!isPubliclyVisible && !canPreview) throw notFound("Product not found");
    const reviews = await pool.query(
      `select r.id, r.rating, r.comment, r.created_at as "createdAt",
              b.display_name as "buyerDisplayName",
              p.title as "productTitle"
       from reviews r
       join users b on b.id = r.buyer_id
       join orders o on o.id = r.order_id
       join products p on p.id = o.product_id
       where r.seller_id = $1
       order by r.created_at desc
       limit 5`,
      [result.rows[0].sellerId]
    );
    const row = result.rows[0];
    // Labels come from the *exact* schema version the lot was created under, not whatever
    // is currently active for the section - a later schema edit must never change how an
    // already-created lot displays.
    const metadataFields =
      row.sectionId && row.schemaVersion ? (await getSchemaByVersion(row.sectionId, row.schemaVersion))?.fields ?? [] : [];
    const { sellerIsBanned: _sellerIsBanned, ...publicRow } = row;
    const payload = { product: { ...addSellerPresence([publicRow])[0], metadataFields }, reviews: reviews.rows };
    // Never cache non-public payloads: owner/staff previews of paused or blocked listings
    // must not become servable to anonymous visitors through the cache.
    if (isPubliclyVisible) await cacheSet(`marketplace:product:${id}`, payload, 60);
    res.json(payload);
  })
);

export default router;
