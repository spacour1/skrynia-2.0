-- Up Migration

alter table categories add column if not exists risk_level text;

update categories set risk_level = case slug
  when 'accounts' then 'high'
  when 'boosting' then 'high'
  when 'currency' then 'medium'
  when 'games' then 'medium'
  when 'digital-services' then 'low'
  else 'low'
end
where risk_level is null;

alter table categories alter column risk_level set not null;
alter table categories alter column risk_level set default 'low';
alter table categories add constraint categories_risk_level_check
  check (risk_level in ('low', 'medium', 'high'));

-- Down Migration

alter table categories drop constraint if exists categories_risk_level_check;
alter table categories drop column if exists risk_level;
