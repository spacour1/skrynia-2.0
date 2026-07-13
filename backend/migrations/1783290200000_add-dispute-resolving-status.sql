-- Up Migration
--
-- Rollback: see Down Migration - restores the two-state CHECK (any 'resolving' rows
-- must be manually settled first).
--
-- Dispute resolution state machine (production hardening). Resolution runs an escrow
-- operation (refund/release - existing financial service, untouched) that cannot join the
-- dispute UPDATE's transaction. The new intermediate 'resolving' status lets the route:
--   1. atomically claim the dispute (open -> resolving), so two admins can never both
--      trigger the escrow operation;
--   2. revert to 'open' if the escrow op fails (safe retry);
--   3. finish bookkeeping idempotently if a crash landed between the escrow op and the
--      final 'resolved' update (order already terminal, dispute stuck in 'resolving').

alter table disputes drop constraint disputes_status_check;
alter table disputes add constraint disputes_status_check
  check (status in ('open', 'resolving', 'resolved'));

-- Down Migration

alter table disputes drop constraint disputes_status_check;
alter table disputes add constraint disputes_status_check
  check (status in ('open', 'resolved'));
