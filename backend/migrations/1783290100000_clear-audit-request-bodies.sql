-- Up Migration
--
-- Rollback: none needed (Down Migration is a no-op) - the cleared bodies are
-- intentionally unrecoverable.
--
-- The generic request-audit middleware used to persist (lightly redacted) request bodies
-- for every mutating call, which captured passwords-adjacent material: OTP/SMS/TOTP codes,
-- 2FA backup codes, delivery notes and digital keys, payout destinations, private chat
-- message text and support ticket bodies. The middleware no longer stores request bodies
-- at all; this migration purges everything captured historically. Technical audit rows
-- themselves (who/when/what endpoint/status) are preserved.

update audit_logs set request_body = null where request_body is not null;

-- Down Migration

-- no-op: purged request bodies are gone by design.
