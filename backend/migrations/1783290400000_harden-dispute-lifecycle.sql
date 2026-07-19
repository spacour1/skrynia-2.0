-- Up Migration
--
-- Forward-only dispute lifecycle hardening. Original evidence and message content become
-- immutable, while resolution claims gain enough durable state to resume after a crash.

alter table disputes
  add column resolution_decision text check (resolution_decision in ('refund', 'release')),
  add column resolution_operation_id uuid,
  add column resolving_started_at timestamptz,
  add column resolution_attempts integer not null default 0 check (resolution_attempts >= 0),
  add column last_resolution_error text;

-- Preserve completed decisions and recover any claim left by the previous state machine.
update disputes
set resolution_decision = resolution,
    resolution_operation_id = gen_random_uuid(),
    resolving_started_at = coalesce(resolved_at, updated_at, now()),
    resolution_attempts = greatest(resolution_attempts, 1)
where status = 'resolved';

update disputes d
set resolution_decision = case o.status
      when 'refunded' then 'refund'
      when 'completed' then 'release'
    end,
    resolution_operation_id = gen_random_uuid(),
    resolving_started_at = coalesce(d.updated_at, now()),
    resolution_attempts = greatest(d.resolution_attempts, 1)
from orders o
where d.order_id = o.id
  and d.status = 'resolving'
  and o.status in ('refunded', 'completed');

-- The old implementation did not persist a decision before calling escrow. A non-terminal
-- legacy claim therefore cannot be resumed safely and is reset to an unclaimed open state.
update disputes d
set status = 'open',
    admin_id = null,
    admin_note = null,
    last_resolution_error = 'Legacy resolving claim reset during lifecycle migration',
    updated_at = now()
from orders o
where d.order_id = o.id
  and d.status = 'resolving'
  and o.status not in ('refunded', 'completed');

alter table disputes drop constraint disputes_status_check;
alter table disputes add constraint disputes_status_check
  check (status in ('open', 'resolving', 'resolved', 'resolution_failed'));

alter table disputes add constraint disputes_resolution_state_check check (
  status = 'open'
  or (
    status in ('resolving', 'resolution_failed')
    and resolution_decision is not null
    and resolution_operation_id is not null
    and resolving_started_at is not null
    and resolution_attempts > 0
  )
  or (
    status = 'resolved'
    and resolution_decision is not null
    and resolution_operation_id is not null
    and resolving_started_at is not null
    and resolution_attempts > 0
    and resolution = resolution_decision
    and resolved_at is not null
  )
);

create unique index uq_disputes_resolution_operation
  on disputes(resolution_operation_id)
  where resolution_operation_id is not null;

create index idx_disputes_stale_resolution
  on disputes(resolving_started_at)
  where status = 'resolving';

create or replace function protect_dispute_original_evidence()
returns trigger as $$
begin
  if new.opened_by is distinct from old.opened_by
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception 'dispute original evidence is immutable';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger disputes_original_evidence_immutable
before update on disputes
for each row execute function protect_dispute_original_evidence();

create table dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  author_id uuid not null references users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  attachment_url text check (attachment_url is null or char_length(attachment_url) <= 2048),
  hidden_at timestamptz,
  hidden_by uuid references users(id) on delete restrict,
  moderation_reason text,
  created_at timestamptz not null default now(),
  constraint dispute_messages_moderation_bundle_check check (
    (
      hidden_at is null
      and hidden_by is null
      and moderation_reason is null
    )
    or
    (
      hidden_at is not null
      and hidden_by is not null
      and char_length(btrim(moderation_reason)) between 3 and 500
    )
  )
);

create index idx_dispute_messages_dispute_created
  on dispute_messages(dispute_id, created_at, id);

create index idx_dispute_messages_author_created
  on dispute_messages(author_id, created_at desc);

create or replace function protect_dispute_message_content()
returns trigger as $$
begin
  if new.id is distinct from old.id
     or new.dispute_id is distinct from old.dispute_id
     or new.author_id is distinct from old.author_id
     or new.body is distinct from old.body
     or new.attachment_url is distinct from old.attachment_url
     or new.created_at is distinct from old.created_at then
    raise exception 'dispute message content is immutable';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger dispute_messages_content_immutable
before update on dispute_messages
for each row execute function protect_dispute_message_content();

create or replace function prevent_dispute_message_delete()
returns trigger as $$
begin
  raise exception 'dispute messages are append-only';
end;
$$ language plpgsql;

create trigger dispute_messages_delete_immutable
before delete on dispute_messages
for each row execute function prevent_dispute_message_delete();

-- Down Migration

-- no-op: evidence immutability and durable resolution state are irreversible by design.
