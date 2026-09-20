# ADR-009 — PostgreSQL is the sole durable truth; Redis holds nothing that cannot be rebuilt

**Status:** `ACCEPTED`
**Phase:** 0A.3
**Date:** 2026-09-20

## Context

The approved stack includes both PostgreSQL and Redis. `docs/ARCHITECTURE.md` assigns Redis
"cache/jobs" and lists long-running hunts among the things workers manage, which is easy to read
as *hunt state lives in Redis*.

That reading is dangerous. A Hunt's in-flight state includes an unsettled accumulator holding XP,
gold and resolved loot. Redis is not a durable store by default, and the five-minute reconnect
grace explicitly requires a paused activity to survive a disconnect — an interval during which a
server process restart is entirely plausible.

## Decision

**PostgreSQL is the only place durable truth lives.** Redis holds only state that can be
rebuilt from PostgreSQL or safely lost.

| | **PostgreSQL** | **Redis** |
|---|---|---|
| Accounts, characters, progression, skills | ✅ | — |
| Item instances and custody | ✅ | — |
| Ledger, balances, listings, escrow | ✅ | — |
| Activity run state and accumulator | ✅ | optionally cached |
| Activity lifecycle state | ✅ | — |
| Session liveness / presence | — | ✅ |
| Activity claim (single-holder lock) | ✅ authoritative | ✅ fast path |
| Job queues, timers, grace-expiry scheduling | — | ✅ |
| Rate limiting, ephemeral counters | — | ✅ |
| Read caches for content and derived views | — | ✅ |

The rule that settles every future argument: **if losing it would lose player progress, money,
items, or an audit record, it is in PostgreSQL.** Redis losing its entire dataset must cost
nothing but a cold cache, some re-scheduled timers, and disconnected sessions that reconnect.

The Activity claim is authoritative in PostgreSQL so it survives a Redis flush; Redis may front
it for latency.

## Consequences

**Benefits.**
- A Redis restart is an inconvenience, never a data-loss incident.
- Activity recovery after a process restart is a PostgreSQL read, not an archaeology exercise.
- Settlement, custody transfer and ledger append share one transactional system, so real
  transactions are available exactly where the economy needs them.
- The backup and restore story has one subject.

**Costs.**
- Activity state writes hit PostgreSQL at the checkpoint cadence rather than a cheap in-memory
  store. Bounded by the checkpoint interval, which is a deliberate tuning knob.
- Some operations read PostgreSQL where a Redis-first design would not. Acceptable for a game
  whose write volume is dominated by settlements, not by ticks.
- Redis-backed timers can fire late or be lost on flush, so grace expiry must be **verifiable
  from PostgreSQL state** and not depend on a timer having fired. A sweeper covers the gap.

**Constraints created.**
- No feature may introduce Redis as a system of record, however convenient.
- Every Redis key must have a documented rebuild path.
- Grace expiry is evaluated against a persisted timestamp, not inferred from a scheduled job.

## Alternatives considered

**Activity state in Redis with periodic PostgreSQL snapshots.** Rejected. It puts unsettled XP
and loot in a store that can lose data, and it introduces a second durability model for the one
thing players would notice losing. The write savings do not justify it at this scale.

**Redis with AOF persistence as a durable store.** Rejected. It makes Redis *more* durable
without making it transactional. The economy needs multi-row atomicity across ledger, balance
and custody, and that is what PostgreSQL is for.

**PostgreSQL only, no Redis.** Tempting for simplicity and rejected for presence: session
liveness, rate limiting and scheduling are genuinely better served by Redis, and none of them
are durable truth. Redis earns its place in exactly the roles where losing the data is fine.

## Product constraints requiring this architecture

- The 5-minute grace preserves a paused activity, and nothing progresses while paused —
  `docs/DECISIONS.md`
- *"Economy operations must be transactional and auditable."* — `AGENTS.md` §5
- *"no item duplication; no currency double-spend"* — `docs/ARCHITECTURE.md`
- PostgreSQL as the database and Redis as cache/jobs — `docs/ARCHITECTURE.md`
