-- Up Migration
--
-- Forward-only 2FA storage upgrade. Existing plaintext secrets are retained temporarily
-- in legacy_secret so the new application can encrypt them with the deployment-provided
-- AES-256-GCM key during startup. The application clears legacy_secret immediately after
-- each successful backfill and never writes plaintext there.
--
-- Rollback: intentionally unsupported. Encrypted secrets cannot be converted back to
-- plaintext by a SQL-only down migration without exposing the application encryption key.

alter table user_2fa_methods rename column secret to legacy_secret;
alter table user_2fa_methods alter column legacy_secret drop not null;

alter table user_2fa_methods
  add column active_secret_ciphertext text,
  add column active_secret_iv text,
  add column active_secret_auth_tag text,
  add column active_secret_version integer,
  add column pending_secret_ciphertext text,
  add column pending_secret_iv text,
  add column pending_secret_auth_tag text,
  add column pending_secret_version integer,
  add column pending_created_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table user_2fa_methods
  add constraint user_2fa_active_secret_bundle_check check (
    (
      active_secret_ciphertext is null
      and active_secret_iv is null
      and active_secret_auth_tag is null
      and active_secret_version is null
    )
    or
    (
      active_secret_ciphertext is not null
      and active_secret_iv is not null
      and active_secret_auth_tag is not null
      and active_secret_version is not null
    )
  ),
  add constraint user_2fa_pending_secret_bundle_check check (
    (
      pending_secret_ciphertext is null
      and pending_secret_iv is null
      and pending_secret_auth_tag is null
      and pending_secret_version is null
      and pending_created_at is null
    )
    or
    (
      pending_secret_ciphertext is not null
      and pending_secret_iv is not null
      and pending_secret_auth_tag is not null
      and pending_secret_version is not null
      and pending_created_at is not null
    )
  );

create index idx_user_2fa_pending_expiry
  on user_2fa_methods(pending_created_at)
  where pending_created_at is not null;

-- Down Migration

-- no-op: this is an irreversible security migration by design.
