# Moderation and public visibility

This document is the Stage 7 visibility contract. Public reads use the same
eligibility rules whether the caller is anonymous, a user, a moderator, or an
administrator. Elevated roles grant moderation tools; they do not make hidden
marketplace content public.

## Role and visibility matrix

| Surface | User or anonymous visitor | Moderator | Administrator |
| --- | --- | --- | --- |
| Public product lists, suggestions, and seller product cards | Sees only active products from non-banned sellers. A legacy category-only product is eligible; a catalog-bound product also requires an active group and item, plus its matching active section when section-bound. | Same public result. May change moderation status through the admin moderation route. | Same public result. May change moderation status and merchandising flags. |
| Direct product detail | A visitor sees only the same public-eligible product. Its authenticated owner may preview a paused or blocked product; that preview is never cached. | May preview a paused or blocked product for moderation; that preview is never cached. | May preview a paused or blocked product for moderation; that preview is never cached. |
| Seller's own product list | An authenticated seller sees all of their non-deleted products, including paused or blocked products. | No cross-seller bypass; the endpoint is still scoped to the authenticated seller. | No cross-seller bypass on this endpoint; administrator-wide listing reads use the admin endpoint. |
| Product and seller favorites | A favorite may be added only for a currently public product or non-banned seller. Lists omit products and sellers that later become ineligible. | Same personal-favorites behavior. | Same personal-favorites behavior. |
| Public catalog tree and direct catalog reads | Sees active groups, items, and sections only. A child is never public through an inactive ancestor. | Same public result; separate admin catalog reads expose lifecycle state. | Same public result; separate admin catalog reads expose lifecycle state. |
| Conversation list and message history | A participant sees only their conversations. A hidden message has a placeholder body and no attachment. | No global conversation bypass. A moderator who is a participant receives the same redacted hidden-message representation and may use the separate moderation workflow. | May inspect any conversation for moderation. Hidden rows retain the `hidden` marker and may expose original evidence to the administrator. |
| Message moderation | No moderation mutation access. An open chat removes a newly hidden message's rendered body and attachment immediately, then refetches the committed REST representation. Restore events trigger a history refetch. | May hide and restore messages; actions are audited and delivered through the durable outbox. | Same moderation capability. |
| Listing merchandising (`isHot`, `isRecommended`) | No access. | No access; these are promotional controls, not trust-and-safety status. | Administrator only. |
| Reports | A reporter sees only their own user and message reports. | May list and resolve moderation reports. | May list and resolve moderation reports. |

## Commit, cache, and realtime boundary

- Product and seller visibility changes commit before cache invalidation. The request
  performs best-effort post-commit invalidation for immediate reads, while the durable
  outbox preserves retry and crash recovery.
- Message hide and restore commit their moderation record and `message.moderated`
  outbox event atomically. The realtime payload is
  `{ type, messageId, conversationId, hidden }`; its stable event identifier is the
  outbox row identifier.
- Public caches are an optimization only. Product, approved-media, and game visibility
  is rechecked against PostgreSQL even on a cache hit (at most 100 products or 500
  reference items). A process crash or failed Redis invalidation cannot authorize a
  stale payload to disclose blocked content. Aggregate counts may remain stale until
  invalidation retry or TTL expiry during infrastructure failure.
- A Redis namespace generation rejects entries from before invalidation and prevents
  in-flight stale fills from repopulating them. Product metadata and sitemap server
  reads use `no-store`, so Next does not retain an independent moderation cache.
- Delayed `message.created` events do not broadcast hidden content. Moderation outbox
  retries load current committed visibility instead of replaying an obsolete hide or
  restore state.

## Bounded list semantics

Growing history endpoints use descending `(created_at, id)` keysets, fetch
`limit + 1`, and return an exact `nextCursor`. Cursor timestamps come from a private
`created_at::text` projection so PostgreSQL sub-millisecond precision is not lost; the
private projection is removed before serialization.

| Endpoint family | Default | Maximum | Semantics |
| --- | ---: | ---: | --- |
| Seller products, product/seller favorites, user blocks, and own reports | 25 | 100 | Traversable keyset history. |
| Notifications | 30 | 100 | Traversable keyset history; `unreadCount` covers the complete user scope, not only the page. |
| Own support tickets | 100 | 100 | Traversable keyset history; the default preserves the former bounded response size. |
| Admin support tickets | 300 | 300 | Traversable keyset history; the default preserves the former admin response size. |
| Public seller products | 24 | 24 | Deliberately bounded recent snapshot, ordered by `created_at desc, id desc`; no continuation contract. |
| Public seller reviews | 20 | 20 | Deliberately bounded recent snapshot, ordered by `created_at desc, id desc`; no continuation contract. |

Price- and discount-sorted marketplace keysets and financial cursor callers remain
deferred under the financial freeze; see `docs/deferred-financial-scope.md`.
