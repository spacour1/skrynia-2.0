-- Up Migration
--
-- Rollback: see Down Migration - drops the column and index.
--
-- Admin-controlled catalog type for a game ("Catalog Item"): drives which tab of the
-- header catalog panel and which homepage row the game appears in, replacing the
-- frontend's hardcoded slug lists / name-pattern classification.
--   game     - PC/console title (default)
--   mobile   - mobile title
--   platform - store/launcher/platform (Steam, Xbox, ...)
--   service  - subscription/service (Discord, Spotify, ...)
--
-- The backfill mirrors the classification the frontend used until now (slug sets and
-- the mobile name pattern), so existing tabs keep the same content after the switch.

alter table games add column if not exists catalog_type text not null default 'game'
  check (catalog_type in ('game', 'mobile', 'platform', 'service'));

update games set catalog_type = 'platform'
 where slug in ('steam', 'epic-games', 'playstation', 'xbox', 'battle-net', 'nintendo', 'riot-games', 'ubisoft-connect', 'ea-app', 'rockstar', 'gog');

update games set catalog_type = 'service'
 where slug in ('telegram', 'discord', 'spotify', 'netflix', 'youtube', 'apple', 'google-play', 'amazon');

update games set catalog_type = 'mobile'
 where catalog_type = 'game'
   and (slug || ' ' || name) ~* 'pubg|free|genshin|brawl|clash|mobile|standoff|roblox|call-of-duty-mobile|arena|wild-rift';

create index if not exists idx_games_catalog_type on games(catalog_type) where status = 'active';

-- Down Migration

drop index if exists idx_games_catalog_type;
alter table games drop column if exists catalog_type;
