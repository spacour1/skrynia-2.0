-- Up Migration
--
-- Durable request results for order creation and a client-generated identity for user
-- messages. Existing messages remain valid with a null client_message_id.

create table idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  scope text not null check (char_length(btrim(scope)) between 1 and 100),
  key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'processing'
    check (status in ('processing', 'completed')),
  response_status integer check (
    response_status is null or response_status between 100 and 599
  ),
  response_body jsonb,
  resource_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint idempotency_keys_user_scope_key_unique
    unique (user_id, scope, key),
  constraint idempotency_keys_response_bundle_check check (
    (
      status = 'processing'
      and response_status is null
      and response_body is null
      and resource_id is null
    )
    or
    (
      status = 'completed'
      and response_status is not null
      and response_body is not null
    )
  ),
  constraint idempotency_keys_expiry_check check (expires_at > created_at)
);

create index idx_idempotency_keys_expires_at
  on idempotency_keys(expires_at);

alter table messages add column client_message_id uuid;

alter table messages add constraint messages_client_message_sender_check
  check (
    client_message_id is null
    or (kind = 'user' and sender_id is not null)
  );

create unique index uq_messages_sender_client_message
  on messages(sender_id, client_message_id)
  where client_message_id is not null;

-- Down Migration

drop index if exists uq_messages_sender_client_message;
alter table messages drop constraint if exists messages_client_message_sender_check;
alter table messages drop column if exists client_message_id;

drop table if exists idempotency_keys;
