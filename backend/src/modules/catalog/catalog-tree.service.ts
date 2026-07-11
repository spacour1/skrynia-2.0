import { pool } from "../../db/pool.js";
import { notFound } from "../../common/errors.js";

export async function getPublicGroupBySlug(slug: string) {
  const group = await pool.query(
    `select id, slug, name, description, icon from catalog_groups where slug = $1 and status = 'active'`,
    [slug]
  );
  if (!group.rows[0]) throw notFound("Group not found");

  const items = await pool.query(
    `select id, slug, name, icon_url as "icon", banner
     from games where group_id = $1 and status = 'active' order by sort_order, name`,
    [group.rows[0].id]
  );
  return { ...group.rows[0], items: items.rows };
}

export async function getPublicItemBySlug(slug: string) {
  const item = await pool.query(
    `select id, group_id as "groupId", slug, name, icon_url as "icon", banner,
            description, short_description as "shortDescription", logo_image as "logoImage",
            background_image as "backgroundImage", seo_title as "seoTitle", seo_description as "seoDescription"
     from games where slug = $1 and status = 'active'`,
    [slug]
  );
  if (!item.rows[0]) throw notFound("Item not found");

  const sections = await pool.query(
    `select gs.id, gs.slug, gs.name, gs.product_type as "listingType", gs.allowed_delivery_types as "allowedDeliveryTypes",
            c.risk_level as "categoryRiskLevel"
     from game_sections gs
     left join categories c on c.id = gs.category_id
     where gs.game_id = $1 and gs.status = 'active'
     order by gs.sort_order, gs.name`,
    [item.rows[0].id]
  );
  return { ...item.rows[0], sections: sections.rows };
}

export async function getPublicCatalogTree() {
  const result = await pool.query(`
    select
      g.id, g.slug, g.name, g.description, g.icon,
      i.id as "itemId", i.slug as "itemSlug", i.name as "itemName", i.icon_url as "itemIcon", i.banner as "itemBanner",
      s.id as "sectionId", s.slug as "sectionSlug", s.name as "sectionName", s.product_type as "listingType",
      s.allowed_delivery_types as "allowedDeliveryTypes", c.risk_level as "categoryRiskLevel"
    from catalog_groups g
    join games i on i.group_id = g.id and i.status = 'active'
    join game_sections s on s.game_id = i.id and s.status = 'active'
    left join categories c on c.id = s.category_id
    where g.status = 'active'
    order by g.sort_order, i.sort_order, s.sort_order
  `);
  return buildTree(result.rows);
}

export async function getAdminCatalogTree() {
  const result = await pool.query(`
    select
      g.id, g.slug, g.name, g.description, g.icon, g.status,
      g.sort_order as "sortOrder", g.seo_title as "seoTitle", g.seo_description as "seoDescription",
      i.id as "itemId", i.slug as "itemSlug", i.name as "itemName", i.icon_url as "itemIcon", i.banner as "itemBanner", i.status as "itemStatus",
      i.sort_order as "itemSortOrder", i.seo_title as "itemSeoTitle", i.seo_description as "itemSeoDescription",
      i.description as "itemDescription", i.short_description as "itemShortDescription",
      i.logo_image as "itemLogoImage", i.background_image as "itemBackgroundImage",
      i.aliases as "itemAliases", i.catalog_type as "itemCatalogType", i.show_on_homepage as "itemShowOnHomepage",
      i.is_popular as "itemIsPopular", i.is_recommended as "itemIsRecommended", i.homepage_order as "itemHomepageOrder",
      (select count(*)::int from products p2 where p2.game_id = i.id and p2.status = 'active') as "itemActiveProductCount",
      s.id as "sectionId", s.slug as "sectionSlug", s.name as "sectionName", s.product_type as "listingType",
      s.allowed_delivery_types as "allowedDeliveryTypes", s.status as "sectionStatus", s.category_id as "categoryId",
      s.requires_moderation as "requiresModeration", s.sort_order as "sectionSortOrder",
      s.seo_title as "sectionSeoTitle", s.seo_description as "sectionSeoDescription",
      s.current_schema_version as "currentSchemaVersion",
      (select count(*)::int from products p where p.section_id = s.id) as "productCount"
    from catalog_groups g
    left join games i on i.group_id = g.id
    left join game_sections s on s.game_id = i.id
    order by g.sort_order, i.sort_order nulls last, s.sort_order nulls last
  `);
  return buildTree(result.rows, { includeStatus: true });
}

type TreeRow = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  status?: string;
  sortOrder?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  itemId?: string | null;
  itemSlug?: string;
  itemName?: string;
  itemIcon?: string | null;
  itemBanner?: string | null;
  itemStatus?: string;
  itemSortOrder?: number;
  itemSeoTitle?: string | null;
  itemSeoDescription?: string | null;
  itemDescription?: string | null;
  itemShortDescription?: string | null;
  itemLogoImage?: string | null;
  itemBackgroundImage?: string | null;
  itemAliases?: string[];
  itemCatalogType?: string;
  itemShowOnHomepage?: boolean;
  itemIsPopular?: boolean;
  itemIsRecommended?: boolean;
  itemHomepageOrder?: number;
  itemActiveProductCount?: number;
  sectionId?: string | null;
  sectionSlug?: string;
  sectionName?: string;
  listingType?: string;
  allowedDeliveryTypes?: string[];
  categoryId?: string | null;
  categoryRiskLevel?: string | null;
  requiresModeration?: boolean;
  sectionSortOrder?: number;
  sectionSeoTitle?: string | null;
  sectionSeoDescription?: string | null;
  sectionStatus?: string;
  currentSchemaVersion?: number | null;
  productCount?: number;
};

function buildTree(rows: TreeRow[], opts: { includeStatus?: boolean } = {}) {
  const groups = new Map<string, any>();

  for (const row of rows) {
    let group = groups.get(row.id);
    if (!group) {
      group = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description ?? null,
        icon: row.icon ?? null,
        ...(opts.includeStatus
          ? { status: row.status, sortOrder: row.sortOrder, seoTitle: row.seoTitle ?? null, seoDescription: row.seoDescription ?? null }
          : {}),
        items: new Map<string, any>()
      };
      groups.set(row.id, group);
    }

    if (!row.itemId) continue;
    let item = group.items.get(row.itemId);
    if (!item) {
      item = {
        id: row.itemId,
        slug: row.itemSlug,
        name: row.itemName,
        icon: row.itemIcon ?? null,
        banner: row.itemBanner ?? null,
        ...(opts.includeStatus
          ? {
              status: row.itemStatus,
              sortOrder: row.itemSortOrder,
              seoTitle: row.itemSeoTitle ?? null,
              seoDescription: row.itemSeoDescription ?? null,
              description: row.itemDescription ?? null,
              shortDescription: row.itemShortDescription ?? null,
              logoImage: row.itemLogoImage ?? null,
              backgroundImage: row.itemBackgroundImage ?? null,
              aliases: row.itemAliases ?? [],
              catalogType: row.itemCatalogType ?? "game",
              showOnHomepage: row.itemShowOnHomepage ?? true,
              isPopular: row.itemIsPopular ?? false,
              isRecommended: row.itemIsRecommended ?? false,
              homepageOrder: row.itemHomepageOrder ?? 0,
              activeProductCount: row.itemActiveProductCount ?? 0
            }
          : {}),
        sections: new Map<string, any>()
      };
      group.items.set(row.itemId, item);
    }

    if (!row.sectionId) continue;
    if (!item.sections.has(row.sectionId)) {
      item.sections.set(row.sectionId, {
        id: row.sectionId,
        slug: row.sectionSlug,
        name: row.sectionName,
        listingType: row.listingType,
        allowedDeliveryTypes: row.allowedDeliveryTypes,
        categoryRiskLevel: row.categoryRiskLevel ?? null,
        ...(opts.includeStatus
          ? {
              status: row.sectionStatus,
              currentSchemaVersion: row.currentSchemaVersion,
              productCount: row.productCount,
              categoryId: row.categoryId ?? null,
              requiresModeration: row.requiresModeration ?? false,
              sortOrder: row.sectionSortOrder,
              seoTitle: row.sectionSeoTitle ?? null,
              seoDescription: row.sectionSeoDescription ?? null
            }
          : {})
      });
    }
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    items: Array.from(group.items.values()).map((item: any) => ({
      ...item,
      sections: Array.from(item.sections.values())
    }))
  }));
}
