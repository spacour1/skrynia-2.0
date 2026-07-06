-- Up Migration
--
-- Rollback: see Down Migration - drops products.schema_version.
--
-- Records which section schema version a lot's metadata was validated against at
-- creation time, so an admin editing a section's schema later never breaks how an
-- already-created lot displays or re-validates. Nullable: legacy lots created before
-- schema versioning (or lots under a category-only section with no schema at all)
-- simply have no version.

alter table products add column if not exists schema_version integer;

update products p
set schema_version = gs.current_schema_version
from game_sections gs
where p.section_id = gs.id
  and p.schema_version is null
  and gs.current_schema_version is not null;

-- Down Migration

alter table products drop column if exists schema_version;
