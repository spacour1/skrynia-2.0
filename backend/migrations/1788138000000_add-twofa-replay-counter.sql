-- Up Migration
--
-- Persist the greatest TOTP counter accepted for the active authenticator so the
-- same code cannot be replayed, including by concurrent requests on different API
-- replicas. NULL means that the active secret has not accepted a code yet.

alter table user_2fa_methods
  add column last_accepted_counter bigint;

alter table user_2fa_methods
  add constraint user_2fa_last_accepted_counter_check
  check (last_accepted_counter is null or last_accepted_counter >= 0);

-- Down Migration
--
-- Rollback removes only replay history. Rolling back while 2FA remains enabled
-- temporarily permits reuse within the bounded TOTP window, so disable writes and
-- drain authentication traffic before applying this down migration.

alter table user_2fa_methods
  drop constraint if exists user_2fa_last_accepted_counter_check;

alter table user_2fa_methods
  drop column if exists last_accepted_counter;
