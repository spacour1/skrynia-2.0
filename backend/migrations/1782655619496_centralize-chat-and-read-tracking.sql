-- Up Migration

alter table conversations add column if not exists buyer_last_read_at timestamptz;
alter table conversations add column if not exists seller_last_read_at timestamptz;
alter table messages add column if not exists hidden_at timestamptz;
alter table messages add column if not exists hidden_by uuid references users(id);

create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at);

-- Down Migration

drop index if exists idx_messages_conversation_created;
alter table messages drop column if exists hidden_by;
alter table messages drop column if exists hidden_at;
alter table conversations drop column if exists seller_last_read_at;
alter table conversations drop column if exists buyer_last_read_at;
