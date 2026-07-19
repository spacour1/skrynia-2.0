-- Up Migration
--
-- Products with a section must pin metadata to a schema version from that same section.
-- Backfill legacy rows from the section's current schema before enforcing the invariant.

update products p
   set schema_version = gs.current_schema_version
  from game_sections gs
  join catalog_section_schemas css
    on css.section_id = gs.id
   and css.version = gs.current_schema_version
 where p.section_id = gs.id
   and p.schema_version is null;

update products
   set schema_version = null
 where section_id is null
   and schema_version is not null;

alter table products
  add constraint products_section_schema_nullity_check
  check (
    (section_id is null and schema_version is null)
    or
    (section_id is not null and schema_version is not null)
  ) not valid;

alter table products
  add constraint products_section_schema_fk
  foreign key (section_id, schema_version)
  references catalog_section_schemas(section_id, version)
  not valid;

alter table products validate constraint products_section_schema_nullity_check;
alter table products validate constraint products_section_schema_fk;

-- Down Migration

alter table products drop constraint if exists products_section_schema_fk;
alter table products drop constraint if exists products_section_schema_nullity_check;
