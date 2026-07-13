-- Up Migration
--
-- Rollback: see Down Migration - drops the two constraints/indexes added here.
--
-- Schema-to-code reconciliation (production hardening, stage 1). The audit found the
-- schema already matches the application contract for roles (user/moderator/admin CHECK),
-- messages (kind/system_type/metadata/hidden_*), catalog builder tables, 2FA (hashed
-- backup codes) and products (schema_version/section_id/game_id/metadata). Two invariants
-- were only enforced in application code; this migration makes the database guarantee them:
--
-- 1. At most one ACTIVE schema version per catalog section. publishSchemaVersion archives
--    the previous active row in the same transaction, but nothing stopped concurrent
--    publishes or a manual write from leaving two active versions.
--
-- 2. messages sender/kind contract: system messages have no sender, user messages must
--    have one. createSystemMessage always writes (sender_id null, kind 'system'); the
--    defensive UPDATE below reclassifies any legacy senderless rows so the constraint
--    can be added on existing databases without failing.

-- Defensive cleanup before the unique index: if any section somehow has two active schema
-- versions, keep the highest version and archive the rest (matches publish semantics).
update catalog_section_schemas s
   set status = 'archived'
 where s.status = 'active'
   and exists (
     select 1 from catalog_section_schemas newer
      where newer.section_id = s.section_id
        and newer.status = 'active'
        and newer.version > s.version
   );

create unique index if not exists uq_catalog_section_schemas_one_active
  on catalog_section_schemas(section_id)
  where status = 'active';

update messages set kind = 'system' where sender_id is null and kind = 'user';

alter table messages add constraint messages_sender_kind_check
  check (
    (kind = 'system' and sender_id is null)
    or
    (kind = 'user' and sender_id is not null)
  );

-- Down Migration

alter table messages drop constraint if exists messages_sender_kind_check;
drop index if exists uq_catalog_section_schemas_one_active;
