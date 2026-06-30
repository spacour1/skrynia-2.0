-- users.two_factor_enabled already existed but was a bare client-writable flag with no
-- actual OTP check anywhere in the login flow - "fake 2FA". These tables back a real TOTP
-- implementation; two_factor_enabled now only flips to true once a code has actually been
-- confirmed (see twofa.service.ts), and the login flow checks it before issuing a session.
create table if not exists user_2fa_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  secret text not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists user_2fa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_2fa_backup_codes_user on user_2fa_backup_codes(user_id) where used_at is null;
