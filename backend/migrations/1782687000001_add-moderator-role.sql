-- "seller" was never a real permission level - product ownership already comes from
-- products.seller_id, not the user's role - so it only ever served as a cosmetic label for
-- seeded demo accounts. Collapse it into "user" and add a real "moderator" role with reduced
-- permissions (warnings/mutes/reports/message moderation) short of full admin access.
update users set role = 'user' where role = 'seller';

alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('user', 'moderator', 'admin'));
