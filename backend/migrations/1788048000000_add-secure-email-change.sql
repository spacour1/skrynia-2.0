-- Up Migration
--
-- Email replacement is a pending, separately confirmed security operation. The active
-- users.email value is never changed by the request path. Only SHA-256 token digests are
-- stored; raw confirmation tokens exist only in the delivery link.
--
-- Rollback: drop idx_user_email_change_pending_email_unique, then drop
-- user_email_change_requests. Pending requests are disposable and rolling back this
-- migration does not alter any active users.email value.

create table user_email_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  pending_email text not null,
  token_hash text not null,
  requested_session_version integer not null check (requested_session_version > 0),
  expires_at timestamptz not null,
  delivery_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_email_change_requests_user_unique unique (user_id),
  constraint user_email_change_requests_token_unique unique (token_hash),
  constraint user_email_change_requests_pending_email_normalized_check
    check (pending_email = lower(btrim(pending_email))),
  constraint user_email_change_requests_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$')
);

create unique index idx_user_email_change_pending_email_unique
  on user_email_change_requests(lower(pending_email));

create index idx_user_email_change_expires_at
  on user_email_change_requests(expires_at);

-- Down Migration

drop index if exists idx_user_email_change_expires_at;
drop index if exists idx_user_email_change_pending_email_unique;
drop table if exists user_email_change_requests;
