-- Up Migration
--
-- Rollback: see Down Migration - drops the columns and indexes added here.
--
-- Display/discovery fields for the catalog builder ("Catalog Item" = games row):
-- - description/short_description: admin-editable copy for the game page and cards
--   (the admin API already accepted `description` but games had no column for it);
-- - logo_image/background_image: extra art slots next to existing icon_url/banner;
-- - aliases: alternative names / search keywords ("роблокс", "robux") matched by
--   /marketplace/suggest so Cyrillic/Latin variants find the game;
-- - show_on_homepage + homepage_order: homepage visibility toggle and manual order;
-- - is_popular / is_recommended: curated flags for homepage blocks.

alter table games add column if not exists description text;
alter table games add column if not exists short_description text;
alter table games add column if not exists logo_image text;
alter table games add column if not exists background_image text;
alter table games add column if not exists aliases text[] not null default '{}';
alter table games add column if not exists show_on_homepage boolean not null default true;
alter table games add column if not exists is_popular boolean not null default false;
alter table games add column if not exists is_recommended boolean not null default false;
alter table games add column if not exists homepage_order integer not null default 0;

create index if not exists idx_games_aliases on games using gin (aliases);
create index if not exists idx_games_homepage on games(show_on_homepage, homepage_order) where status = 'active';

-- Down Migration

drop index if exists idx_games_homepage;
drop index if exists idx_games_aliases;
alter table games drop column if exists homepage_order;
alter table games drop column if exists is_recommended;
alter table games drop column if exists is_popular;
alter table games drop column if exists show_on_homepage;
alter table games drop column if exists aliases;
alter table games drop column if exists background_image;
alter table games drop column if exists logo_image;
alter table games drop column if exists short_description;
alter table games drop column if exists description;
