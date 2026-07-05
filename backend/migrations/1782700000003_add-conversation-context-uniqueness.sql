-- Up Migration
--
-- Conversation contexts are intentionally separate:
-- 1. direct: one unordered user pair, no product_id/order_id
-- 2. product: one buyer/seller/product_id, no order_id
-- 3. order: one order_id, product_id may be present for display/back-compat
--
-- Before adding unique indexes, consolidate only rows that are provably the same
-- context. Do not split or merge legacy product_id + order_id rows: those are treated
-- as order-context conversations for backwards compatibility.

with direct_ranked as (
  select
    id,
    first_value(id) over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as canonical_id,
    row_number() over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as rn
  from conversations
  where product_id is null and order_id is null
),
direct_duplicates as (
  select * from direct_ranked where rn > 1
),
direct_pairs as (
  select
    c.id as canonical_id,
    c.buyer_id as canonical_buyer_id,
    c.seller_id as canonical_seller_id,
    c.buyer_last_read_at as canonical_buyer_last_read_at,
    c.seller_last_read_at as canonical_seller_last_read_at,
    d.buyer_id as duplicate_buyer_id,
    d.seller_id as duplicate_seller_id,
    d.buyer_last_read_at as duplicate_buyer_last_read_at,
    d.seller_last_read_at as duplicate_seller_last_read_at
  from direct_duplicates dd
  join conversations c on c.id = dd.canonical_id
  join conversations d on d.id = dd.id
)
update conversations c
set
  buyer_last_read_at = nullif(
    greatest(
      coalesce(c.buyer_last_read_at, 'epoch'::timestamptz),
      coalesce(
        case
          when dp.duplicate_buyer_id = c.buyer_id then dp.duplicate_buyer_last_read_at
          when dp.duplicate_seller_id = c.buyer_id then dp.duplicate_seller_last_read_at
        end,
        'epoch'::timestamptz
      )
    ),
    'epoch'::timestamptz
  ),
  seller_last_read_at = nullif(
    greatest(
      coalesce(c.seller_last_read_at, 'epoch'::timestamptz),
      coalesce(
        case
          when dp.duplicate_buyer_id = c.seller_id then dp.duplicate_buyer_last_read_at
          when dp.duplicate_seller_id = c.seller_id then dp.duplicate_seller_last_read_at
        end,
        'epoch'::timestamptz
      )
    ),
    'epoch'::timestamptz
  ),
  updated_at = now()
from direct_pairs dp
where c.id = dp.canonical_id;

with direct_ranked as (
  select
    id,
    first_value(id) over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as canonical_id,
    row_number() over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as rn
  from conversations
  where product_id is null and order_id is null
),
direct_duplicates as (select * from direct_ranked where rn > 1)
update messages m set conversation_id = dd.canonical_id
from direct_duplicates dd
where m.conversation_id = dd.id;

with direct_ranked as (
  select
    id,
    first_value(id) over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as canonical_id,
    row_number() over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as rn
  from conversations
  where product_id is null and order_id is null
),
direct_duplicates as (select * from direct_ranked where rn > 1)
update notifications n set conversation_id = dd.canonical_id
from direct_duplicates dd
where n.conversation_id = dd.id;

with direct_ranked as (
  select
    id,
    first_value(id) over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as canonical_id,
    row_number() over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as rn
  from conversations
  where product_id is null and order_id is null
),
direct_duplicates as (select * from direct_ranked where rn > 1)
update message_reports mr set conversation_id = dd.canonical_id
from direct_duplicates dd
where mr.conversation_id = dd.id;

with direct_ranked as (
  select
    id,
    first_value(id) over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as canonical_id,
    row_number() over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as rn
  from conversations
  where product_id is null and order_id is null
),
direct_duplicates as (select * from direct_ranked where rn > 1)
update moderation_actions ma set target_conversation_id = dd.canonical_id
from direct_duplicates dd
where ma.target_conversation_id = dd.id;

with direct_ranked as (
  select
    id,
    first_value(id) over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as canonical_id,
    row_number() over (
      partition by least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text)
      order by created_at, id
    ) as rn
  from conversations
  where product_id is null and order_id is null
),
direct_duplicates as (select * from direct_ranked where rn > 1)
delete from conversations c
using direct_duplicates dd
where c.id = dd.id;

with product_ranked as (
  select
    id,
    first_value(id) over (partition by buyer_id, seller_id, product_id order by created_at, id) as canonical_id,
    row_number() over (partition by buyer_id, seller_id, product_id order by created_at, id) as rn
  from conversations
  where product_id is not null and order_id is null
),
product_duplicates as (select * from product_ranked where rn > 1),
product_pairs as (
  select c.id as canonical_id, d.buyer_last_read_at, d.seller_last_read_at
  from product_duplicates pd
  join conversations c on c.id = pd.canonical_id
  join conversations d on d.id = pd.id
)
update conversations c
set
  buyer_last_read_at = nullif(greatest(coalesce(c.buyer_last_read_at, 'epoch'::timestamptz), coalesce(pp.buyer_last_read_at, 'epoch'::timestamptz)), 'epoch'::timestamptz),
  seller_last_read_at = nullif(greatest(coalesce(c.seller_last_read_at, 'epoch'::timestamptz), coalesce(pp.seller_last_read_at, 'epoch'::timestamptz)), 'epoch'::timestamptz),
  updated_at = now()
from product_pairs pp
where c.id = pp.canonical_id;

with product_ranked as (
  select
    id,
    first_value(id) over (partition by buyer_id, seller_id, product_id order by created_at, id) as canonical_id,
    row_number() over (partition by buyer_id, seller_id, product_id order by created_at, id) as rn
  from conversations
  where product_id is not null and order_id is null
),
product_duplicates as (select * from product_ranked where rn > 1)
update messages m set conversation_id = pd.canonical_id
from product_duplicates pd
where m.conversation_id = pd.id;

with product_ranked as (
  select
    id,
    first_value(id) over (partition by buyer_id, seller_id, product_id order by created_at, id) as canonical_id,
    row_number() over (partition by buyer_id, seller_id, product_id order by created_at, id) as rn
  from conversations
  where product_id is not null and order_id is null
),
product_duplicates as (select * from product_ranked where rn > 1)
update notifications n set conversation_id = pd.canonical_id
from product_duplicates pd
where n.conversation_id = pd.id;

with product_ranked as (
  select
    id,
    first_value(id) over (partition by buyer_id, seller_id, product_id order by created_at, id) as canonical_id,
    row_number() over (partition by buyer_id, seller_id, product_id order by created_at, id) as rn
  from conversations
  where product_id is not null and order_id is null
),
product_duplicates as (select * from product_ranked where rn > 1)
update message_reports mr set conversation_id = pd.canonical_id
from product_duplicates pd
where mr.conversation_id = pd.id;

with product_ranked as (
  select
    id,
    first_value(id) over (partition by buyer_id, seller_id, product_id order by created_at, id) as canonical_id,
    row_number() over (partition by buyer_id, seller_id, product_id order by created_at, id) as rn
  from conversations
  where product_id is not null and order_id is null
),
product_duplicates as (select * from product_ranked where rn > 1)
update moderation_actions ma set target_conversation_id = pd.canonical_id
from product_duplicates pd
where ma.target_conversation_id = pd.id;

with product_ranked as (
  select
    id,
    first_value(id) over (partition by buyer_id, seller_id, product_id order by created_at, id) as canonical_id,
    row_number() over (partition by buyer_id, seller_id, product_id order by created_at, id) as rn
  from conversations
  where product_id is not null and order_id is null
),
product_duplicates as (select * from product_ranked where rn > 1)
delete from conversations c
using product_duplicates pd
where c.id = pd.id;

with order_ranked as (
  select
    id,
    first_value(id) over (partition by order_id order by created_at, id) as canonical_id,
    row_number() over (partition by order_id order by created_at, id) as rn
  from conversations
  where order_id is not null
),
order_duplicates as (select * from order_ranked where rn > 1),
order_pairs as (
  select c.id as canonical_id, d.buyer_last_read_at, d.seller_last_read_at
  from order_duplicates od
  join conversations c on c.id = od.canonical_id
  join conversations d on d.id = od.id
)
update conversations c
set
  buyer_last_read_at = nullif(greatest(coalesce(c.buyer_last_read_at, 'epoch'::timestamptz), coalesce(op.buyer_last_read_at, 'epoch'::timestamptz)), 'epoch'::timestamptz),
  seller_last_read_at = nullif(greatest(coalesce(c.seller_last_read_at, 'epoch'::timestamptz), coalesce(op.seller_last_read_at, 'epoch'::timestamptz)), 'epoch'::timestamptz),
  updated_at = now()
from order_pairs op
where c.id = op.canonical_id;

with order_ranked as (
  select
    id,
    first_value(id) over (partition by order_id order by created_at, id) as canonical_id,
    row_number() over (partition by order_id order by created_at, id) as rn
  from conversations
  where order_id is not null
),
order_duplicates as (select * from order_ranked where rn > 1)
update messages m set conversation_id = od.canonical_id
from order_duplicates od
where m.conversation_id = od.id;

with order_ranked as (
  select
    id,
    first_value(id) over (partition by order_id order by created_at, id) as canonical_id,
    row_number() over (partition by order_id order by created_at, id) as rn
  from conversations
  where order_id is not null
),
order_duplicates as (select * from order_ranked where rn > 1)
update notifications n set conversation_id = od.canonical_id
from order_duplicates od
where n.conversation_id = od.id;

with order_ranked as (
  select
    id,
    first_value(id) over (partition by order_id order by created_at, id) as canonical_id,
    row_number() over (partition by order_id order by created_at, id) as rn
  from conversations
  where order_id is not null
),
order_duplicates as (select * from order_ranked where rn > 1)
update message_reports mr set conversation_id = od.canonical_id
from order_duplicates od
where mr.conversation_id = od.id;

with order_ranked as (
  select
    id,
    first_value(id) over (partition by order_id order by created_at, id) as canonical_id,
    row_number() over (partition by order_id order by created_at, id) as rn
  from conversations
  where order_id is not null
),
order_duplicates as (select * from order_ranked where rn > 1)
update moderation_actions ma set target_conversation_id = od.canonical_id
from order_duplicates od
where ma.target_conversation_id = od.id;

with order_ranked as (
  select
    id,
    first_value(id) over (partition by order_id order by created_at, id) as canonical_id,
    row_number() over (partition by order_id order by created_at, id) as rn
  from conversations
  where order_id is not null
),
order_duplicates as (select * from order_ranked where rn > 1)
delete from conversations c
using order_duplicates od
where c.id = od.id;

drop index if exists idx_conversations_with_product;
drop index if exists idx_conversations_without_product;

create unique index if not exists idx_conversations_direct_pair
  on conversations(least(buyer_id::text, seller_id::text), greatest(buyer_id::text, seller_id::text))
  where product_id is null and order_id is null;

create unique index if not exists idx_conversations_product_context
  on conversations(buyer_id, seller_id, product_id)
  where product_id is not null and order_id is null;

create unique index if not exists idx_conversations_order_context
  on conversations(order_id)
  where order_id is not null;

-- Down Migration
--
-- drop index if exists idx_conversations_order_context;
-- drop index if exists idx_conversations_product_context;
-- drop index if exists idx_conversations_direct_pair;
--
-- Recreating the old idx_conversations_with_product index is not safe automatically
-- after this migration because product and order contexts may intentionally coexist
-- for the same buyer/seller/product. A rollback must first decide how to handle those
-- intentionally separate order conversations.
