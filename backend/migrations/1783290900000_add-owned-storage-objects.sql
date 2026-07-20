-- Up Migration

create table storage_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  object_key text unique not null,
  storage_driver text not null check (storage_driver in ('local', 's3')),
  purpose text not null check (
    purpose in ('avatar', 'product_media', 'chat_attachment', 'catalog_asset')
  ),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  status text not null default 'temporary' check (
    status in ('temporary', 'attached', 'deleted', 'quarantined')
  ),
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  deleted_at timestamptz,
  constraint storage_objects_key_check check (
    object_key <> ''
    and object_key !~ '(^|/)\.\.(/|$)'
    and left(object_key, 1) <> '/'
  ),
  constraint storage_objects_status_timestamps_check check (
    (status = 'temporary' and attached_at is null and deleted_at is null)
    or (status = 'attached' and attached_at is not null and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
    or (status = 'quarantined' and deleted_at is null)
  )
);

create index idx_storage_objects_owner_status
  on storage_objects(owner_id, status, created_at);

create index idx_storage_objects_temporary_cleanup
  on storage_objects(created_at)
  where status = 'temporary';

alter table product_media
  add column storage_object_id uuid references storage_objects(id) on delete set null;

create unique index uq_product_media_storage_object
  on product_media(storage_object_id)
  where storage_object_id is not null;

alter table messages
  add column attachment_storage_object_id uuid references storage_objects(id) on delete set null;

create unique index uq_messages_attachment_storage_object
  on messages(attachment_storage_object_id)
  where attachment_storage_object_id is not null;

alter table dispute_messages
  add column attachment_storage_object_id uuid references storage_objects(id) on delete set null;

create unique index uq_dispute_messages_attachment_storage_object
  on dispute_messages(attachment_storage_object_id)
  where attachment_storage_object_id is not null;

alter table users
  add column avatar_storage_object_id uuid references storage_objects(id) on delete set null,
  add column seller_banner_storage_object_id uuid references storage_objects(id) on delete set null;

create unique index uq_users_avatar_storage_object
  on users(avatar_storage_object_id)
  where avatar_storage_object_id is not null;

create unique index uq_users_seller_banner_storage_object
  on users(seller_banner_storage_object_id)
  where seller_banner_storage_object_id is not null;

-- Down Migration

drop index if exists uq_users_seller_banner_storage_object;
drop index if exists uq_users_avatar_storage_object;
alter table users
  drop column if exists seller_banner_storage_object_id,
  drop column if exists avatar_storage_object_id;

drop index if exists uq_dispute_messages_attachment_storage_object;
alter table dispute_messages drop column if exists attachment_storage_object_id;

drop index if exists uq_messages_attachment_storage_object;
alter table messages drop column if exists attachment_storage_object_id;

drop index if exists uq_product_media_storage_object;
alter table product_media drop column if exists storage_object_id;

drop table if exists storage_objects;
