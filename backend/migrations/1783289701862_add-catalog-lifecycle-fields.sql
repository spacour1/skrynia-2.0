-- Up Migration
--
-- Rollback: see Down Migration - drops the triggers/function/columns added here.
--
-- Adds admin-catalog lifecycle fields to games ("Catalog Item") and game_sections
-- ("Catalog Section"): status, seo/sort metadata, soft delete.
--
-- `is_active` stays as-is and keeps driving every existing public query untouched (no
-- existing call site is rewritten here - that would be the "global refactor" the project
-- rules forbid). `status` is the new richer lifecycle field the catalog builder writes
-- (draft/active/hidden/archived/deleted). A one-way trigger mirrors status -> is_active
-- (is_active := status = 'active') so legacy reads stay correct automatically. There is
-- deliberately no trigger in the other direction (is_active -> status): today nothing
-- writes is_active directly (the whole catalog surface is currently read-only, per the
-- Phase 0 audit), and a bidirectional sync would risk a stray is_active write silently
-- resurrecting an archived/deleted row back to "active" or demoting it to the wrong
-- non-active state. status is only ever changed by the catalog builder's own code.

alter table games add column if not exists status text;
update games set status = case when is_active then 'active' else 'hidden' end where status is null;
alter table games alter column status set not null;
alter table games alter column status set default 'draft';
alter table games add constraint games_status_check
  check (status in ('draft', 'active', 'hidden', 'archived', 'deleted'));

alter table games add column if not exists banner text;
alter table games add column if not exists sort_order integer not null default 0;
alter table games add column if not exists seo_title text;
alter table games add column if not exists seo_description text;
alter table games add column if not exists deleted_at timestamptz;

alter table game_sections add column if not exists status text;
update game_sections set status = case when is_active then 'active' else 'hidden' end where status is null;
alter table game_sections alter column status set not null;
alter table game_sections alter column status set default 'draft';
alter table game_sections add constraint game_sections_status_check
  check (status in ('draft', 'active', 'hidden', 'archived', 'deleted'));

alter table game_sections add column if not exists requires_moderation boolean not null default false;
alter table game_sections add column if not exists allowed_delivery_types text[] not null default '{manual,instant}';
alter table game_sections add constraint game_sections_allowed_delivery_types_check
  check (allowed_delivery_types <@ array['instant', 'manual', 'service']::text[]);
alter table game_sections add column if not exists seo_title text;
alter table game_sections add column if not exists seo_description text;
alter table game_sections add column if not exists deleted_at timestamptz;

create index idx_games_status_sort on games(status, sort_order);
create index idx_game_sections_status_sort on game_sections(status, sort_order);

create or replace function sync_catalog_status_to_is_active() returns trigger as $$
begin
  new.is_active := (new.status = 'active');
  return new;
end;
$$ language plpgsql;

create trigger games_sync_is_active
  before insert or update of status on games
  for each row execute function sync_catalog_status_to_is_active();

create trigger game_sections_sync_is_active
  before insert or update of status on game_sections
  for each row execute function sync_catalog_status_to_is_active();

-- Down Migration

drop trigger if exists game_sections_sync_is_active on game_sections;
drop trigger if exists games_sync_is_active on games;
drop function if exists sync_catalog_status_to_is_active();

drop index if exists idx_game_sections_status_sort;
drop index if exists idx_games_status_sort;

alter table game_sections drop column if exists deleted_at;
alter table game_sections drop column if exists seo_description;
alter table game_sections drop column if exists seo_title;
alter table game_sections drop constraint if exists game_sections_allowed_delivery_types_check;
alter table game_sections drop column if exists allowed_delivery_types;
alter table game_sections drop column if exists requires_moderation;
alter table game_sections drop constraint if exists game_sections_status_check;
alter table game_sections drop column if exists status;

alter table games drop column if exists deleted_at;
alter table games drop column if exists seo_description;
alter table games drop column if exists seo_title;
alter table games drop column if exists sort_order;
alter table games drop column if exists banner;
alter table games drop constraint if exists games_status_check;
alter table games drop column if exists status;
