-- Up Migration

alter table users add column if not exists muted_until timestamptz;

alter table moderation_actions drop constraint if exists moderation_actions_action_type_check;
alter table moderation_actions add constraint moderation_actions_action_type_check
  check (action_type in (
    'hide_message', 'restore_message', 'warn_user', 'mute_user', 'unmute_user',
    'close_report', 'reject_report', 'lock_conversation', 'unlock_conversation'
  ));

-- Down Migration

alter table moderation_actions drop constraint if exists moderation_actions_action_type_check;
alter table moderation_actions add constraint moderation_actions_action_type_check
  check (action_type in (
    'hide_message', 'restore_message', 'warn_user',
    'close_report', 'reject_report', 'lock_conversation', 'unlock_conversation'
  ));

alter table users drop column if exists muted_until;
