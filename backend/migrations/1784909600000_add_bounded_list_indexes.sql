-- Up Migration
-- Cover the authenticated keyset lists by their owner/filter prefix followed by
-- the `(created_at desc, stable uuid desc)` cursor tuple.

create index if not exists idx_product_favorites_user_created
  on product_favorites(user_id, created_at desc, product_id desc);

create index if not exists idx_seller_favorites_user_created
  on seller_favorites(user_id, created_at desc, seller_id desc);

create index if not exists idx_products_seller_created_visible
  on products(seller_id, created_at desc, id desc)
  where status != 'deleted';

create index if not exists idx_user_blocks_blocker_created
  on user_blocks(blocker_id, created_at desc, blocked_id desc);

create index if not exists idx_user_reports_reporter_created
  on user_reports(reporter_id, created_at desc, id desc);

create index if not exists idx_message_reports_reporter_created
  on message_reports(reporter_id, created_at desc, id desc);

-- Down Migration

drop index if exists idx_message_reports_reporter_created;
drop index if exists idx_user_reports_reporter_created;
drop index if exists idx_user_blocks_blocker_created;
drop index if exists idx_products_seller_created_visible;
drop index if exists idx_seller_favorites_user_created;
drop index if exists idx_product_favorites_user_created;
