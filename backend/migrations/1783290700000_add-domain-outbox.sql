-- Up Migration
--
-- Durable handoff between committed business state and asynchronous side effects.
-- Producers insert into domain_outbox in the same PostgreSQL transaction as the
-- aggregate mutation. Workers claim rows with FOR UPDATE SKIP LOCKED.

create table domain_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text unique not null,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint domain_outbox_lock_bundle_check check (
    (status = 'processing' and locked_at is not null and locked_by is not null)
    or
    (status != 'processing' and locked_at is null and locked_by is null)
  ),
  constraint domain_outbox_processed_bundle_check check (
    (status = 'processed' and processed_at is not null)
    or
    (status != 'processed' and processed_at is null)
  )
);

create index idx_domain_outbox_status_available
  on domain_outbox(status, available_at);

create index idx_domain_outbox_aggregate_id
  on domain_outbox(aggregate_id);

create index idx_domain_outbox_created_at
  on domain_outbox(created_at);

alter table notifications add column event_key text;

create unique index uq_notifications_event_key
  on notifications(event_key)
  where event_key is not null;

-- Down Migration

drop index if exists uq_notifications_event_key;
alter table notifications drop column if exists event_key;

drop table if exists domain_outbox;
