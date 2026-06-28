-- Up Migration

alter table game_sections add column if not exists product_type text;

-- Backfill matches exactly what the old frontend regex classifier
-- (productTypeForSection) used to infer from each section's slug + name, so existing
-- behavior for already-seeded sections is unchanged.
update game_sections set product_type = case
  when slug in ('accounts') then 'account'
  when slug in ('top-up') then 'topup'
  when slug in ('keys') then 'key'
  when slug in ('gold', 'currency', 'points', 'v-bucks') then 'currency'
  when slug in ('items', 'skins') then 'item'
  when slug in ('boosting', 'mmr-boosting') then 'boosting'
  else 'service'
end
where product_type is null;

alter table game_sections alter column product_type set not null;
alter table game_sections alter column product_type set default 'service';
alter table game_sections add constraint game_sections_product_type_check
  check (product_type in ('account', 'key', 'topup', 'boosting', 'service', 'item', 'currency'));

-- Down Migration

alter table game_sections drop constraint if exists game_sections_product_type_check;
alter table game_sections drop column if exists product_type;
