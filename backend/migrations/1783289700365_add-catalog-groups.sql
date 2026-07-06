-- Up Migration
--
-- Rollback: drop catalog_groups and games.group_id (see Down Migration).
--
-- Adds the top-level "catalog group" concept (Игры / Сервисы / Дропшиппинг / Программы / ...).
-- `categories` is deliberately NOT reused for this: today `categories` is a cross-game
-- listing-type classification (currency/accounts/boosting...) tied to risk_level, not a
-- vertical grouping, and it's referenced by both products and game_sections for that
-- purpose. Repurposing it would conflate two different concepts and risk breaking
-- risk_level-based logic. `games` becomes the "Catalog Item" table (no rename, no data
-- migration to a parallel table) via the new group_id foreign key below.

create table catalog_groups (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  icon text,
  status text not null default 'draft' check (status in ('draft', 'active', 'hidden', 'archived', 'deleted')),
  sort_order integer not null default 0,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_catalog_groups_status_sort on catalog_groups(status, sort_order);

-- Bootstrap group so every existing game keeps its place without any admin action. Uses a
-- fixed id (not gen_random_uuid()) so it can also be used as games.group_id's column
-- DEFAULT below - a column default must be a constant, not a subquery - which means any
-- INSERT into games that doesn't mention group_id at all (e.g. the existing dev seed
-- script) keeps working unmodified instead of hitting a not-null violation.
insert into catalog_groups (id, slug, name, status, sort_order)
values ('00000000-0000-0000-0000-000000000001', 'games', 'Игры', 'active', 0);

alter table games add column if not exists group_id uuid references catalog_groups(id)
  default '00000000-0000-0000-0000-000000000001';

update games set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;

alter table games alter column group_id set not null;

create index idx_games_group_id on games(group_id);

-- Down Migration

drop index if exists idx_games_group_id;
alter table games alter column group_id drop not null;
alter table games drop column if exists group_id;
drop index if exists idx_catalog_groups_status_sort;
drop table if exists catalog_groups;
