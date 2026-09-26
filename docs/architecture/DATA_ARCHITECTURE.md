# Data and Persistence Architecture

**Document status:** `PHASE_0A_COMPLETE` / `ARCHITECTURE_APPROVED`
**Phase:** 0A.3
**Depends on:** `ADR-001`, `ADR-003`, `ADR-004`, `ADR-009`

> This document defines persistence **strategy**. It is not a schema. No Prisma model, table or
> index is specified here — that is Phase 0B, and it should be written against these rules.

---

## 1. Durable vs ephemeral

`ADR-009` settles the split. The rule that resolves every future argument:

> **If losing it would lose player progress, money, items, or an audit record, it lives in
> PostgreSQL.**

| Data | Home | If lost |
|---|---|---|
| Accounts, auth identities, entitlements | PostgreSQL | catastrophic |
| Characters, progression, skills | PostgreSQL | catastrophic |
| Item instances and custody | PostgreSQL | catastrophic |
| Ledger, balances, listings, escrow | PostgreSQL | catastrophic |
| Activity run state, accumulator, seed, lifecycle | PostgreSQL | player loses in-flight progress |
| Activity claim | PostgreSQL (authoritative), Redis (fast path) | rebuildable |
| Session presence and liveness | Redis | sessions reconnect |
| Job queues, grace-expiry scheduling | Redis | sweeper recovers |
| Rate-limit counters | Redis | limits reset |
| Content and derived read caches | Redis | cold cache |

Every Redis key must have a documented rebuild path. There are no exceptions, including for
performance.

---

## 2. Identity

Two families (`DOMAIN_MODEL.md` §4):

- **State entities** — opaque, globally unique, immutable, never reused, not guessable, carrying
  no business meaning.
- **Content definitions** — readable canonical keys, `creature.rookgaard.rat`.

`DECIDED IN PHASE 0A` — **state entity ids are UUIDv7**, chosen for uniqueness without
coordination and for time-ordering, which keeps index locality reasonable as tables grow — the
property plain UUIDv4 costs you. Sequential integers are avoided because they leak volume and
invite scraping.

**An identifier is not an authorization mechanism.** Being hard to guess is a marginal
convenience, never a control. The security boundary is authorization plus ownership-scoped
queries plus rate limiting (`CLIENT_SERVER_BOUNDARIES.md` §7): every entity is loaded scoped to
the authenticated principal, so knowing an id — guessed, leaked or shared — grants nothing.
Nothing in the system may rely on an id being secret.

Where a compact join key later proves necessary, an internal surrogate may be added **behind**
the public id; the public id never becomes sequential.

---

## 3. Transaction boundaries

`DECIDED IN PHASE 0A` — **the unit of transaction is the domain operation, not the table write.**

These are each exactly one transaction, all-or-nothing:

| Operation | Touches |
|---|---|
| **Settlement** | progression, skills, item custody (loot materialization), ledger, balance, activity state |
| **Market purchase** | buyer balance, seller balance, fee, item custody, ledger ×N, listing state |
| **Market listing** | item custody → escrow, listing row, fee, ledger |
| **Forge attempt** | cost debit, ledger, two sacrifices → consumed, target tier on success |
| **Roster slot unlock** — a companion unlock, `ADR-022` | Gold debit, ledger, capacity increment |
| **Game Account deletion request** | the Game Account's lifecycle `ACTIVE` → `PENDING_DELETION` and its two timestamps, after the quiescence check — no occupancy claim or non-terminal Activity for any of its actors, no live obligation; configured Active Party membership does not block (`ADR-024` §2). Stamina and every other time-derived value of every Character are settled up to the accepted request, and nothing accrues after it (FZ2) |
| **Game Account restore** | lifecycle back to `ACTIVE`, timestamps cleared — decided against the deadline after the Game Account's lock is held (`ADR-020` §2, §7; `ADR-024` §2). Time-derived state resumes from the restore instant; nothing is credited for the grace (FZ3) |
| **Game Account purge** | the Game Account's whole closure — every Character and everything each owns, its items in every custody (Store Containers and bound items included), its Bank, Depot and Stash, its ledger entries and balances, entitlements, activity history, derived settlement and idempotency records — **then** the Game Account row, releasing its Characters' names in the same commit. One transaction, under the purge capability; the Login and every other Game Account are unchanged (`ADR-024` §3). The same boundary writes the internal history record (HR2–HR5) — no Deleted List entry, no destroyed-value inventory — and builds no general telemetry (DH6) |
| **Activity start** | activity row, account activity claim, **one occupancy claim per participating Character** |
| **Activity end / retirement of claims** | activity state, **release of every occupancy claim**, in the same transaction as the lifecycle transition |
| **Skill training claim** | charges, skill progression, activity state |
| **Bound item move** (future, `ADR-021`) | a Character-bound consumable between its Store Container and the Depot, binding unchanged — locks the Account, then the bound Character, then the item, and checks the Character is `ACTIVE` |
| **Bound consumable use** (future, `ADR-021`) | the item or its charges, and the effect it grants — only for its bound Character |
| **One-time reward claim** (future, Phase 5, `ADR-023`) | the claim and the grant it authorises, together. A uniqueness guarantee over the Game Account and the reward makes a retried or concurrent claim grant at most once |

A partially applied settlement is not a state the system can be in. Loot materializing without
its XP, or a purchase debiting without transferring, must be impossible rather than rare.

---

## 4. Concurrency

`DECIDED IN PHASE 0A` — **pessimistic locking for value movement, optimistic concurrency for
configuration.**

| Data | Strategy | Why |
|---|---|---|
| Balances, item custody, listings, escrow | **pessimistic** — row locks in a deterministic order | contention is real, retries on value movement are error-prone, and correctness beats throughput |
| Activity claim (account/session) | **conditional write** | atomic acquire/transfer, no lock held across a request |
| Character occupancy claim | **conditional write + uniqueness constraint** | one primary action per Character (`ADR-013`, I13). A party start acquires N claims in **one** transaction, in the globally consistent order below |
| Activity run state | single-writer by construction | only the claim holder writes it |
| Party configuration, UI preferences | **optimistic** — version column | contention is negligible; a lost update is a re-submit |

Locks are acquired in a **globally consistent order** (by entity type, then id) so two
operations touching the same pair cannot deadlock by approaching from opposite ends. A market
purchase locking buyer-then-seller while a refund locks seller-then-buyer is the classic way to
deadlock a marketplace; the ordering rule removes it.

---

## 5. Idempotency

`DECIDED IN PHASE 0A` — **two separate mechanisms**, deliberately not one. Conflating them is
what produces the cross-account collision and the payload-mismatch hole that `ADR-017` closes.

### Client-originated value-moving commands

```text
key identity  =  (authenticated Account/principal, command namespace, client idempotency key)
stored with   =  canonical semantic request fingerprint + authoritative result (or a reference to it)
```

| Case | Behaviour |
|---|---|
| Key identity unseen | execute, store `(fingerprint, result)`, return result |
| Same key identity, **same** fingerprint | return the original result; do not execute |
| Same key identity, **different** fingerprint | **explicit conflict reject**; do not execute, do not overwrite |
| Same client key, **different Account** | a different key identity entirely — no collision, no leakage |

A client key is **not** globally unique across the system, and nothing may treat it as such. It
is unique only within its principal and command namespace. Uniqueness is enforced by a
constraint over the full key identity, not over the client key alone.

### Server settlement

Settlement operation ids are **server-generated and deterministic**, derived from activity id
plus checkpoint sequence. They are not client keys, do not use the fingerprint contract, and are
enforced by their own uniqueness constraint. Determinism means a retried settlement after a lost
response cannot double-apply.

---

## 6. Auditability

- The ledger is **append-only**. No updates, no deletes — enforced by database permissions, not
  convention.
- Every entry names its operation id, so a movement traces back to the command or settlement
  that caused it.
- Item custody transitions are recorded, so an item's history is readable in order.
- Corrections are **compensating entries**, never edits.
- A reconciliation job verifies ledger sums against balance projections. A discrepancy is a P1
  incident (`ECONOMY_INTEGRITY.md`).

**The one designed exception — a Game Account's final purge** (`ADR-024`, reusing `ADR-020`;
`LOCKED BY PRODUCT`). Exactly 720 elapsed hours after a deletion request, the purge removes the
whole Game Account and everything it owned — its ledger entries, BANK and POUCH, included, unless
the PRE-4 specification keeps them as immutable history outside live state (`ADR-024` §3). An
internal history record for support survives, outside live persistence, and never takes part in
ownership, custody, claims or uniqueness (HR2–HR5). The exception is narrow by construction:

- it applies **only** to rows that belong to the purged Game Account or to one of its Characters.
  The Login and every other Game Account — of the same Login included — are unchanged, and every
  surviving custody scope still reconciles;
- it is performed **only** by the purge capability. The application role still has no `UPDATE`
  or `DELETE` on the ledger;
- a record shared with another Game Account — a completed co-op run, a completed trade — survives
  for the other side. The owning phase either removes the purged Game Account's identity from it
  or keeps it as immutable history within HR5 (`ADR-024` §3).

*Until the final synchronization* the purge took one Character, and the Account's BANK entries
survived it (`ADR-020` §6.1). Since `ADR-024` the Bank goes with its Game Account.

Everything above holds for ordinary play. After a purge, nothing about the purged Game Account's
economy is answerable from the live ledger. The internal history record keeps what support needs
(HR3); it is not an economy record (HR4).

---

## 7. Activity state persistence

The one place where persistence strategy is unusual, so it is stated explicitly.

An Activity persists: lifecycle state, run state, roster snapshot, participant profile, RNG
seed, pinned content version, accumulator, `graceExpiresAt`, claim holder.

- Written at each **settlement checkpoint** and at every **lifecycle transition** — not per tick.
- Between checkpoints, in-flight state may be held in memory by the claim holder and mirrored to
  Redis for fast resume, but PostgreSQL remains authoritative.
- Crash exposure is bounded by the checkpoint interval, which is the explicit cost of that knob.

---

## 8. Migrations

`DECIDED IN PHASE 0A`:

- migrations are **forward-only** and **additive first**: add, backfill, switch reads, then
  remove in a later release. A deploy must never require a simultaneous code and schema cutover;
- every migration is reversible **in effect** — a safe rollback path exists — even where a
  literal `down` is impractical;
- destructive changes are split across releases so a rollback never strands data;
- **no migration rewrites ledger rows.** Ever. A schema change that needs different ledger shape
  writes new rows or a new table.

---

## 9. Data versioning and compatibility

Two independent version axes, deliberately not conflated:

| Axis | Versioned by | Compatibility rule |
|---|---|---|
| **Schema** | migrations | code tolerates one migration ahead and behind, so deploys can roll |
| **Content** | content bundle version (`ADR-011`, `ADR-016`) | activities pin a version; **a referenced bundle is never removed** and any referenced bundle is resolvable and loadable at runtime |

A persisted activity records its content bundle version, and **PostgreSQL references are what
determine which bundles are pinned** — the pinned set is a query over durable state, not separate
bookkeeping that could drift.

`LOCKED` — a referenced bundle is never deleted (invariant I16, `ADR-016`). This is not a
retention *policy* question and is not deferred: there is no automatic sweep that could remove
one. Hunts are endless, so no bound on activity lifetime may be assumed. What remains `DEFERRED`
to operations is only the storage backend for bundles and the cadence of the explicit, audited
cleanup of genuinely **un**referenced versions.

---

## 10. Recovery expectations

| Scenario | Expectation |
|---|---|
| Process restart | activities recover per `SESSION_AND_ACTIVITY_LIFECYCLE.md` §7; bounded loss = one checkpoint |
| Redis total loss | no durable loss; sessions reconnect, sweeper recovers scheduling, caches refill |
| PostgreSQL restore from backup | loss window = backup lag; ledger reconciliation runs before reopening writes |
| Partial transaction failure | rolled back; the operation id is free to retry |
| Reconciliation mismatch | P1; economy writes for the affected subject are halted pending investigation |

`DECIDED IN PHASE 0A` — after any restore, **reconciliation runs before the economy reopens**.
Serving a balance that disagrees with the ledger is worse than a few minutes of downtime.

**`OPEN` — restores and Game Account deletion** (`ADR-024`, operational gate). A restore from
backup brings back every Game Account that was purged after the backup point, and loses every
deletion request or restore made after it. A `PENDING_DELETION` Game Account whose deadline has
passed would be purged again at once — including one whose owner restored it inside the lost
window. Recommended until decided: after any restore the purge job stays **paused** until
operators have reconciled the lifecycle transitions lost in the restore window. The pause is
disaster recovery, not a deferral: every Game Account that falls due during it is an overdue purge
— the monitored, degraded condition of `ADR-020` §7. How long backups and logs may keep a purged
Game Account is also open, and so is how long internal history records are kept, and who in
support may read them. All are tracked in [`../OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md)
§ *Game Account deletion*.

---

## 11. Deferred to Phase 0B

| | |
|---|---|
| Prisma schema, tables, columns, indexes | the shape follows from §3–§5 |
| Partitioning and retention for the ledger | a scale concern, not a correctness one |
| Connection pooling and read replicas | no load data exists yet |
| Precise backup cadence and RPO/RTO targets | `OPERATIONS_ARCHITECTURE.md` sets the frame |

---

## 12. Persistence checklist

- [x] One durable store; Redis holds only rebuildable state
- [x] Transaction boundary = domain operation
- [x] Value movement is pessimistically locked, in a globally consistent order
- [x] Idempotency enforced by constraint, not by application check
- [x] Ledger append-only at the permission level
- [x] Activity state durable, written at checkpoints and transitions
- [x] Migrations forward-only, additive first, never rewriting the ledger
- [x] Schema and content versioned independently
- [x] Reconciliation gates the economy after a restore
