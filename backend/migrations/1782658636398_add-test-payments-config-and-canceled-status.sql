-- Up Migration

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'paid', 'in_progress', 'delivered', 'completed', 'disputed', 'refunded', 'canceled'));

-- Down Migration

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'paid', 'in_progress', 'delivered', 'completed', 'disputed', 'refunded'));
