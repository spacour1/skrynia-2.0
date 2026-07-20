-- Adds a database-backed session invalidation epoch. Access tokens and refresh
-- sessions embed the version they were issued under; authenticate/refresh reject any
-- mismatch. Security-sensitive changes (password change/reset, 2FA disable or
-- replacement, ban, logout-all) increment the version in the same transaction as the
-- security state change, so revocation no longer depends on Redis being reachable.
--
-- Rollback: alter table users drop column session_version;

alter table users add column session_version integer not null default 1;
