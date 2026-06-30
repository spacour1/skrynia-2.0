import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { requireRole } from "../../common/middleware/rbac.js";
import { cacheDel, cacheDelPattern, cacheGet, cacheSet } from "../../common/redis.js";
import { moneyToCents, paginationSchema } from "../../common/validation.js";
import type { AuthedRequest } from "../../common/types.js";
import { isUserOnline } from "../chat/ws.service.js";

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

const searchSchema = paginationSchema.extend({
  q: z.string().optional(),
  category: z.string().optional(),
  game: z.string().optional(),
  section: z.string().optional(),
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
      `select id, slug, name, description, risk_level as "riskLevel" from categories order by name`
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
              count(distinct p.id)::int as "lotCount"
       from games g
       left join products p on p.game_id = g.id and p.status = 'active'
       where g.is_active = true
       group by g.id
       order by g.popularity desc, g.name asc`
    );
    await cacheSet("marketplace:games", result.rows, 60 * 5);
    res.json({ games: result.rows });
  })
);

const mediaAgg = `coalesce(
  jsonb_agg(jsonb_build_object('id', pm.id, 'url', pm.url, 'type', pm.type) order by pm.sort_order)
    filter (where pm.id is not null),
  '[]'::jsonb
) as media`;

// Sellers get to see the moderation status of their own media (e.g. a rejected upload);
// public-facing listings above only ever surface approved media via the pm join filter.
const mediaAggWithStatus = `coalesce(
  jsonb_agg(jsonb_build_object('id', pm.id, 'url', pm.url, 'type', pm.type, 'status', pm.status) order by pm.sort_order)
    filter (where pm.id is not null),
  '[]'::jsonb
) as media`;

const productSelect = `
  select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
         p.delivery_type as "deliveryType", p.server, p.platform, p.metadata,
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
`;

function addSellerPresence<T extends { sellerId?: string }>(rows: T[]) {
  return rows.map((row) => ({
    ...row,
    sellerOnline: row.sellerId ? isUserOnline(row.sellerId) : false
  }));
}

router.get(
  "/favorites/ids",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select product_id as "productId" from product_favorites where user_id = $1 order by created_at desc`,
      [req.user.id]
    );
    res.json({ productIds: result.rows.map((row) => row.productId) });
  })
);

router.get(
  "/favorites",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `${productSelect}
       join product_favorites own_favorite on own_favorite.product_id = p.id and own_favorite.user_id = $1
       where p.status = 'active' and p.stock > 0 and u.is_banned = false
       group by p.id, c.id, g.id, gs.id, u.id
       order by max(own_favorite.created_at) desc`,
      [req.user.id]
    );
    res.json({ products: addSellerPresence(result.rows) });
  })
);

router.put(
  "/favorites/:productId",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    const product = await pool.query(`select id from products where id = $1 and status = 'active'`, [productId]);
    if (!product.rows[0]) throw notFound("Product not found");
    await pool.query(
      `insert into product_favorites(user_id, product_id) values ($1, $2) on conflict do nothing`,
      [req.user.id, productId]
    );
    res.json({ ok: true, liked: true });
  })
);

router.delete(
  "/favorites/:productId",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    await pool.query(`delete from product_favorites where user_id = $1 and product_id = $2`, [req.user.id, productId]);
    res.json({ ok: true, liked: false });
  })
);

router.get(
  "/games/:slug",
  asyncHandler(async (req, res) => {
    const slug = z.string().min(1).max(120).parse(req.params.slug);
    const game = await pool.query(
      `select id, slug, name, publisher, icon_url as "iconUrl", popularity
       from games
       where slug = $1 and is_active = true`,
      [slug]
    );
    if (!game.rows[0]) throw notFound("Game not found");

    const sections = await pool.query(
      `select gs.id, gs.slug, gs.name, gs.description, gs.sort_order as "sortOrder",
              gs.schema, gs.product_type as "productType", c.slug as "categorySlug", c.name as "categoryName",
              c.risk_level as "categoryRiskLevel", count(p.id)::int as "lotCount"
       from game_sections gs
       left join categories c on c.id = gs.category_id
       left join products p on p.section_id = gs.id and p.status = 'active'
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
              count(distinct p.id)::int as "lotCount"
       from games g
       left join products p on p.game_id = g.id and p.status = 'active'
       where g.is_active = true
         and (g.name ilike $1 or g.slug ilike $1 or coalesce(g.publisher, '') ilike $1)
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
    const products = addSellerPresence(result.rows.map(({ total: _total, ...row }) => row));
    const payload = { products, page: input.page, limit: input.limit, total };
    await cacheSet(cacheKey, payload, 30);
    res.json(payload);
  })
);

router.get(
  "/products/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const cached = await cacheGet(`marketplace:product:${id}`);
    if (cached) return res.json(cached);
    const result = await pool.query(
      `select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
              p.status, p.delivery_type as "deliveryType",
              p.product_type as "productType", p.old_price_cents as "oldPriceCents",
              p.sales_count as "salesCount", p.is_hot as "isHot", p.is_recommended as "isRecommended",
              p.server, p.platform, p.metadata, p.created_at as "createdAt",
              c.id as "categoryId", c.slug as "categorySlug", c.name as "categoryName",
              g.id as "gameId", g.slug as "gameSlug", g.name as "gameName",
              gs.id as "sectionId", gs.slug as "sectionSlug", gs.name as "sectionName",
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
       where p.id = $1 and p.status != 'deleted'
       group by p.id, c.id, g.id, gs.id, u.id`,
      [id]
    );
    if (!result.rows[0]) throw notFound("Product not found");
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
    const payload = { product: addSellerPresence([result.rows[0]])[0], reviews: reviews.rows };
    await cacheSet(`marketplace:product:${id}`, payload, 60);
    res.json(payload);
  })
);

router.get(
  "/seller/products",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
              p.status, p.delivery_type as "deliveryType", p.server, p.platform, p.metadata,
              p.product_type as "productType", p.old_price_cents as "oldPriceCents",
              p.sales_count as "salesCount", p.is_hot as "isHot", p.is_recommended as "isRecommended",
              p.created_at as "createdAt",
              c.id as "categoryId", c.name as "categoryName",
              g.id as "gameId", g.name as "gameName",
              gs.id as "sectionId", gs.name as "sectionName",
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
    res.json({ products: addSellerPresence(result.rows) });
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

/**
 * The category — and product type — a product belongs to must follow from its section,
 * not from whatever the client happened to send (the frontend used to guess productType
 * from the section's name via regex; that guess can now disagree with the section's own
 * record). When a sectionId is given, look up the section's own
 * game_id/category_id/product_type and use those, ignoring (and validating) any
 * client-supplied values.
 */
async function resolveCategorization(input: { categoryId?: string | null; gameId?: string | null; sectionId?: string | null }) {
  if (input.sectionId) {
    const section = await pool.query(
      `select id, game_id as "gameId", category_id as "categoryId", product_type as "productType"
       from game_sections where id = $1`,
      [input.sectionId]
    );
    if (!section.rows[0]) throw notFound("Section not found");
    if (input.gameId && input.gameId !== section.rows[0].gameId) {
      throw badRequest("Section does not belong to the selected game");
    }
    return {
      categoryId: section.rows[0].categoryId as string,
      gameId: section.rows[0].gameId as string,
      sectionId: section.rows[0].id as string,
      productType: section.rows[0].productType as string
    };
  }
  if (!input.categoryId) throw badRequest("categoryId or sectionId is required");
  return { categoryId: input.categoryId, gameId: input.gameId ?? null, sectionId: null, productType: null };
}

router.post(
  "/products",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = productSchema.parse(req.body);
    const categorization = await resolveCategorization(input);
    const result = await pool.query(
      `insert into products(
         seller_id, category_id, game_id, section_id, title, description, price_cents, old_price_cents,
         currency, stock, delivery_type, product_type, server, platform, delivery_template, metadata
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        input.metadata
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

/**
 * Builds an `update ... set col = $n, ...` clause distinguishing three states per field:
 * undefined (omitted by the client) leaves the column untouched, null explicitly clears it,
 * and any other value overwrites it. `coalesce($n, column)` can't express "clear to null"
 * since coalesce always falls back to the existing value when given null.
 */
function buildDynamicUpdate(id: string, fields: Record<string, unknown>) {
  const values: unknown[] = [id];
  const sets: string[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  return { sets, values };
}

router.patch(
  "/products/:id",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = productPatchSchema.parse(req.body);

    const existing = await pool.query(`select seller_id from products where id = $1 and status != 'deleted'`, [id]);
    if (!existing.rows[0]) throw notFound("Product not found");
    if (existing.rows[0].seller_id !== req.user.id && req.user.role !== "admin") throw forbidden();

    // Only re-derive categorization when the caller is actually changing the section;
    // otherwise leave category/game/section untouched rather than trusting a stray categoryId.
    // sectionId === null is a deliberate "detach from this section" request and needs its
    // own categoryId to fall back to, same as creating a sectionless listing does.
    let categorization: { categoryId?: string | null; gameId?: string | null; sectionId?: string | null; productType?: string | null };
    if (input.sectionId) {
      categorization = await resolveCategorization(input);
    } else if (input.sectionId === null) {
      if (!input.categoryId) throw badRequest("categoryId is required when clearing sectionId");
      categorization = { categoryId: input.categoryId, gameId: input.gameId ?? null, sectionId: null, productType: input.productType };
    } else {
      categorization = { categoryId: input.categoryId, gameId: input.gameId, sectionId: undefined, productType: undefined };
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
      product_type: categorization.productType ?? input.productType,
      old_price_cents: oldPriceCents,
      server: input.server,
      platform: input.platform,
      delivery_template: input.deliveryTemplate,
      // metadata's column is `not null default '{}'`, so an explicit null "clears" to {}
      // rather than to an actual SQL null.
      metadata: input.metadata === null ? {} : input.metadata,
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
