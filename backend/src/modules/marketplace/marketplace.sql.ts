export const mediaAgg = `coalesce(
  jsonb_agg(jsonb_build_object('id', pm.id, 'url', pm.url, 'type', pm.type) order by pm.sort_order)
    filter (where pm.id is not null),
  '[]'::jsonb
) as media`;

// Sellers get to see moderation status for their own media; public listings only
// surface approved media via the join filter in the route query.
export const mediaAggWithStatus = `coalesce(
  jsonb_agg(jsonb_build_object('id', pm.id, 'url', pm.url, 'type', pm.type, 'status', pm.status) order by pm.sort_order)
    filter (where pm.id is not null),
  '[]'::jsonb
) as media`;

export const productSelect = `
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
`;
