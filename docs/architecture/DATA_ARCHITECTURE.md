# Data and Persistence Architecture

**Document status:** `PHASE_0A_COMPLETE` / PENDING INDEPENDENT REVIEW
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

`DECIDED IN PHASE 0A` — **state entity ids are UUIDv7.** Reasons: globally unique without
coordination, non-enumerable (unlike sequential integers, which leak volume and enable
scraping), and time-ordered, so index locality stays reasonable as tables grow — the property
plain UUIDv4 costs you. Where a compact join key later proves necessary, an internal surrogate
may be added **behind** the public id; the public id never becomes sequential.

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
| **Roster slot unlock** | Gold debit, ledger, capacity increment |
| **Character retirement** | character status, item custody → recovery, party config |
| **Skill training claim** | charges, skill progression, activity state |

A partially applied settlement is not a state the system can be in. Loot materializing without
its XP, or a purchase debiting without transferring, must be impossible rather than rare.

---

## 4. Concurrency

`DECIDED IN PHASE 0A` — **pessimistic locking for value movement, optimistic concurrency for
configuration.**

| Data | Strategy | Why |
|---|---|---|
| Balances, item custody, listings, escrow | **pessimistic** — row locks in a deterministic order | contention is real, retries on value movement are error-prone, and correctness beats throughput |
| Activity claim | **conditional write** | atomic acquire/transfer, no lock held across a request |
| Activity run state | single-writer by construction | only the claim holder writes it |
| Party configuration, UI preferences | **optimistic** — version column | contention is negligible; a lost update is a re-submit |

Locks are acquired in a **globally consistent order** (by entity type, then id) so two
operations touching the same pair cannot deadlock by approaching from opposite ends. A market
purchase locking buyer-then-seller while a refund locks seller-then-buyer is the classic way to
deadlock a marketplace; the ordering rule removes it.

---

## 5. Idempotency

Every value-moving operation carries an **operation id**, unique across the system:

- client-supplied for commands (`CLIENT_SERVER_BOUNDARIES.md` §3);
- server-generated and deterministic for settlements, derived from activity id and checkpoint
  sequence.

Enforcement is a **uniqueness constraint**, not an application check. Replaying an operation id
violates the constraint and the operation returns its original result rather than performing
again.

`DECIDED IN PHASE 0A` — deriving the settlement operation id deterministically means a retried
settlement after a network failure cannot double-apply, even if the caller lost the response.

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
| **Content** | content set version (`ADR-011`) | activities pin a version; superseded versions stay loadable while activities reference them |

A persisted activity therefore records its content version, and content retention must outlast
the longest plausible activity. Retention policy is `DEFERRED` to operations.

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
