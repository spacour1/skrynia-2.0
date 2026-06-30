import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

const passwordHash = await bcrypt.hash("Password123!", 12);

const baseUsers = [
  ["admin@example.com", "Admin", "admin", null],
  ["moderator@example.com", "Moderator", "moderator", null],
  ["buyer@example.com", "Demo Buyer", "user", null]
];

const sellers = [
  {
    email: "nova.accounts@example.com",
    displayName: "Nova Accounts",
    avatarUrl: "/avatars/nova-accounts.svg",
    settings: { headline: "Verified account transfers", responseTime: "15 min", specialty: "Steam, CS2, Valorant" },
    lots: [
      ["Steam account with 42 games", "Clean Steam account with full email access, region change available, and transfer instructions included.", "accounts", "steam", "accounts", "account", 129900, 149900, "Global", "PC", true, true],
      ["Valorant account: Platinum rank", "Valorant account with original email, stable history, and seller support during transfer.", "accounts", "valorant", "accounts", "account", 179900, null, "EU", "PC", false, true]
    ]
  },
  {
    email: "pixel.boost@example.com",
    displayName: "Pixel Boost Studio",
    avatarUrl: "/avatars/pixel-boost.svg",
    settings: { headline: "Rank boosting with reports", responseTime: "30 min", specialty: "Dota 2, CS2, Fortnite" },
    lots: [
      ["Dota 2 MMR boost 500 points", "Careful MMR boosting with schedule agreement, progress reports, and no third-party chat required.", "boosting", "dota-2", "mmr-boosting", "boosting", 219900, 249900, "EU", "PC", true, false],
      ["CS2 Premier calibration help", "Calibration support for Premier mode with match planning and post-order report.", "boosting", "cs2", "boosting", "boosting", 89900, null, "EU", "PC", false, true]
    ]
  },
  {
    email: "keyforge.market@example.com",
    displayName: "KeyForge Market",
    avatarUrl: "/avatars/keyforge-market.svg",
    settings: { headline: "Instant keys and codes", responseTime: "5 min", specialty: "Game keys, subscriptions" },
    lots: [
      ["Minecraft Java activation key", "Instant delivery key with activation instructions and replacement guarantee if the code is not valid.", "digital-services", "minecraft", "keys", "key", 74900, 89900, "Global", "PC", false, true],
      ["PlayStation wallet top up", "Manual wallet top up for PlayStation accounts. Region and account details are confirmed in order chat.", "currency", "playstation", "top-up", "topup", 109900, null, "EU", "PlayStation", false, false]
    ]
  },
  {
    email: "raid.supply@example.com",
    displayName: "Raid Supply",
    avatarUrl: "/avatars/raid-supply.svg",
    settings: { headline: "Items and currency supply", responseTime: "20 min", specialty: "WoW, Genshin, MMO goods" },
    lots: [
      ["World of Warcraft gold pack", "Gold delivery for selected server and faction. Seller confirms stock before payment capture.", "currency", "world-of-warcraft", "gold", "currency", 159900, 179900, "EU", "PC", true, false],
      ["Genshin Impact crystals top up", "Top up through UID after order confirmation. Buyer receives delivery proof in the order chat.", "currency", "genshin-impact", "top-up", "topup", 69900, null, "Global", "Mobile/PC", false, true]
    ]
  }
] as const;

for (const [email, displayName, role, avatarUrl] of baseUsers) {
  const result = await pool.query<{ id: string }>(
    `insert into users(email, password_hash, display_name, role, avatar_url)
     values ($1, $2, $3, $4, $5)
     on conflict (email) do update set
       display_name = excluded.display_name,
       role = excluded.role,
       avatar_url = excluded.avatar_url,
       updated_at = now()
     returning id`,
    [email, passwordHash, displayName, role, avatarUrl]
  );
  await pool.query(`insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`, [result.rows[0].id]);
}

await pool.query(`delete from messages`);
await pool.query(`delete from conversations`);
await pool.query(`delete from product_favorites`);
await pool.query(`delete from seller_favorites`);
await pool.query(`update products set status = 'deleted', updated_at = now() where status != 'deleted'`);
await pool.query(`delete from products p where p.status = 'deleted' and not exists (select 1 from orders o where o.product_id = p.id)`);

async function getCategoryId(slug: string) {
  const result = await pool.query<{ id: string }>(`select id from categories where slug = $1`, [slug]);
  return result.rows[0]?.id;
}

async function getGame(slug: string) {
  const result = await pool.query<{ id: string }>(`select id from games where slug = $1`, [slug]);
  return result.rows[0]?.id ?? null;
}

async function getSection(gameId: string | null, slug: string) {
  if (!gameId) return null;
  const result = await pool.query<{ id: string }>(`select id from game_sections where game_id = $1 and slug = $2`, [gameId, slug]);
  return result.rows[0]?.id ?? null;
}

for (const seller of sellers) {
  const user = await pool.query<{ id: string }>(
    `insert into users(email, password_hash, display_name, role, avatar_url, settings)
     values ($1, $2, $3, 'user', $4, $5::jsonb)
     on conflict (email) do update set
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       settings = excluded.settings,
       updated_at = now()
     returning id`,
    [seller.email, passwordHash, seller.displayName, seller.avatarUrl, JSON.stringify(seller.settings)]
  );
  await pool.query(`insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`, [user.rows[0].id]);

  for (const [title, description, categorySlug, gameSlug, sectionSlug, productType, priceCents, oldPriceCents, server, platform, isHot, isRecommended] of seller.lots) {
    const categoryId = await getCategoryId(categorySlug);
    if (!categoryId) continue;
    const gameId = await getGame(gameSlug);
    const sectionId = await getSection(gameId, sectionSlug);
    await pool.query(
      `insert into products(
         seller_id, category_id, game_id, section_id, title, description, price_cents, old_price_cents,
         currency, stock, delivery_type, product_type, server, platform, metadata, is_hot, is_recommended, status
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'UAH', 5, 'manual', $9, $10, $11, '{}'::jsonb, $12, $13, 'active')`,
      [user.rows[0].id, categoryId, gameId, sectionId, title, description, priceCents, oldPriceCents, productType, server, platform, isHot, isRecommended]
    );
  }
}

await pool.end();
console.log("Seed data inserted");
