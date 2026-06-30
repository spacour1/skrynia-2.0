-- Telegram/email notifications were promised in the UI but never actually delivered - the
-- background job just logged a placeholder. These tables back real delivery: a per-user
-- channel preference, and a Telegram chat_id link established via a bot deep-link + webhook
-- (separate from users.telegram_id, which is only ever set by the Telegram *login* widget and
-- may be empty for accounts that registered with email/password).
create table if not exists notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  email_enabled boolean not null default true,
  telegram_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  chat_id text,
  connect_token text unique,
  connected_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_accounts_connect_token on telegram_accounts(connect_token) where connect_token is not null;
