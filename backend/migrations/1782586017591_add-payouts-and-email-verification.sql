-- Up Migration

alter table users add column if not exists email_verified_at timestamptz;

create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  transaction_id uuid not null references transactions(id),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'UAH',
  provider text not null default 'manual' check (provider in ('manual', 'liqpay')),
  destination jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'rejected')),
  reference text,
  admin_note text,
  processed_by uuid references users(id),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payouts_user on payouts(user_id, created_at desc);
create index if not exists idx_payouts_status on payouts(status, created_at);

-- Down Migration

drop table if exists payouts;
alter table users drop column if exists email_verified_at;
