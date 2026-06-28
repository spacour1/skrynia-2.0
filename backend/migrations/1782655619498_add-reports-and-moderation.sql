-- Up Migration

create table if not exists user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id),
  reported_user_id uuid not null references users(id),
  reason text not null check (reason in ('fraud','abuse','spam','fake_lot','payment_issue','off_platform_deal','illegal_content','other')),
  description text,
  status text not null default 'pending' check (status in ('pending','in_review','resolved','rejected')),
  priority text not null default 'normal' check (priority in ('normal','high')),
  moderator_id uuid references users(id),
  moderator_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_id, reported_user_id, reason),
  check (reporter_id != reported_user_id)
);

create table if not exists message_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id),
  message_id uuid not null references messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  reported_user_id uuid not null references users(id),
  reason text not null check (reason in ('insult','spam','scam','off_platform_deal','personal_data','prohibited_content','other')),
  description text,
  status text not null default 'pending' check (status in ('pending','in_review','resolved','rejected')),
  priority text not null default 'normal' check (priority in ('normal','high')),
  moderator_id uuid references users(id),
  moderator_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_id, message_id, reason)
);

create table if not exists moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references users(id),
  target_user_id uuid references users(id),
  target_message_id uuid references messages(id),
  target_conversation_id uuid references conversations(id),
  action_type text not null check (action_type in ('hide_message','restore_message','warn_user','close_report','reject_report','lock_conversation','unlock_conversation')),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_reports_status on user_reports(status, created_at);
create index if not exists idx_message_reports_status on message_reports(status, created_at);
create index if not exists idx_moderation_actions_target_message on moderation_actions(target_message_id);

-- Down Migration

drop table if exists moderation_actions;
drop table if exists message_reports;
drop table if exists user_reports;
