-- Up Migration
--
-- Forward-only cleanup: old request auditing stored originalUrl in path/endpoint, which
-- could include authentication tokens, one-time codes, secrets, or WebSocket tickets.

update audit_logs
   set path = split_part(path, '?', 1)
 where path like '%?%';

update audit_logs
   set endpoint = split_part(endpoint, '?', 1)
 where endpoint like '%?%';

-- Down Migration
-- Intentionally empty: removed query strings may contain secrets and must not be restored.
