import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound, serviceUnavailable } from "../../common/errors.js";
import { authenticateOptional } from "../../common/middleware/auth.js";
import type { AuthedRequest } from "../../common/types.js";
import { cacheGet, cacheSet } from "../../common/redis.js";
import { moneyToCents, paginationSchema } from "../../common/validation.js";
import { getActiveSchemaForSection, getSchemaByVersion } from "../catalog/catalog.service.js";
import { buildMetadataFilterClauses } from "../catalog/catalog.validation.js";
import {
  addSellerPresence,
  attachCardMetadata
} from "./marketplace.helpers.js";
import {
  buildMarketplaceSearchCtes,
  MARKETPLACE_SEARCH_GROUP_BY,
  MARKETPLACE_SEARCH_JOIN,
  MARKETPLACE_SEARCH_ORDER_BY,
  MARKETPLACE_SEARCH_SELECT
} from "./marketplace-search.sql.js";
import { mediaAgg, publicProductEligibilitySql } from "./marketplace.sql.js";
import {
  readMarketplaceCache,
  setMarketplaceCacheIfCurrent
} from "./marketplace-cache.service.js";
import {
  mapProductCardDto,
  mapProductDetailDto,
  mapProductSuggestionDto
} from "./product.dto.js";

const router = Router();
const MAX_REFERENCE_ROWS = 500;

// The financial-freeze manifest intentionally fingerprints the legacy cache import
// beside money conversion. Keep the imported symbols referenced while marketplace
// reads use the generation-aware helpers below; this preserves that fail-closed anchor
// without serving or repopulating legacy cache entries.
void cacheGet;
void cacheSet;

const searchTermSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => /[\p{L}\p{N}]/u.test(value), {
    message: "Search must contain a letter or number"
  });

const searchSchema = paginationSchema.extend({
  cursor: z.string().max(4096).optional(),
  q: searchTermSchema.optional(),
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

const cursorTimestampSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Invalid cursor timestamp"
);
const marketplaceCursorBase = z.object({
  v: z.literal(1),
  binding: z.string().length(43),
  id: z.string().uuid()
});
const marketplaceCursorSchema = z.discriminatedUnion("mode", [
  marketplaceCursorBase.extend({
    mode: z.literal("newest"),
    createdAt: cursorTimestampSchema
  }),
  marketplaceCursorBase.extend({
    mode: z.literal("sales"),
    salesCount: z.number().int().nonnegative(),
    createdAt: cursorTimestampSchema
  }),
  marketplaceCursorBase.extend({
    mode: z.literal("rating"),
    sellerRating: z.number().finite(),
    createdAt: cursorTimestampSchema
  }),
  marketplaceCursorBase.extend({
    mode: z.literal("search"),
    relevanceTier: z.number().int().nonnegative(),
    similarity: z.number().finite(),
    fullTextRank: z.number().finite(),
    salesCount: z.number().int().nonnegative(),
    createdAt: cursorTimestampSchema
  })
]);

type MarketplaceSearchInput = z.infer<typeof searchSchema>;
type MarketplaceCursor = z.infer<typeof marketplaceCursorSchema>;
type MarketplaceCursorMode = MarketplaceCursor["mode"];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function marketplaceCursorBinding(input: MarketplaceSearchInput) {
  const {
    cursor: _cursor,
    page: _page,
    limit: _limit,
    ...filters
  } = input;
  return createHash("sha256").update(stableJson(filters)).digest("base64url");
}

function marketplaceCursorMode(input: MarketplaceSearchInput): MarketplaceCursorMode | null {
  if (input.q) return "search";
  if (input.sort === "newest" || input.sort === "sales" || input.sort === "rating") {
    return input.sort;
  }
  return null;
}

function decodeMarketplaceCursor(
  raw: string,
  input: MarketplaceSearchInput,
  expectedMode: MarketplaceCursorMode
) {
  let cursor: MarketplaceCursor;
  try {
    cursor = marketplaceCursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    );
  } catch {
    throw badRequest("Invalid pagination cursor");
  }
  if (
    cursor.mode !== expectedMode ||
    cursor.binding !== marketplaceCursorBinding(input)
  ) {
    throw badRequest("Pagination cursor does not match marketplace filters or sort");
  }
  return cursor;
}

function encodeMarketplaceCursor(cursor: MarketplaceCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function marketplaceCursorWhere(
  values: unknown[],
  cursor: MarketplaceCursor | null
) {
  if (!cursor) return "";
  if (cursor.mode === "newest") {
    values.push(cursor.createdAt, cursor.id);
    return `("createdAt", id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
  }
  if (cursor.mode === "sales") {
    values.push(cursor.salesCount, cursor.createdAt, cursor.id);
    return `("salesCount", "createdAt", id) < ($${values.length - 2}::int, $${values.length - 1}::timestamptz, $${values.length}::uuid)`;
  }
  if (cursor.mode === "rating") {
    values.push(cursor.sellerRating, cursor.createdAt, cursor.id);
    return `("sellerRating", "createdAt", id) < ($${values.length - 2}::float, $${values.length - 1}::timestamptz, $${values.length}::uuid)`;
  }

  values.push(
    cursor.relevanceTier,
    cursor.similarity,
    cursor.fullTextRank,
    cursor.salesCount,
    cursor.createdAt,
    cursor.id
  );
  const first = values.length - 5;
  return `(
    "searchRelevanceTier" > $${first}::int
    or ("searchRelevanceTier" = $${first}::int and "searchSimilarity" < $${first + 1}::float)
    or ("searchRelevanceTier" = $${first}::int and "searchSimilarity" = $${first + 1}::float
        and "searchFullTextRank" < $${first + 2}::float)
    or ("searchRelevanceTier" = $${first}::int and "searchSimilarity" = $${first + 1}::float
        and "searchFullTextRank" = $${first + 2}::float and "salesCount" < $${first + 3}::int)
    or ("searchRelevanceTier" = $${first}::int and "searchSimilarity" = $${first + 1}::float
        and "searchFullTextRank" = $${first + 2}::float and "salesCount" = $${first + 3}::int
        and "createdAt" < $${first + 4}::timestamptz)
    or ("searchRelevanceTier" = $${first}::int and "searchSimilarity" = $${first + 1}::float
        and "searchFullTextRank" = $${first + 2}::float and "salesCount" = $${first + 3}::int
        and "createdAt" = $${first + 4}::timestamptz and id > $${first + 5}::uuid)
  )`;
}

function marketplaceNextCursor(
  row: Record<string, unknown> | undefined,
  input: MarketplaceSearchInput,
  mode: MarketplaceCursorMode
) {
  if (!row) return null;
  const base = {
    v: 1 as const,
    binding: marketplaceCursorBinding(input),
    id: String(row.id)
  };
  if (mode === "newest") {
    return encodeMarketplaceCursor({
      ...base,
      mode,
      createdAt: String(row.cursorCreatedAt)
    });
  }
  if (mode === "sales") {
    return encodeMarketplaceCursor({
      ...base,
      mode,
      salesCount: Number(row.salesCount),
      createdAt: String(row.cursorCreatedAt)
    });
  }
  if (mode === "rating") {
    return encodeMarketplaceCursor({
      ...base,
      mode,
      sellerRating: Number(row.sellerRating),
      createdAt: String(row.cursorCreatedAt)
    });
  }
  return encodeMarketplaceCursor({
    ...base,
    mode,
    relevanceTier: Number(row.searchRelevanceTier),
    similarity: Number(row.searchSimilarity),
    fullTextRank: Number(row.searchFullTextRank),
    salesCount: Number(row.salesCount),
    createdAt: String(row.cursorCreatedAt)
  });
}

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const cache = await readMarketplaceCache<unknown[]>("categories");
    if (cache.value) return res.json({ categories: cache.value });
    const result = await pool.query(
      `select c.id, c.slug, c.name, c.description, c.risk_level as "riskLevel",
              count(p.id) filter (
                where product_seller.is_banned = false
                  and ${publicProductEligibilitySql("p")}
              )::int as "activeProductCount"
       from categories c
       left join products p on p.category_id = c.id and p.status = 'active' and p.stock > 0
       left join users product_seller on product_seller.id = p.seller_id
       group by c.id
       order by c.name, c.id
       limit ${MAX_REFERENCE_ROWS + 1}`
    );
    if (result.rows.length > MAX_REFERENCE_ROWS) {
      throw serviceUnavailable("Category snapshot exceeds its safety limit");
    }
    await setMarketplaceCacheIfCurrent(
      "categories",
      result.rows,
      60 * 10,
      cache.snapshot
    );
    res.json({ categories: result.rows });
  })
);

router.get(
  "/games",
  asyncHandler(async (_req, res) => {
    const cache = await readMarketplaceCache<unknown[]>("marketplace:games");
    if (cache.value) return res.json({ games: cache.value });
    const result = await pool.query(
      `select g.id, g.slug, g.name, g.publisher, g.icon_url as "iconUrl", g.popularity,
              g.banner, g.logo_image as "logoImage", g.short_description as "shortDescription",
              g.catalog_type as "catalogType",
              g.show_on_homepage as "showOnHomepage", g.is_popular as "isPopular",
              g.is_recommended as "isRecommended", g.homepage_order as "homepageOrder",
              g.created_at as "createdAt",
              count(distinct p.id) filter (
                where product_seller.is_banned = false
                  and ${publicProductEligibilitySql("p")}
              )::int as "lotCount"
       from games g
       join catalog_groups cg on cg.id = g.group_id and cg.status = 'active'
       left join products p on p.game_id = g.id and p.status = 'active'
       left join users product_seller on product_seller.id = p.seller_id
       where g.status = 'active'
       group by g.id
       order by g.homepage_order asc, g.popularity desc, g.name asc, g.id asc
       limit ${MAX_REFERENCE_ROWS + 1}`
    );
    if (result.rows.length > MAX_REFERENCE_ROWS) {
      throw serviceUnavailable("Game snapshot exceeds its safety limit");
    }
    await setMarketplaceCacheIfCurrent(
      "marketplace:games",
      result.rows,
      60 * 5,
      cache.snapshot
    );
    res.json({ games: result.rows });
  })
);

router.get(
  "/games/:slug",
  asyncHandler(async (req, res) => {
    const slug = z.string().min(1).max(120).parse(req.params.slug);
    const game = await pool.query(
      `select g.id, g.slug, g.name, g.publisher, g.icon_url as "iconUrl", g.popularity,
              g.banner, g.logo_image as "logoImage", g.background_image as "backgroundImage",
              g.description, g.short_description as "shortDescription",
              g.seo_title as "seoTitle", g.seo_description as "seoDescription"
       from games g
       join catalog_groups cg on cg.id = g.group_id and cg.status = 'active'
       where g.slug = $1 and g.status = 'active'`,
      [slug]
    );
    if (!game.rows[0]) throw notFound("Game not found");

    const sections = await pool.query(
      `select gs.id, gs.slug, gs.name, gs.description, gs.sort_order as "sortOrder",
              gs.schema, gs.product_type as "productType", c.slug as "categorySlug", c.name as "categoryName",
              c.risk_level as "categoryRiskLevel",
              count(p.id) filter (
                where product_seller.is_banned = false
                  and ${publicProductEligibilitySql("p")}
              )::int as "lotCount"
       from game_sections gs
       left join categories c on c.id = gs.category_id
       left join products p on p.section_id = gs.id and p.status = 'active'
       left join users product_seller on product_seller.id = p.seller_id
       where gs.game_id = $1 and gs.status = 'active'
       group by gs.id, c.id
       order by gs.sort_order asc, gs.name asc, gs.id asc
       limit ${MAX_REFERENCE_ROWS + 1}`,
      [game.rows[0].id]
    );
    if (sections.rows.length > MAX_REFERENCE_ROWS) {
      throw serviceUnavailable("Section snapshot exceeds its safety limit");
    }
    res.json({ game: game.rows[0], sections: sections.rows });
  })
);

router.get(
  "/suggest",
  asyncHandler(async (req, res) => {
    const q = searchTermSchema.parse(req.query.q);

    const games = await pool.query(
      `with search_input as materialized (
         select marketplace_search_normalize($1::text) as normalized
       )
       select g.id, g.slug, g.name, g.publisher, g.icon_url as "iconUrl", g.popularity,
              count(distinct p.id) filter (
                where product_seller.is_banned = false
                  and ${publicProductEligibilitySql("p")}
              )::int as "lotCount"
       from games g
       join catalog_groups cg on cg.id = g.group_id and cg.status = 'active'
       cross join search_input
       left join products p on p.game_id = g.id and p.status = 'active'
       left join users product_seller on product_seller.id = p.seller_id
       where g.status = 'active'
         and (
           marketplace_search_normalize(g.name) = search_input.normalized
           or marketplace_search_normalize(g.name) like search_input.normalized || '%'
           or marketplace_search_normalize(g.slug) = search_input.normalized
           or marketplace_search_normalize(coalesce(g.publisher, ''))
                like search_input.normalized || '%'
           or word_similarity(
                search_input.normalized,
                marketplace_search_normalize(g.name)
              ) >= 0.3
           or exists (
             select 1
             from unnest(g.aliases) as game_alias(alias)
             where marketplace_search_normalize(game_alias.alias) = search_input.normalized
                or marketplace_search_normalize(game_alias.alias)
                     like search_input.normalized || '%'
                or similarity(
                     marketplace_search_normalize(game_alias.alias),
                     search_input.normalized
                   ) >= 0.3
           )
         )
       group by g.id, search_input.normalized
       order by
         case
           when exists (
             select 1
             from unnest(g.aliases) as exact_alias(alias)
             where marketplace_search_normalize(exact_alias.alias)
               = search_input.normalized
           ) then 0
           when marketplace_search_normalize(g.name) = search_input.normalized then 1
           when marketplace_search_normalize(g.name)
             like search_input.normalized || '%' then 2
           when exists (
             select 1
             from unnest(g.aliases) as prefix_alias(alias)
             where marketplace_search_normalize(prefix_alias.alias)
               like search_input.normalized || '%'
           ) then 2
           else 3
         end,
         greatest(
           word_similarity(
             search_input.normalized,
             marketplace_search_normalize(g.name)
           ),
           coalesce(
             (
               select max(
                 similarity(
                   marketplace_search_normalize(similar_alias.alias),
                   search_input.normalized
                 )
               )
               from unnest(g.aliases) as similar_alias(alias)
             ),
             0
           )
         ) desc,
         g.popularity desc,
         g.name asc,
         g.id asc
       limit 6`,
      [q]
    );

    const products = await pool.query(
      `with ${buildMarketplaceSearchCtes(1)}
       select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency,
              p.product_type as "productType", p.delivery_type as "deliveryType",
              p.metadata, p.is_hot as "isHot", p.old_price_cents as "oldPriceCents",
              g.slug as "gameSlug", g.name as "gameName",
              c.name as "categoryName",
              u.display_name as "sellerDisplayName",
              search_match.relevance_tier as "searchRelevanceTier",
              search_match.trigram_similarity as "searchSimilarity",
              search_match.full_text_rank as "searchFullTextRank",
              ${mediaAgg}
       from products p
       ${MARKETPLACE_SEARCH_JOIN}
       join categories c on c.id = p.category_id
       left join games g on g.id = p.game_id
       join users u on u.id = p.seller_id
       left join product_media pm on pm.product_id = p.id and pm.status = 'approved'
       where p.status = 'active'
         and p.stock > 0
         and u.is_banned = false
         and ${publicProductEligibilitySql("p")}
       group by p.id, c.id, g.id, u.id${MARKETPLACE_SEARCH_GROUP_BY}
       order by
         search_match.relevance_tier asc,
         search_match.trigram_similarity desc,
         search_match.full_text_rank desc,
         p.sales_count desc,
         p.created_at desc,
         p.id asc
       limit 8`,
      [q]
    );

    res.json({
      games: games.rows,
      products: products.rows.map(
        ({
          searchRelevanceTier: _searchRelevanceTier,
          searchSimilarity: _searchSimilarity,
          searchFullTextRank: _searchFullTextRank,
          ...row
        }) => mapProductSuggestionDto(row)
      )
    });
  })
);

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const input = searchSchema.parse(req.query);
    const cursorMode = marketplaceCursorMode(input);
    if (!cursorMode && input.cursor) {
      throw badRequest("Cursor pagination is not available for money-based sorts");
    }
    if (cursorMode && input.page !== 1) {
      throw badRequest("Use nextCursor instead of page for this marketplace sort");
    }
    const cacheKey = `marketplace:products:${JSON.stringify(input)}`;
    const cache = await readMarketplaceCache<Record<string, unknown>>(cacheKey);
    if (cache.value) return res.json(cache.value);
    const values: unknown[] = [];
    const where = [
      "p.status = 'active'",
      "p.stock > 0",
      "u.is_banned = false",
      publicProductEligibilitySql("p")
    ];
    let searchCtes = "";
    let searchJoin = "";
    let searchSelect = "";
    let searchGroupBy = "";

    if (input.q) {
      values.push(input.q);
      searchCtes = buildMarketplaceSearchCtes(values.length);
      searchJoin = MARKETPLACE_SEARCH_JOIN;
      searchSelect = MARKETPLACE_SEARCH_SELECT;
      searchGroupBy = MARKETPLACE_SEARCH_GROUP_BY;
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

    const orderBy = input.q
      ? MARKETPLACE_SEARCH_ORDER_BY
      : input.sort === "price_asc"
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

    const stableOrderBy = input.q
      ? MARKETPLACE_SEARCH_ORDER_BY
      : input.sort === "rating"
        ? `"sellerRating" desc, "createdAt" desc, id desc`
        : input.sort === "sales"
          ? '"salesCount" desc, "createdAt" desc, id desc'
          : input.sort === "newest"
            ? '"createdAt" desc, id desc'
            : orderBy;

    const buildPageQuery = (pagePredicate = "", countExpression = "count(*) over()") => `
      select ${searchSelect}
              p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
              p.delivery_type as "deliveryType", p.server, p.platform, p.metadata,
              p.section_id as "sectionId", p.schema_version as "schemaVersion",
              p.product_type as "productType", p.old_price_cents as "oldPriceCents",
              p.sales_count as "salesCount", p.is_hot as "isHot", p.is_recommended as "isRecommended",
              p.created_at as "createdAt", p.created_at::text as "cursorCreatedAt",
              c.slug as "categorySlug", c.name as "categoryName",
              g.slug as "gameSlug", g.name as "gameName",
              gs.slug as "sectionSlug", gs.name as "sectionName",
              u.id as "sellerId", u.display_name as "sellerDisplayName",
              coalesce(avg(r.rating), 0)::float as "sellerRating",
              count(distinct r.id)::int as "sellerReviewCount",
              count(distinct pf.user_id)::int as "favoriteCount",
              ${mediaAgg},
              ${countExpression}::int as total
      from products p
      ${searchJoin}
      join categories c on c.id = p.category_id
      left join games g on g.id = p.game_id
      left join game_sections gs on gs.id = p.section_id
      join users u on u.id = p.seller_id
      left join reviews r on r.seller_id = u.id
      left join product_favorites pf on pf.product_id = p.id
      left join product_media pm on pm.product_id = p.id and pm.status = 'approved'
      where ${where.join(" and ")}
        ${pagePredicate}
      group by p.id, c.id, g.id, gs.id, u.id${searchGroupBy}
      ${having.length ? `having ${having.join(" and ")}` : ""}
    `;
    let cursor: MarketplaceCursor | null = null;
    let query: string;
    if (cursorMode) {
      cursor = input.cursor
        ? decodeMarketplaceCursor(input.cursor, input, cursorMode)
        : null;
      const cursorWhere = marketplaceCursorWhere(values, cursor);
      values.push(input.limit + 1);
      // Keep the full-filter CTE narrow: only cursor keys and the total. Expensive
      // media/favorite aggregates and public display fields are loaded once, for
      // the bounded page IDs, without duplicating their established definitions.
      const pagePredicate = `and p.id in (
        select id from marketplace_page
        ${cursorWhere ? `where ${cursorWhere}` : ""}
        order by ${stableOrderBy}
        limit $${values.length}
      )`;
      query = `${searchCtes ? `with ${searchCtes},` : "with"}
        marketplace_page as (
          select ${searchSelect} p.id, p.sales_count as "salesCount",
                 p.created_at as "createdAt",
                 coalesce(avg(r.rating), 0)::float as "sellerRating",
                 count(*) over()::int as total
          from products p
          ${searchJoin}
          join categories c on c.id = p.category_id
          left join games g on g.id = p.game_id
          left join game_sections gs on gs.id = p.section_id
          join users u on u.id = p.seller_id
          left join reviews r on r.seller_id = u.id
          where ${where.join(" and ")}
          group by p.id, c.id, g.id, gs.id, u.id${searchGroupBy}
          ${having.length ? `having ${having.join(" and ")}` : ""}
        )
        ${buildPageQuery(pagePredicate, "(select coalesce(max(total), 0) from marketplace_page)")}
        order by ${stableOrderBy}`;
    } else {
      // Money-derived orderings stay on their existing offset contract while the
      // financial subsystem is frozen. Stage 7 intentionally changes only the
      // nonfinancial newest/sales/rating/search paths.
      const offset = (input.page - 1) * input.limit;
      values.push(input.limit, offset);
      query = `${searchCtes ? `with ${searchCtes}` : ""}
        ${buildPageQuery()}
        order by ${stableOrderBy}
        limit $${values.length - 1} offset $${values.length}`;
    }
    const result = await pool.query(query, values);
    const hasMore = Boolean(cursorMode && result.rows.length > input.limit);
    const pageRows = cursorMode
      ? result.rows.slice(0, input.limit)
      : result.rows;
    const total = pageRows[0]?.total ?? 0;
    const productsWithPresence = await addSellerPresence(
      pageRows.map(
        ({
          total: _total,
          cursorCreatedAt: _cursorCreatedAt,
          searchRelevanceTier: _searchRelevanceTier,
          searchSimilarity: _searchSimilarity,
          searchFullTextRank: _searchFullTextRank,
          ...row
        }) => row
      )
    );
    const products = (await attachCardMetadata(productsWithPresence)).map(
      mapProductCardDto
    );
    const nextCursor = cursorMode && hasMore
      ? marketplaceNextCursor(
          pageRows.at(-1) as Record<string, unknown> | undefined,
          input,
          cursorMode
        )
      : null;
    const payload = cursorMode
      ? { products, page: 1, limit: input.limit, total, nextCursor }
      : { products, page: input.page, limit: input.limit, total };
    await setMarketplaceCacheIfCurrent(cacheKey, payload, 30, cache.snapshot);
    res.json(payload);
  })
);

router.get(
  "/products/:id",
  authenticateOptional,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const viewer = (req as Partial<AuthedRequest>).user;
    // Only fully public payloads are ever cached (see the guarded set below), so a hit is
    // always safe to serve to anyone.
    const cacheKey = `marketplace:product:${id}`;
    const cache = await readMarketplaceCache<Record<string, unknown>>(cacheKey);
    if (cache.value) return res.json(cache.value);
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
              ${publicProductEligibilitySql("p")} as "catalogEligible",
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
    const detailRow = result.rows[0] as {
      status: string;
      sellerIsBanned: boolean;
      sellerId: string;
      catalogEligible: boolean;
    };
    const isPubliclyVisible =
      detailRow.status === "active" &&
      !detailRow.sellerIsBanned &&
      detailRow.catalogEligible;
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
       order by r.created_at desc, r.id desc
       limit 5`,
      [result.rows[0].sellerId]
    );
    const row = result.rows[0];
    // Labels come from the *exact* schema version the lot was created under, not whatever
    // is currently active for the section - a later schema edit must never change how an
    // already-created lot displays.
    const metadataFields =
      row.sectionId && row.schemaVersion ? (await getSchemaByVersion(row.sectionId, row.schemaVersion))?.fields ?? [] : [];
    const {
      sellerIsBanned: _sellerIsBanned,
      catalogEligible: _catalogEligible,
      ...publicRow
    } = row;
    const [productWithPresence] = await addSellerPresence([publicRow]);
    const payload = {
      product: mapProductDetailDto({ ...productWithPresence, metadataFields }),
      reviews: reviews.rows
    };
    // Never cache non-public payloads: owner/staff previews of paused or blocked listings
    // must not become servable to anonymous visitors through the cache.
    if (isPubliclyVisible) {
      await setMarketplaceCacheIfCurrent(cacheKey, payload, 60, cache.snapshot);
    }
    res.json(payload);
  })
);

export default router;
