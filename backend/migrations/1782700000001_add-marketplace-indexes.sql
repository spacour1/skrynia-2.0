-- Up Migration
-- Adds missing indexes for Stage 1 marketplace query patterns.
-- Rollback: drop the five indexes created below.

-- Default sort on /marketplace/products (sort=newest) scans the full active stock.
-- A partial index on (created_at DESC) covering only purchasable rows saves a sequential
-- scan of the products table on every unfiltered page load.
create index if not exists idx_products_active_newest
  on products(created_at desc)
  where status = 'active' and stock > 0;

-- "sales" sort (?sort=sales) without a targeted index forces a full table sort.
create index if not exists idx_products_active_sales
  on products(sales_count desc)
  where status = 'active' and stock > 0;

-- Game detail page: WHERE gs.game_id = $1 AND gs.is_active = true ORDER BY sort_order ASC.
-- Existing idx_game_sections_game covers (game_id, sort_order) but does not filter is_active,
-- so the planner has to re-check every section for the game. A partial index on active
-- sections only eliminates that extra filter step.
create index if not exists idx_game_sections_active
  on game_sections(game_id, sort_order)
  where is_active = true;

-- Games list: WHERE g.is_active = true ORDER BY popularity DESC.
-- The unique slug index does not help here; add a covering index for active games.
create index if not exists idx_games_active_popularity
  on games(popularity desc)
  where is_active = true;

-- Seller profile / admin: reviews by seller ordered newest first (currently only
-- idx_reviews_seller covers seller_id without a time component).
create index if not exists idx_reviews_seller_created
  on reviews(seller_id, created_at desc);
