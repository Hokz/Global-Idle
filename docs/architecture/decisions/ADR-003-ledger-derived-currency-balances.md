# ADR-003 — Currency balances are ledger-derived projections

**Status:** `ACCEPTED`
**Phase:** 0A.1
**Date:** 2026-09-20

## Context

Gold and premium currency fund nearly every system in the game: supplies, forge fees, skill
trees, services, travel, market fees, and roster slot unlocks. The economy documents set the
bar explicitly:

> *"Never mutate balances casually. Use: transactions; idempotency; escrow; ledgers; unique
> operation IDs; audit logs."* — `docs/ARCHITECTURE.md`
> *"Market operations need: escrow; database transaction; idempotency key; buyer/seller
> validation; currency ledger; item ownership transition; audit record."* — `docs/ECONOMY.md`

A stored balance that any code path can increment is the shape of every currency duplication
bug ever shipped. A retried request, a partially-applied transaction, or two concurrent writes
produce a number nobody can explain and nobody can reconstruct.

## Decision

**Currency is not an entity and a balance is not independently writable.**

- The **ledger** is an append-only record of every value movement. Entries are immutable and
  are never updated or deleted. A correction is a new compensating entry.
- A **balance** is a `(owner, currencyType) → amount` projection, updated **only** inside the
  same database transaction that appends the corresponding ledger entries.
- Every value movement carries an **operation id**, unique, making settlement idempotent:
  replaying an operation is a no-op rather than a second credit.
- A **reconciliation job** periodically verifies that each subject's ledger sums to its
  projection. A discrepancy is a P1 incident, not a rounding curiosity.

**Gold is account-scoped.** This is a product-adjacent call made under the Phase 0A delegation.
The existing documents point firmly at it: Gold buys roster slots and pays market fees, both
account-level concerns, and the Active Party is one player. Per-character wallets would require
a transfer mechanism between a single player's own characters — friction with no design intent
behind it. Flagged for Product Owner review.

## Consequences

**Benefits.**
- Every gold movement is explainable after the fact, which is the difference between a
  supportable economy and an unsupportable one.
- Duplication becomes detectable rather than merely unlikely: the ledger either sums to the
  balance or it does not.
- Idempotency is uniform — the same mechanism protects a hunt settlement, a market purchase and
  a forge fee.
- Balance reads stay O(1). The audit trail costs storage, not read latency.

**Costs.**
- Every currency mutation is at least two writes and must be transactional. There is no cheap
  path, by design.
- The ledger grows without bound and needs a retention and partitioning strategy (0A.7).
- The projection can in principle drift from the ledger through a bug, which is why
  reconciliation is part of the decision rather than an optional extra.

**Constraints created.**
- No code may write a balance without appending the matching ledger entries in the same
  transaction. Not for rewards, not for admin tools, not for tests against real data.
- Operation ids must be generated at the boundary that owns the intent, not deep inside a
  service where a retry would produce a fresh one.

## Alternatives considered

**Stored balance only, no ledger.** Rejected outright. It cannot answer "where did my gold go",
cannot detect duplication, and gives support nothing to work with. `docs/ECONOMY.md` requires a
currency ledger regardless.

**Pure ledger with no projection — sum on every read.** Rejected. Correct but O(n) in a
player's lifetime transaction count, on a value displayed on nearly every screen. Cost grows
forever for players who play the most. A projection plus reconciliation gets the same
correctness guarantee at constant read cost.

**Event sourcing the whole domain.** Rejected as disproportionate. The economy genuinely needs
an immutable log; character progression and party composition do not, and paying event-sourcing
complexity across the entire model to get it in one place is a bad trade for a project that has
not shipped yet.

**Per-character wallets.** Rejected — see the Gold scope reasoning above. Recorded as reversible
if the Product Owner disagrees; it is cheap to change now and expensive after the ledger ships.

## Product constraints requiring this architecture

- *"Economy operations must be transactional and auditable."* — `AGENTS.md` §5
- *"Never mutate balances casually."* — `docs/ARCHITECTURE.md`
- *"escrow; database transaction; idempotency key; currency ledger; audit record"* —
  `docs/ECONOMY.md`
- *"no item duplication; no currency double-spend."* — `docs/ARCHITECTURE.md`, security baseline
- Roster slot unlocks are a Gold sink — `PARTY_SYSTEM_FOUNDATION.md` §24, `docs/ECONOMY.md`
