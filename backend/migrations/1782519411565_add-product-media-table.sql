-- Up Migration

create table if not exists product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url text not null,
  type text not null default 'image' check (type in ('image', 'video')),
  sort_order integer not null default 0,
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists idx_product_media_product on product_media(product_id, sort_order);
create index if not exists idx_product_media_status on product_media(status);

-- Backfill: lift any existing metadata.mediaUrls arrays into proper rows, preserving order.
insert into product_media (product_id, url, sort_order)
select p.id, media.url, media.rn - 1
from products p
cross join lateral (
  select value as url, row_number() over () as rn
  from jsonb_array_elements_text(p.metadata -> 'mediaUrls')
) media
where jsonb_typeof(p.metadata -> 'mediaUrls') = 'array';

-- Down Migration

drop table if exists product_media;
