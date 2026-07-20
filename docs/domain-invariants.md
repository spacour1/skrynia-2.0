# Domain invariants

The single reference for marketplace lifecycle values and business rules. Code source
of truth: `backend/src/domain/enums.ts` and `backend/src/domain/money.ts`. The database
CHECK constraints are pinned to these sets by `backend/test/domain-invariants.test.ts` —
change a set only together with a migration, the enums module, and that test.

## OrderStatus

`pending, paid, in_progress, delivered, disputed, completed, refunded, canceled`

- The initial status is `pending` (docs previously said `created` — that status never
  existed in the schema).
- `canceled` exists since migration `1782658636398` and is used by the mock/test
  payment failure flow (`pending → canceled`). Do not remove it.
- Terminal statuses: `completed`, `refunded`, `canceled`.

### Transition graph (current behavior; enforced centrally from the state-machine stage)

```
pending     -> paid (payment capture; instant-delivery products go straight to delivered)
pending     -> delivered (instant delivery capture path in lockEscrow)
pending     -> canceled (payment failure/cancel before capture)
paid        -> in_progress (seller starts)
paid        -> delivered (seller delivers without explicit start)
paid        -> disputed
paid        -> refunded (admin/dispute refund)
in_progress -> delivered
in_progress -> disputed
in_progress -> refunded
delivered   -> completed (buyer confirm or auto-release)
delivered   -> disputed
delivered   -> refunded
disputed    -> completed (dispute release)
disputed    -> refunded (dispute refund)
completed   -> (none)
refunded    -> (none)
canceled    -> (none)
```

## ProductStatus

`active, paused, blocked, deleted`

## DisputeStatus

`open, resolving, resolved, resolution_failed`

`resolving` and `resolution_failed` are technically significant recovery states
(migration `1783290400000`): `resolving` marks a claimed resolution whose escrow call
may be in flight or crashed; `resolution_failed` marks a claim whose escrow call
failed retryably while preserving the original decision and operation identity. They
are visible to admin/internal contracts; participant-facing DTOs must not expose the
internal recovery fields (`resolution_operation_id`, `resolution_attempts`,
`last_resolution_error`, `resolving_started_at`).

## DisputeDecision

`refund, release`

## DeliveryType

`manual, instant`

`service` is a ProductType, never a delivery type. `products.delivery_type` has been
constrained to manual/instant since the initial schema; migration `1783291000000`
aligned `game_sections.allowed_delivery_types` (removed `service`, required at least
one value).

## ProductType

`account, key, topup, boosting, service, item, currency`

## CatalogStatus

Groups (`catalog_groups`), items/games (`games`), and sections (`game_sections`) share
one lifecycle: `draft, active, hidden, archived, deleted`.

Section schemas (`catalog_section_schemas`) have a distinct lifecycle and must not be
merged with the above: `draft, active, archived`.

## Role

`user, moderator, admin`

The cosmetic `seller` role was replaced by `user` in migration `1782687000001`.

## MessageKind

`user, system`

System messages have `sender_id = null` and a `system_type`; user messages require a
sender (DB CHECK enforces both directions).

## Platform fee

- Rule: **floor**, computed in BigInt: `fee = (amount * feeBps) / 10000n`
  (`backend/src/domain/money.ts:platformFeeCents`).
- Floor is the historical rule the existing append-only ledger was booked under.
  Changing the rounding direction would silently re-price historical orders — never
  do this without an explicit business decision and a dated cutover.
- Fee applies on escrow release only; refunds carry no fee.

## Money

- All persisted amounts are integer cents (`bigint` columns). No floats, ever.
- `wallets` has `available_cents` and `escrow_cents` (there is no single
  `balance_cents` column).
- The ledger (`ledger_entries` + `ledger_lines`) is append-only (DB triggers block
  UPDATE/DELETE); every entry balances debits and credits.

## Dispute permissions

| Action | Who | From which order statuses |
| --- | --- | --- |
| Open dispute | buyer or seller of the order (email-verified) | `paid`, `in_progress`, `delivered` (repeat open of a `disputed` order returns the existing dispute) |
| Read dispute + thread | participants, moderator, admin | any |
| Post dispute message | participants, moderator, admin (until resolved) | `disputed` |
| Hide dispute message | admin | any |
| Resolve (release/refund) | **admin only** — financially significant | `disputed` (`open`/`resolving` dispute) |

- The original `opened_by`, `reason`, and `created_at` of a dispute are immutable
  (DB triggers). A repeated open never rewrites evidence.
- Moderators intentionally have no resolution rights; do not widen this without an
  explicit product decision.

## Where these values are enforced

| Set | DB constraint | Code |
| --- | --- | --- |
| OrderStatus | `orders_status_check` (migration `1782658636398`) | `domain/enums.ts` |
| ProductStatus | `products.status` CHECK (initial schema) | `domain/enums.ts` |
| DisputeStatus | `disputes_status_check` (migration `1783290200000`) | `domain/enums.ts` |
| DisputeDecision | `disputes.resolution` CHECK (initial schema) | `domain/enums.ts`, dispute resolve schema |
| DeliveryType | `products.delivery_type` CHECK + `game_sections_allowed_delivery_types_check` | `domain/enums.ts`, product/catalog schemas |
| ProductType | `products.product_type` CHECK | `domain/enums.ts`, product/catalog schemas |
| CatalogStatus | status CHECKs on catalog tables | `domain/enums.ts`, `catalog.helpers.ts` |
| Role | `users_role_check` (migration `1782687000001`) | `domain/enums.ts`, `common/types.ts` |
| MessageKind | `messages.kind` CHECK (migration `1782687000002`) | `domain/enums.ts` |
