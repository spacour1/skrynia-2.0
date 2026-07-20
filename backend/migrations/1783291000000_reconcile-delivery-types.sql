-- Removes 'service' from the legal delivery types of game_sections.
-- 'service' is a ProductType; products.delivery_type has always been constrained to
-- ('manual','instant') (initial schema), so a section that only allowed 'service'
-- delivery could never produce a valid lot - creation failed at the products CHECK
-- with a 500 instead of a validation error.
--
-- Rollback: drop game_sections_allowed_delivery_types_check and restore
--   check (allowed_delivery_types <@ array['instant','manual','service']::text[])
-- (removed 'service' entries are not recoverable, they were never usable).

update game_sections
set allowed_delivery_types = (
  select coalesce(array_agg(t order by t), '{}'::text[])
  from unnest(allowed_delivery_types) as t
  where t <> 'service'
)
where 'service' = any(allowed_delivery_types);

-- A section left with no delivery types can never accept a lot; restore the
-- historical default instead of leaving it silently dead.
update game_sections
set allowed_delivery_types = '{manual,instant}'::text[]
where cardinality(allowed_delivery_types) = 0;

alter table game_sections drop constraint if exists game_sections_allowed_delivery_types_check;
alter table game_sections add constraint game_sections_allowed_delivery_types_check
  check (
    allowed_delivery_types <@ array['instant', 'manual']::text[]
    and cardinality(allowed_delivery_types) >= 1
  );
