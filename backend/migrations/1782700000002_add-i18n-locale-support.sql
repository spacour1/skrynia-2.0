-- Up Migration
-- Rollback: alter table users drop column preferred_locale;
--           alter table notifications drop column title_key, drop column body_key, drop column params;
--
-- i18n support:
-- 1) users.preferred_locale — the language explicitly chosen by the user (ua|ru|en).
--    Saved when an authenticated user switches the language; used for emails and other
--    out-of-request notifications. The URL locale still wins inside the web app.
-- 2) notifications.title_key/body_key/params — key-based notification templates.
--    title/body keep a rendered default-locale fallback for old rows and legacy clients;
--    the API localizes key-based rows into the requester's locale on read.

alter table users add column if not exists preferred_locale varchar(8) not null default 'ua';

alter table notifications add column if not exists title_key text;
alter table notifications add column if not exists body_key text;
alter table notifications add column if not exists params jsonb not null default '{}'::jsonb;
