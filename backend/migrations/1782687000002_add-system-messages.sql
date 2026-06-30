-- Lets order lifecycle events (created/paid/started/delivered/disputed/resolved/released/
-- refunded) post directly into the order's chat as system messages, instead of only living
-- in the separate order_events table that the chat UI never reads.
alter table messages alter column sender_id drop not null;
alter table messages add column if not exists kind text not null default 'user' check (kind in ('user', 'system'));
alter table messages add column if not exists system_type text;
alter table messages add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_messages_conversation_kind on messages(conversation_id, kind);
