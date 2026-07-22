-- Up Migration
--
-- `uploading` reserves quota before physical PutObject/writeFile. `deleting` keeps
-- quota charged until the idempotent storage.delete outbox handler confirms that the
-- provider object is gone. Both states are durable crash-recovery intents.
-- No data backfill is required: every legacy status remains valid. CHECK validation
-- avoids a long ACCESS EXCLUSIVE lock; the replacement partial index is intentionally
-- transactional and should be scheduled in a maintenance window for a very large table.

alter table storage_objects
  add constraint storage_objects_status_check_v2 check (
    status in ('uploading', 'temporary', 'attached', 'deleting', 'deleted', 'quarantined')
  ) not valid,
  add constraint storage_objects_status_timestamps_check_v2 check (
    (status = 'uploading' and attached_at is null and deleted_at is null)
    or (status = 'temporary' and attached_at is null and deleted_at is null)
    or (status = 'attached' and attached_at is not null and deleted_at is null)
    or (status = 'deleting' and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
    or (status = 'quarantined' and deleted_at is null)
  ) not valid;

alter table storage_objects validate constraint storage_objects_status_check_v2;
alter table storage_objects validate constraint storage_objects_status_timestamps_check_v2;

alter table storage_objects
  drop constraint if exists storage_objects_status_check,
  drop constraint if exists storage_objects_status_timestamps_check;

alter table storage_objects rename constraint storage_objects_status_check_v2 to storage_objects_status_check;
alter table storage_objects rename constraint storage_objects_status_timestamps_check_v2 to storage_objects_status_timestamps_check;

drop index if exists idx_storage_objects_temporary_cleanup;

create index idx_storage_objects_cleanup_intent
  on storage_objects(status, created_at)
  where status in ('uploading', 'temporary', 'deleting');

-- Down Migration
-- Rollback note: stop API/worker processes first. In-flight operation rows are mapped
-- to `quarantined` so their keys remain discoverable for manual provider cleanup after
-- old code is restored; drain them normally before rollback whenever possible.

drop index if exists idx_storage_objects_cleanup_intent;

update storage_objects
set status = 'quarantined'
where status in ('uploading', 'deleting');

alter table storage_objects
  add constraint storage_objects_status_check_v1 check (
    status in ('temporary', 'attached', 'deleted', 'quarantined')
  ) not valid,
  add constraint storage_objects_status_timestamps_check_v1 check (
    (status = 'temporary' and attached_at is null and deleted_at is null)
    or (status = 'attached' and attached_at is not null and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
    or (status = 'quarantined' and deleted_at is null)
  ) not valid;

alter table storage_objects validate constraint storage_objects_status_check_v1;
alter table storage_objects validate constraint storage_objects_status_timestamps_check_v1;

alter table storage_objects
  drop constraint if exists storage_objects_status_timestamps_check,
  drop constraint if exists storage_objects_status_check;

alter table storage_objects rename constraint storage_objects_status_check_v1 to storage_objects_status_check;
alter table storage_objects rename constraint storage_objects_status_timestamps_check_v1 to storage_objects_status_timestamps_check;

create index idx_storage_objects_temporary_cleanup
  on storage_objects(created_at)
  where status = 'temporary';
