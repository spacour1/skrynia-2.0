-- Up Migration

alter table users add column if not exists phone text;
alter table users add column if not exists phone_verified_at timestamptz;
create unique index if not exists idx_users_phone_unique on users(phone) where phone is not null;

-- Down Migration

drop index if exists idx_users_phone_unique;
alter table users drop column if exists phone_verified_at;
alter table users drop column if exists phone;
