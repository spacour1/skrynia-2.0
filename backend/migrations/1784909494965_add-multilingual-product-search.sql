-- Up Migration
--
-- Stage 13: replace the English-only product search path with a maintained,
-- multilingual search representation. The representation is a separate table because
-- PostgreSQL generated columns cannot safely depend on joined catalog rows.
--
-- Rollout:
-- - pg_trgm/unaccent must be available from the target PostgreSQL provider;
-- - indexes are built while the new table is empty, so no index build locks products;
-- - the source rows are copied in bounded 1,000-product statements;
-- - source-table triggers are installed before the backfill, so concurrent writes in a
--   non-single-transaction migration runner cannot be missed.
--
-- The repository release runner currently wraps pending SQL migrations in one
-- transaction. The bounded statements avoid one oversized query, but a very large
-- installation should still run this release during a low-write window and monitor
-- transaction age. No ACCESS EXCLUSIVE lock is held on products during the backfill.
--
-- Rollback:
-- - the Down Migration removes triggers, functions, indexes/table, and the category
--   alias column;
-- - extensions are deliberately retained because another database object may use them;
-- - game aliases backfilled below are catalog data and are deliberately retained rather
--   than destructively guessing which aliases an administrator may have edited.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Games already expose administrator-managed aliases. Categories need the same small
-- catalog-data primitive for cross-language listing-type terms such as аккаунт/акаунт
-- and boost/буст. Search SQL consumes these rows; it contains no query-specific synonym
-- CASE statements.
alter table categories
  add column if not exists aliases text[] not null default '{}';

with required_aliases(game_slug, alias) as (
  values
    ('cs2', 'контр страйк'),
    ('cs2', 'counter strike'),
    ('cs2', 'cs2'),
    ('cs2', 'кс2'),
    ('valorant', 'валик'),
    ('roblox', 'роблокс')
)
update games g
set aliases = (
  select array_agg(distinct candidate.alias order by candidate.alias)
  from unnest(
    coalesce(g.aliases, '{}'::text[])
    || coalesce(
      (select array_agg(required.alias order by required.alias)
       from required_aliases required
       where required.game_slug = g.slug),
      '{}'::text[]
    )
  ) as candidate(alias)
)
where exists (
  select 1
  from required_aliases required
  where required.game_slug = g.slug
);

with required_aliases(category_slug, alias) as (
  values
    ('accounts', 'аккаунт'),
    ('accounts', 'акаунт'),
    ('boosting', 'boost'),
    ('boosting', 'буст')
)
update categories c
set aliases = (
  select array_agg(distinct candidate.alias order by candidate.alias)
  from unnest(
    coalesce(c.aliases, '{}'::text[])
    || coalesce(
      (select array_agg(required.alias order by required.alias)
       from required_aliases required
       where required.category_slug = c.slug),
      '{}'::text[]
    )
  ) as candidate(alias)
)
where exists (
  select 1
  from required_aliases required
  where required.category_slug = c.slug
);

-- Store normalization output instead of repeatedly normalizing every joined field at
-- request time. `simple` FTS keeps Cyrillic/Latin tokens without English stemming.
create or replace function marketplace_search_normalize(input text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $function$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(unaccent('unaccent', coalesce(input, ''))),
        '[_‐‑‒–—―-]+',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$function$;

create table marketplace_product_search_documents (
  product_id uuid primary key references products(id) on delete cascade,
  normalized_title text not null,
  normalized_description text not null,
  normalized_game_name text not null,
  normalized_game_aliases text[] not null default '{}',
  normalized_category_name text not null,
  normalized_category_aliases text[] not null default '{}',
  normalized_section_name text not null,
  normalized_product_type text not null,
  normalized_server text not null,
  normalized_platform text not null,
  document_text text not null,
  document_vector tsvector not null,
  refreshed_at timestamptz not null default now()
);

-- Exact/prefix tiers.
create index marketplace_search_title_prefix_idx
  on marketplace_product_search_documents(normalized_title text_pattern_ops);
create index marketplace_search_game_name_idx
  on marketplace_product_search_documents(normalized_game_name);

-- Exact catalog-alias tiers.
create index marketplace_search_game_aliases_idx
  on marketplace_product_search_documents using gin(normalized_game_aliases);
create index marketplace_search_category_aliases_idx
  on marketplace_product_search_documents using gin(normalized_category_aliases);

-- Full-text candidate retrieval. Search indexes live on new tables, not on products, so
-- their initial build cannot block marketplace writes.
create index marketplace_search_document_fts_idx
  on marketplace_product_search_documents using gin(document_vector);

-- A long concatenated document has low whole-string trigram similarity to a one-word
-- typo. Keep normalized phrases/tokens in a child table so a typo such as `valroant`
-- compares to `valorant`, not to an entire multi-field document. Candidate retrieval is
-- still index-backed through gin_trgm_ops.
create table marketplace_product_search_terms (
  product_id uuid not null
    references marketplace_product_search_documents(product_id) on delete cascade,
  source text not null,
  term text not null,
  primary key (product_id, source, term)
);

create index marketplace_search_term_trgm_idx
  on marketplace_product_search_terms using gin(term gin_trgm_ops);

create or replace function marketplace_refresh_product_search_documents(
  target_product_ids uuid[]
)
returns void
language sql
set search_path = pg_catalog, public
as $function$
  with source as (
    select
      p.id as product_id,
      p.title,
      p.description,
      coalesce(g.name, '') as game_name,
      coalesce(g.aliases, '{}'::text[]) as game_aliases,
      c.name as category_name,
      coalesce(c.aliases, '{}'::text[]) as category_aliases,
      coalesce(gs.name, '') as section_name,
      p.product_type,
      coalesce(p.server, '') as server,
      coalesce(p.platform, '') as platform
    from products p
    join categories c on c.id = p.category_id
    left join games g on g.id = p.game_id
    left join game_sections gs on gs.id = p.section_id
    where p.id = any(target_product_ids)
  ),
  normalized as (
    select
      source.product_id,
      marketplace_search_normalize(source.title) as normalized_title,
      marketplace_search_normalize(source.description) as normalized_description,
      marketplace_search_normalize(source.game_name) as normalized_game_name,
      coalesce(
        (
          select array_agg(alias_value order by alias_value)
          from (
            select distinct marketplace_search_normalize(alias) as alias_value
            from unnest(source.game_aliases) as game_alias(alias)
          ) normalized_aliases
          where alias_value <> ''
        ),
        '{}'::text[]
      ) as normalized_game_aliases,
      marketplace_search_normalize(source.category_name) as normalized_category_name,
      coalesce(
        (
          select array_agg(alias_value order by alias_value)
          from (
            select distinct marketplace_search_normalize(alias) as alias_value
            from unnest(source.category_aliases) as category_alias(alias)
          ) normalized_aliases
          where alias_value <> ''
        ),
        '{}'::text[]
      ) as normalized_category_aliases,
      marketplace_search_normalize(source.section_name) as normalized_section_name,
      marketplace_search_normalize(source.product_type) as normalized_product_type,
      marketplace_search_normalize(source.server) as normalized_server,
      marketplace_search_normalize(source.platform) as normalized_platform
    from source
  ),
  documents as (
    select
      normalized.*,
      marketplace_search_normalize(
        concat_ws(
          ' ',
          normalized.normalized_title,
          normalized.normalized_description,
          normalized.normalized_game_name,
          array_to_string(normalized.normalized_game_aliases, ' '),
          normalized.normalized_category_name,
          array_to_string(normalized.normalized_category_aliases, ' '),
          normalized.normalized_section_name,
          normalized.normalized_product_type,
          normalized.normalized_server,
          normalized.normalized_platform
        )
      ) as document_text,
      setweight(to_tsvector('simple', normalized.normalized_title), 'A')
      || setweight(
        to_tsvector(
          'simple',
          concat_ws(
            ' ',
            normalized.normalized_game_name,
            array_to_string(normalized.normalized_game_aliases, ' ')
          )
        ),
        'A'
      )
      || setweight(to_tsvector('simple', normalized.normalized_description), 'B')
      || setweight(
        to_tsvector(
          'simple',
          concat_ws(
            ' ',
            normalized.normalized_category_name,
            array_to_string(normalized.normalized_category_aliases, ' '),
            normalized.normalized_section_name,
            normalized.normalized_product_type,
            normalized.normalized_server,
            normalized.normalized_platform
          )
        ),
        'C'
      ) as document_vector
    from normalized
  )
  insert into marketplace_product_search_documents(
    product_id,
    normalized_title,
    normalized_description,
    normalized_game_name,
    normalized_game_aliases,
    normalized_category_name,
    normalized_category_aliases,
    normalized_section_name,
    normalized_product_type,
    normalized_server,
    normalized_platform,
    document_text,
    document_vector,
    refreshed_at
  )
  select
    documents.product_id,
    documents.normalized_title,
    documents.normalized_description,
    documents.normalized_game_name,
    documents.normalized_game_aliases,
    documents.normalized_category_name,
    documents.normalized_category_aliases,
    documents.normalized_section_name,
    documents.normalized_product_type,
    documents.normalized_server,
    documents.normalized_platform,
    documents.document_text,
    documents.document_vector,
    now()
  from documents
  on conflict (product_id) do update
  set normalized_title = excluded.normalized_title,
      normalized_description = excluded.normalized_description,
      normalized_game_name = excluded.normalized_game_name,
      normalized_game_aliases = excluded.normalized_game_aliases,
      normalized_category_name = excluded.normalized_category_name,
      normalized_category_aliases = excluded.normalized_category_aliases,
      normalized_section_name = excluded.normalized_section_name,
      normalized_product_type = excluded.normalized_product_type,
      normalized_server = excluded.normalized_server,
      normalized_platform = excluded.normalized_platform,
      document_text = excluded.document_text,
      document_vector = excluded.document_vector,
      refreshed_at = excluded.refreshed_at;

  delete from marketplace_product_search_terms
  where product_id = any(target_product_ids);

  insert into marketplace_product_search_terms(product_id, source, term)
  select distinct phrase.product_id, phrase.source, candidate.term
  from (
    select documents.product_id, field.source, field.value as phrase
    from marketplace_product_search_documents documents
    cross join lateral (
      values
        ('title', documents.normalized_title),
        ('game_name', documents.normalized_game_name),
        ('category_name', documents.normalized_category_name),
        ('section', documents.normalized_section_name),
        ('product_type', documents.normalized_product_type),
        ('server', documents.normalized_server),
        ('platform', documents.normalized_platform)
    ) as field(source, value)
    where documents.product_id = any(target_product_ids)

    union all

    select documents.product_id, 'game_alias', alias
    from marketplace_product_search_documents documents
    cross join lateral unnest(documents.normalized_game_aliases) as aliases(alias)
    where documents.product_id = any(target_product_ids)

    union all

    select documents.product_id, 'category_alias', alias
    from marketplace_product_search_documents documents
    cross join lateral unnest(documents.normalized_category_aliases) as aliases(alias)
    where documents.product_id = any(target_product_ids)

    union all

    select documents.product_id, 'description', token
    from marketplace_product_search_documents documents
    cross join lateral regexp_split_to_table(
      documents.normalized_description,
      '[[:space:]]+'
    ) as description_tokens(token)
    where documents.product_id = any(target_product_ids)
  ) phrase
  cross join lateral (
    select phrase.phrase as term
    union
    select token
    from regexp_split_to_table(phrase.phrase, '[[:space:]]+') as tokens(token)
    where char_length(token) >= 2
  ) candidate
  where candidate.term <> ''
  on conflict do nothing
$function$;

create or replace function marketplace_product_search_product_changed()
returns trigger
language plpgsql
set search_path = pg_catalog, public
set jit = off
as $function$
begin
  perform marketplace_refresh_product_search_documents(array[new.id]);
  return new;
end
$function$;

create or replace function marketplace_product_search_game_changed()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  product_ids uuid[];
begin
  select array_agg(p.id order by p.id)
  into product_ids
  from products p
  where p.game_id = new.id;

  if cardinality(product_ids) > 0 then
    perform marketplace_refresh_product_search_documents(product_ids);
  end if;
  return new;
end
$function$;

create or replace function marketplace_product_search_category_changed()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  product_ids uuid[];
begin
  select array_agg(p.id order by p.id)
  into product_ids
  from products p
  where p.category_id = new.id;

  if cardinality(product_ids) > 0 then
    perform marketplace_refresh_product_search_documents(product_ids);
  end if;
  return new;
end
$function$;

create or replace function marketplace_product_search_section_changed()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  product_ids uuid[];
begin
  select array_agg(p.id order by p.id)
  into product_ids
  from products p
  where p.section_id = new.id;

  if cardinality(product_ids) > 0 then
    perform marketplace_refresh_product_search_documents(product_ids);
  end if;
  return new;
end
$function$;

create trigger trg_marketplace_product_search_product
after insert or update of
  category_id,
  game_id,
  section_id,
  title,
  description,
  product_type,
  server,
  platform
on products
for each row
execute function marketplace_product_search_product_changed();

create trigger trg_marketplace_product_search_game
after update of name, aliases
on games
for each row
execute function marketplace_product_search_game_changed();

create trigger trg_marketplace_product_search_category
after update of name, aliases
on categories
for each row
execute function marketplace_product_search_category_changed();

create trigger trg_marketplace_product_search_section
after update of name
on game_sections
for each row
execute function marketplace_product_search_section_changed();

-- Bounded, deterministic backfill. The search table and all indexes are invisible until
-- transaction commit, while the already-installed product trigger covers concurrent
-- inserts/updates for migration runners that do not use a single transaction.
do $backfill$
declare
  last_product_id uuid;
  next_product_id uuid;
  batch_ids uuid[];
begin
  loop
    select array_agg(batch.id order by batch.id)
    into batch_ids
    from (
      select p.id
      from products p
      where last_product_id is null or p.id > last_product_id
      order by p.id
      limit 1000
    ) batch;

    exit when batch_ids is null;
    next_product_id := batch_ids[cardinality(batch_ids)];
    perform marketplace_refresh_product_search_documents(batch_ids);
    last_product_id := next_product_id;
  end loop;
end
$backfill$;

-- Down Migration

drop trigger if exists trg_marketplace_product_search_section on game_sections;
drop trigger if exists trg_marketplace_product_search_category on categories;
drop trigger if exists trg_marketplace_product_search_game on games;
drop trigger if exists trg_marketplace_product_search_product on products;

drop function if exists marketplace_product_search_section_changed();
drop function if exists marketplace_product_search_category_changed();
drop function if exists marketplace_product_search_game_changed();
drop function if exists marketplace_product_search_product_changed();
drop function if exists marketplace_refresh_product_search_documents(uuid[]);

drop table if exists marketplace_product_search_terms;
drop table if exists marketplace_product_search_documents;
drop function if exists marketplace_search_normalize(text);

alter table categories drop column if exists aliases;
