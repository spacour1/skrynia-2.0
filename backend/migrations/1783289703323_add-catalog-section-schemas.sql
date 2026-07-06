-- Up Migration
--
-- Rollback: see Down Migration - drops current_schema_version and catalog_section_schemas.
--
-- Versioned schema for game_sections ("Catalog Section"). Existing lots keep displaying
-- under whatever schema_version they were created with (see the products migration);
-- new lots always validate against the section's current active version.
--
-- current_schema_version is nullable: null means "no schema yet" (a freshly admin-created
-- draft section), which is exactly the state that must block publish at the app layer.

create table catalog_section_schemas (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references game_sections(id) on delete cascade,
  version integer not null,
  schema jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (section_id, version)
);

create index idx_catalog_section_schemas_section on catalog_section_schemas(section_id, status);

alter table game_sections add column if not exists current_schema_version integer;

-- Legacy adapter: the old `game_sections.schema` column is just `{"fields": ["rank", ...]}`
-- (a flat list of field keys, no types/validation/options). Convert each existing section's
-- fields into a real v1 schema (type "text", non-required, non-filterable) and publish it as
-- "active" so every existing section can already be published/used without an admin having
-- to manually rebuild it through the new builder. The legacy `game_sections.schema` column
-- itself is left untouched for backward compatibility with any code still reading it.
insert into catalog_section_schemas (section_id, version, schema, status, published_at)
select
  gs.id,
  1,
  jsonb_build_object(
    'fields',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', field_key,
            'label', field_key,
            'type', 'text',
            'required', false,
            'filterable', false,
            'showInCard', true,
            'sortOrder', ord
          ) order by ord
        )
        from jsonb_array_elements_text(coalesce(gs.schema -> 'fields', '[]'::jsonb)) with ordinality as t(field_key, ord)
      ),
      '[]'::jsonb
    )
  ),
  'active',
  now()
from game_sections gs
where not exists (select 1 from catalog_section_schemas s where s.section_id = gs.id);

update game_sections gs
set current_schema_version = 1
from catalog_section_schemas s
where s.section_id = gs.id and s.version = 1 and gs.current_schema_version is null;

-- Down Migration

alter table game_sections drop column if exists current_schema_version;
drop index if exists idx_catalog_section_schemas_section;
drop table if exists catalog_section_schemas;
