-- Up Migration
-- Baseline snapshot of the schema as it existed before adopting node-pg-migrate.
-- No down migration: rolling back the initial schema isn't a meaningful operation.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text,
  display_name text not null,
  role text not null default 'user' check (role in ('user', 'seller', 'admin')),
  telegram_id text unique,
  avatar_url text,
  push_enabled boolean not null default false,
  two_factor_enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  is_banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users add column if not exists avatar_url text;
alter table users add column if not exists push_enabled boolean not null default false;
alter table users add column if not exists two_factor_enabled boolean not null default false;
alter table users add column if not exists settings jsonb not null default '{}'::jsonb;

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  currency text not null default 'USD',
  available_cents bigint not null default 0 check (available_cents >= 0),
  escrow_cents bigint not null default 0 check (escrow_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wallets drop constraint if exists wallets_user_id_key;
create unique index if not exists idx_wallets_user_currency_unique on wallets(user_id, currency);

create table if not exists wallet_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'UAH',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  payment_provider text,
  payment_reference text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_wallet_topups_user on wallet_topups(user_id, created_at desc);

create table if not exists platform_wallets (
  id uuid primary key default gen_random_uuid(),
  currency text unique not null default 'USD',
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists currency_rates (
  code text primary key,
  rate_to_uah numeric(18, 8) not null check (rate_to_uah > 0),
  source text not null default 'seed',
  as_of timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  publisher text,
  icon_url text,
  popularity integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists game_sections (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  category_id uuid references categories(id),
  slug text not null,
  name text not null,
  description text,
  sort_order integer not null default 0,
  schema jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(game_id, slug)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references users(id) on delete cascade,
  category_id uuid not null references categories(id),
  game_id uuid references games(id),
  section_id uuid references game_sections(id),
  title text not null,
  description text not null,
  price_cents bigint not null check (price_cents > 0),
  currency text not null default 'USD',
  delivery_type text not null default 'manual' check (delivery_type in ('manual', 'instant')),
  delivery_template text,
  product_type text not null default 'service' check (product_type in ('account', 'key', 'topup', 'boosting', 'service', 'item', 'currency')),
  old_price_cents bigint check (old_price_cents is null or old_price_cents > 0),
  sales_count integer not null default 0 check (sales_count >= 0),
  is_hot boolean not null default false,
  is_recommended boolean not null default false,
  server text,
  platform text,
  stock integer not null default 1 check (stock >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'blocked', 'deleted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references users(id),
  seller_id uuid not null references users(id),
  product_id uuid not null references products(id),
  quantity integer not null default 1 check (quantity > 0),
  amount_cents bigint not null check (amount_cents > 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending', 'paid', 'in_progress', 'delivered', 'completed', 'disputed', 'refunded')),
  payment_provider text,
  payment_reference text,
  delivery_note text,
  auto_release_at timestamptz,
  paid_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid references wallets(id),
  user_id uuid references users(id),
  order_id uuid references orders(id),
  type text not null check (type in ('payment_capture', 'escrow_hold', 'escrow_release', 'platform_fee', 'refund', 'wallet_credit', 'wallet_debit')),
  direction text not null check (direction in ('credit', 'debit', 'neutral')),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'USD',
  status text not null default 'posted' check (status in ('pending', 'posted', 'voided')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references users(id),
  seller_id uuid not null references users(id),
  product_id uuid references products(id),
  order_id uuid references orders(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_buyer on conversations(buyer_id, created_at desc);
create index if not exists idx_conversations_seller on conversations(seller_id, created_at desc);
-- One conversation per (buyer, seller, product); one "general" conversation per (buyer, seller)
-- when no product is attached. find-or-create relies on these as the ON CONFLICT targets.
create unique index if not exists idx_conversations_with_product
  on conversations(buyer_id, seller_id, product_id) where product_id is not null;
create unique index if not exists idx_conversations_without_product
  on conversations(buyer_id, seller_id) where product_id is null;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  sender_id uuid not null references users(id),
  body text not null,
  attachment_url text,
  created_at timestamptz not null default now()
);

-- Upgrade path: messages used to be keyed directly off a (fake) order. Relax that and
-- move chat threads onto conversations instead; backfill any pre-existing chat history.
alter table messages add column if not exists conversation_id uuid references conversations(id) on delete cascade;
alter table messages alter column order_id drop not null;

insert into conversations (buyer_id, seller_id, product_id, order_id, created_at)
select o.buyer_id, o.seller_id, o.product_id, o.id, min(m.created_at)
from orders o
join messages m on m.order_id = o.id
where m.conversation_id is null
group by o.id, o.buyer_id, o.seller_id, o.product_id
on conflict (buyer_id, seller_id, product_id) where product_id is not null
do update set order_id = coalesce(conversations.order_id, excluded.order_id);

update messages m
set conversation_id = c.id
from conversations c
where m.conversation_id is null
  and m.order_id = c.order_id;

create table if not exists ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'revenue', 'expense', 'equity')),
  currency text not null default 'USD',
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique not null,
  entry_type text not null check (entry_type in ('payment_capture', 'escrow_release', 'refund', 'adjustment')),
  order_id uuid references orders(id),
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ledger_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references ledger_entries(id) on delete restrict,
  account_id uuid not null references ledger_accounts(id),
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  check (
    (debit_cents > 0 and credit_cents = 0)
    or (credit_cents > 0 and debit_cents = 0)
  )
);

create table if not exists reconciliation_snapshots (
  id uuid primary key default gen_random_uuid(),
  currency text not null,
  wallet_available_cents bigint not null,
  wallet_escrow_cents bigint not null,
  ledger_payable_cents bigint not null,
  ledger_escrow_cents bigint not null,
  platform_revenue_cents bigint not null,
  ledger_revenue_cents bigint not null,
  provider_clearing_cents bigint not null,
  difference_cents bigint not null,
  status text not null check (status in ('balanced', 'mismatch')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  user_id uuid references users(id) on delete set null,
  method text not null,
  path text not null,
  endpoint text,
  status_code integer,
  ip_address inet,
  user_agent text,
  action text not null,
  request_body jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function prevent_financial_log_mutation()
returns trigger as $$
begin
  raise exception 'financial log rows are immutable';
end;
$$ language plpgsql;

drop trigger if exists transactions_immutable_update on transactions;
create trigger transactions_immutable_update
before update on transactions
for each row execute function prevent_financial_log_mutation();

drop trigger if exists transactions_immutable_delete on transactions;
create trigger transactions_immutable_delete
before delete on transactions
for each row execute function prevent_financial_log_mutation();

drop trigger if exists ledger_entries_immutable_update on ledger_entries;
create trigger ledger_entries_immutable_update
before update on ledger_entries
for each row execute function prevent_financial_log_mutation();

drop trigger if exists ledger_entries_immutable_delete on ledger_entries;
create trigger ledger_entries_immutable_delete
before delete on ledger_entries
for each row execute function prevent_financial_log_mutation();

drop trigger if exists ledger_lines_immutable_update on ledger_lines;
create trigger ledger_lines_immutable_update
before update on ledger_lines
for each row execute function prevent_financial_log_mutation();

drop trigger if exists ledger_lines_immutable_delete on ledger_lines;
create trigger ledger_lines_immutable_delete
before delete on ledger_lines
for each row execute function prevent_financial_log_mutation();

create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  type text not null,
  title text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references orders(id) on delete cascade,
  seller_id uuid not null references users(id),
  buyer_id uuid not null references users(id),
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references orders(id) on delete cascade,
  opened_by uuid not null references users(id),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('refund', 'release')),
  admin_id uuid references users(id),
  admin_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists listing_reports (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  reporter_id uuid not null references users(id),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists product_favorites (
  user_id uuid not null references users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists seller_favorites (
  user_id uuid not null references users(id) on delete cascade,
  seller_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, seller_id),
  check (user_id != seller_id)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table notifications add column if not exists conversation_id uuid references conversations(id) on delete cascade;

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  email text,
  subject text not null,
  body text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products add column if not exists game_id uuid references games(id);
alter table products add column if not exists section_id uuid references game_sections(id);
alter table products add column if not exists delivery_template text;
alter table products add column if not exists server text;
alter table products add column if not exists platform text;
alter table products add column if not exists product_type text not null default 'service';
alter table products add column if not exists old_price_cents bigint;
alter table products add column if not exists sales_count integer not null default 0;
alter table products add column if not exists is_hot boolean not null default false;
alter table products add column if not exists is_recommended boolean not null default false;

create index if not exists idx_products_category_status on products(category_id, status);
create index if not exists idx_products_game_section_status on products(game_id, section_id, status);
create index if not exists idx_products_seller_status on products(seller_id, status);
create index if not exists idx_products_type_flags on products(product_type, is_hot, is_recommended);
create index if not exists idx_products_search on products using gin (to_tsvector('english', title || ' ' || description));
create index if not exists idx_products_price_active on products(price_cents, status) where status = 'active';
create index if not exists idx_products_filter_facets on products(status, delivery_type, product_type, server, platform);
create index if not exists idx_reviews_seller_rating on reviews(seller_id, rating);
create index if not exists idx_orders_buyer_status on orders(buyer_id, status);
create index if not exists idx_orders_seller_status on orders(seller_id, status);
create index if not exists idx_orders_auto_release on orders(status, auto_release_at);
create index if not exists idx_transactions_order on transactions(order_id);
create index if not exists idx_transactions_user on transactions(user_id);
create index if not exists idx_ledger_entries_order on ledger_entries(order_id);
create index if not exists idx_ledger_entries_created on ledger_entries(created_at desc);
create index if not exists idx_ledger_lines_entry on ledger_lines(entry_id);
create index if not exists idx_ledger_lines_account on ledger_lines(account_id);
create index if not exists idx_reconciliation_snapshots_created on reconciliation_snapshots(created_at desc);
create index if not exists idx_audit_logs_user_created on audit_logs(user_id, created_at desc);
create index if not exists idx_audit_logs_trace on audit_logs(trace_id);
create index if not exists idx_audit_logs_path_created on audit_logs(path, created_at desc);
create index if not exists idx_messages_order_created on messages(order_id, created_at);
create index if not exists idx_order_events_order_created on order_events(order_id, created_at);
create index if not exists idx_reviews_seller on reviews(seller_id);
create index if not exists idx_disputes_status on disputes(status);
create index if not exists idx_game_sections_game on game_sections(game_id, sort_order);
create index if not exists idx_support_tickets_status on support_tickets(status);
create index if not exists idx_product_favorites_product on product_favorites(product_id);
create index if not exists idx_seller_favorites_seller on seller_favorites(seller_id);
create index if not exists idx_notifications_user_created on notifications(user_id, created_at desc);
create index if not exists idx_notifications_user_unread on notifications(user_id, read_at) where read_at is null;

insert into platform_wallets(currency, revenue_cents)
values ('USD', 0)
on conflict (currency) do nothing;

insert into platform_wallets(currency, revenue_cents)
values ('UAH', 0)
on conflict (currency) do nothing;

insert into currency_rates(code, rate_to_uah, source, as_of)
values
  ('UAH', 1, 'seed', now()),
  ('USD', 41.5, 'seed', now()),
  ('EUR', 48, 'seed', now())
on conflict (code) do nothing;

insert into categories(slug, name, description)
values
  ('games', 'Games', 'Game keys, items, and in-game goods'),
  ('accounts', 'Accounts', 'Digital accounts and profiles'),
  ('currency', 'In-game Currency', 'Gold, coins, credits, and virtual currency'),
  ('boosting', 'Boosting', 'Rank, leveling, coaching, and progression services'),
  ('digital-services', 'Digital Services', 'Creative, technical, and online services')
on conflict (slug) do nothing;

insert into games(slug, name, publisher, popularity)
values
  ('cs2', 'Counter-Strike 2', 'Valve', 1000),
  ('dota-2', 'Dota 2', 'Valve', 950),
  ('fortnite', 'Fortnite', 'Epic Games', 840),
  ('valorant', 'Valorant', 'Riot Games', 780),
  ('steam', 'Steam', 'Valve', 760),
  ('genshin-impact', 'Genshin Impact', 'HoYoverse', 720),
  ('minecraft', 'Minecraft', 'Mojang', 690),
  ('world-of-warcraft', 'World of Warcraft', 'Blizzard', 650),
  ('roblox', 'Roblox', 'Roblox Corporation', 640),
  ('league-of-legends', 'League of Legends', 'Riot Games', 630),
  ('apex-legends', 'Apex Legends', 'Electronic Arts', 620),
  ('pubg', 'PUBG: Battlegrounds', 'Krafton', 610),
  ('warface', 'Warface', 'MY.GAMES', 600),
  ('war-thunder', 'War Thunder', 'Gaijin', 590),
  ('world-of-tanks', 'World of Tanks', 'Wargaming', 580),
  ('escape-from-tarkov', 'Escape from Tarkov', 'Battlestate Games', 570),
  ('rainbow-six-siege', 'Rainbow Six Siege', 'Ubisoft', 560),
  ('overwatch-2', 'Overwatch 2', 'Blizzard', 550),
  ('rocket-league', 'Rocket League', 'Psyonix', 540),
  ('fifa', 'EA SPORTS FC', 'Electronic Arts', 530),
  ('gta-online', 'GTA Online', 'Rockstar Games', 520),
  ('rust', 'Rust', 'Facepunch Studios', 510),
  ('ark-survival', 'ARK: Survival', 'Studio Wildcard', 500),
  ('albion-online', 'Albion Online', 'Sandbox Interactive', 490),
  ('lost-ark', 'Lost Ark', 'Smilegate', 480),
  ('black-desert', 'Black Desert Online', 'Pearl Abyss', 470),
  ('final-fantasy-xiv', 'Final Fantasy XIV', 'Square Enix', 460),
  ('elder-scrolls-online', 'The Elder Scrolls Online', 'ZeniMax', 450),
  ('destiny-2', 'Destiny 2', 'Bungie', 440),
  ('diablo-iv', 'Diablo IV', 'Blizzard', 430),
  ('path-of-exile', 'Path of Exile', 'Grinding Gear Games', 420),
  ('honkai-star-rail', 'Honkai: Star Rail', 'HoYoverse', 410),
  ('zenless-zone-zero', 'Zenless Zone Zero', 'HoYoverse', 400),
  ('wuthering-waves', 'Wuthering Waves', 'Kuro Games', 390),
  ('clash-of-clans', 'Clash of Clans', 'Supercell', 380),
  ('clash-royale', 'Clash Royale', 'Supercell', 370),
  ('brawl-stars', 'Brawl Stars', 'Supercell', 360),
  ('mobile-legends', 'Mobile Legends', 'Moonton', 350),
  ('free-fire', 'Free Fire', 'Garena', 340),
  ('call-of-duty', 'Call of Duty', 'Activision', 330),
  ('call-of-duty-mobile', 'Call of Duty Mobile', 'Activision', 320),
  ('hearthstone', 'Hearthstone', 'Blizzard', 310),
  ('team-fortress-2', 'Team Fortress 2', 'Valve', 300),
  ('terraria', 'Terraria', 'Re-Logic', 290),
  ('standoff-2', 'Standoff 2', 'Axlebolt', 280),
  ('palworld', 'Palworld', 'Pocketpair', 270),
  ('helldivers-2', 'Helldivers 2', 'Arrowhead', 260),
  ('the-finals', 'The Finals', 'Embark Studios', 250),
  ('deadlock', 'Deadlock', 'Valve', 240),
  ('nintendo', 'Nintendo', 'Nintendo', 230),
  ('playstation', 'PlayStation', 'Sony', 220),
  ('xbox', 'Xbox', 'Microsoft', 210),
  ('epic-games', 'Epic Games', 'Epic Games', 200),
  ('battle-net', 'Battle.net', 'Blizzard', 190),
  ('riot-games', 'Riot Games', 'Riot Games', 180),
  ('telegram', 'Telegram', 'Telegram', 170),
  ('discord', 'Discord', 'Discord', 160),
  ('spotify', 'Spotify', 'Spotify', 150),
  ('netflix', 'Netflix', 'Netflix', 140),
  ('youtube', 'YouTube', 'Google', 130),
  ('apple', 'Apple', 'Apple', 120),
  ('google-play', 'Google Play', 'Google', 110),
  ('amazon', 'Amazon', 'Amazon', 100)
on conflict (slug) do update set
  name = excluded.name,
  publisher = excluded.publisher,
  popularity = excluded.popularity,
  is_active = true;

with category_map as (
  select slug, id from categories
), section_seed(game_slug, section_slug, section_name, category_slug, sort_order, schema) as (
  values
    ('cs2', 'accounts', 'Accounts', 'accounts', 10, '{"fields":["rank","prime","region","platform"]}'::jsonb),
    ('cs2', 'skins', 'Skins', 'games', 20, '{"fields":["weapon","float","rarity"]}'::jsonb),
    ('cs2', 'prime', 'Prime Status', 'digital-services', 30, '{"fields":["region","delivery"]}'::jsonb),
    ('cs2', 'boosting', 'Boosting', 'boosting', 40, '{"fields":["rank_from","rank_to","mode"]}'::jsonb),
    ('dota-2', 'accounts', 'Accounts', 'accounts', 10, '{"fields":["mmr","behavior"]}'::jsonb),
    ('dota-2', 'items', 'Items', 'games', 20, '{"fields":["rarity","hero","tradable"]}'::jsonb),
    ('dota-2', 'mmr-boosting', 'MMR Boosting', 'boosting', 30, '{"fields":["mmr_from","mmr_to","role"]}'::jsonb),
    ('fortnite', 'accounts', 'Accounts', 'accounts', 10, '{"fields":["skins","platform","email_access"]}'::jsonb),
    ('fortnite', 'v-bucks', 'V-Bucks', 'currency', 20, '{"fields":["amount","region","platform"]}'::jsonb),
    ('fortnite', 'boosting', 'Boosting', 'boosting', 30, '{"fields":["mode","level","deadline"]}'::jsonb),
    ('valorant', 'accounts', 'Accounts', 'accounts', 10, '{"fields":["rank","region","skins"]}'::jsonb),
    ('valorant', 'points', 'Valorant Points', 'currency', 20, '{"fields":["amount","region"]}'::jsonb),
    ('valorant', 'boosting', 'Boosting', 'boosting', 30, '{"fields":["rank_from","rank_to","server"]}'::jsonb),
    ('steam', 'accounts', 'Accounts', 'accounts', 10, '{"fields":["level","games_count","region"]}'::jsonb),
    ('steam', 'keys', 'Keys', 'games', 20, '{"fields":["region","activation","platform"]}'::jsonb),
    ('genshin-impact', 'accounts', 'Accounts', 'accounts', 10, '{"fields":["ar","server","characters"]}'::jsonb),
    ('genshin-impact', 'top-up', 'Top Up', 'currency', 20, '{"fields":["amount","server","uid"]}'::jsonb),
    ('minecraft', 'accounts', 'Accounts', 'accounts', 10, '{"fields":["edition","email_access"]}'::jsonb),
    ('minecraft', 'services', 'Services', 'digital-services', 20, '{"fields":["server","deadline"]}'::jsonb),
    ('world-of-warcraft', 'gold', 'Gold', 'currency', 10, '{"fields":["server","faction","amount"]}'::jsonb),
    ('world-of-warcraft', 'services', 'Services', 'digital-services', 20, '{"fields":["region","server","deadline"]}'::jsonb)
)
insert into game_sections(game_id, category_id, slug, name, sort_order, schema)
select g.id, c.id, s.section_slug, s.section_name, s.sort_order, s.schema
from section_seed s
join games g on g.slug = s.game_slug
left join category_map c on c.slug = s.category_slug
on conflict (game_id, slug) do update set
  name = excluded.name,
  category_id = excluded.category_id,
  sort_order = excluded.sort_order,
  schema = excluded.schema,
  is_active = true;

with category_map as (
  select slug, id from categories
), playstation_section_seed(section_slug, section_name, category_slug, sort_order, schema, active) as (
  values
    ('accounts', 'Аккаунты', 'accounts', 10, '{"fields":["platform","games_count","plus","region","email_access","data_change"]}'::jsonb, true),
    ('keys', 'Ключи', 'digital-services', 20, '{"fields":["platform","region","activation"]}'::jsonb, true),
    ('services', 'Услуги', 'digital-services', 30, '{"fields":["platform","deadline","requirements"]}'::jsonb, true),
    ('top-up', 'Пополнение бумажника', 'currency', 40, '{"fields":["amount","region","platform"]}'::jsonb, true),
    ('plus', 'Plus', 'digital-services', 50, '{"fields":["duration","platform","region"]}'::jsonb, true),
    ('currency', 'Currency', 'currency', 60, '{"fields":[]}'::jsonb, false),
    ('items', 'Items', 'games', 70, '{"fields":[]}'::jsonb, false),
    ('boosting', 'Boosting', 'boosting', 80, '{"fields":[]}'::jsonb, false)
)
insert into game_sections(game_id, category_id, slug, name, sort_order, schema, is_active)
select g.id, c.id, s.section_slug, s.section_name, s.sort_order, s.schema, s.active
from playstation_section_seed s
join games g on g.slug = 'playstation'
left join category_map c on c.slug = s.category_slug
on conflict (game_id, slug) do update set
  name = excluded.name,
  category_id = excluded.category_id,
  sort_order = excluded.sort_order,
  schema = excluded.schema,
  is_active = excluded.is_active;

with defaults(section_slug, section_name, category_slug, sort_order, schema) as (
  values
    ('accounts', 'Accounts', 'accounts', 10, '{"fields":["region","email_access","level"]}'::jsonb),
    ('currency', 'Currency', 'currency', 20, '{"fields":["amount","server","region"]}'::jsonb),
    ('items', 'Items', 'games', 30, '{"fields":["rarity","tradable","platform"]}'::jsonb),
    ('services', 'Services', 'digital-services', 40, '{"fields":["deadline","server","requirements"]}'::jsonb),
    ('boosting', 'Boosting', 'boosting', 50, '{"fields":["from","to","mode"]}'::jsonb),
    ('keys', 'Keys & Codes', 'digital-services', 60, '{"fields":["activation","region","platform"]}'::jsonb)
)
insert into game_sections(game_id, category_id, slug, name, sort_order, schema)
select g.id, c.id, d.section_slug, d.section_name, d.sort_order, d.schema
from games g
cross join defaults d
left join categories c on c.slug = d.category_slug
where g.is_active = true
on conflict (game_id, slug) do nothing;
