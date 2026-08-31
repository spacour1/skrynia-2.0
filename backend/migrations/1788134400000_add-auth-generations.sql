-- Up Migration
--
-- Durable identity generations make short-lived Redis verification credentials
-- conditional on the database state they were issued for. A successful email change
-- increments email_generation; a successful password reset increments
-- password_generation in the same transaction as the protected mutation.
--
-- Rollback: remove the two named positive-value checks, then drop
-- password_generation and email_generation. Rolling back invalidates the generation
-- contract and must only happen together with application code that no longer relies
-- on generation-bound security tokens.

alter table users
  add column email_generation integer not null default 1,
  add column password_generation integer not null default 1,
  add constraint users_email_generation_positive_check
    check (email_generation > 0),
  add constraint users_password_generation_positive_check
    check (password_generation > 0);

-- Down Migration

alter table users
  drop constraint if exists users_password_generation_positive_check,
  drop constraint if exists users_email_generation_positive_check,
  drop column if exists password_generation,
  drop column if exists email_generation;
