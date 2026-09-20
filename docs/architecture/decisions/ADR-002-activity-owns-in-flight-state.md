# ADR-002 — Activity owns in-flight state; durable progression changes only at settlement

**Status:** `PROPOSED`
**Phase:** 0A.1
**Date:** 2026-09-20

## Context

A Hunt produces XP, gold, loot, supply consumption and room progression continuously while it
runs. Something must own that stream before it becomes permanent.

The reconnect policy makes this decision load-bearing rather than merely tidy:

> *"nothing progresses while paused: no XP, loot, gold, room progression or supply
> consumption"* — `docs/DECISIONS.md`

And a second locked rule constrains it from the other side:

> *"Room progress is not persistent between separate Hunt sessions."* — `docs/DECISIONS.md`

There is also a structural asymmetry the design documents imply but never name: Hunts and
Dungeons require a live session and pause on disconnect, while Skill Training is explicitly the
*only* progression that continues while disconnected. These are two different lifecycles
sharing one word.

## Decision

**An Activity owns its in-flight state.** Concretely it owns four things:

1. **Run state** — room or floor index, supplies remaining, encounter state.
2. **A participant snapshot** — the Active Party composition, order and starting character
   stats, frozen at activity start.
3. **An unsettled accumulator** — XP, gold, resolved loot records and consumption produced but
   not yet made permanent.
4. **A lifecycle state** — `ONLINE_ACTIVE`, `RECONNECT_GRACE_PAUSED`, `ENDED`.

**Settlement** is the only path from an Activity to durable state. It is a transactional fold
of the accumulator into Character progression, Item custody and the Economy ledger. It carries
an operation id and is idempotent under it.

**Activities are two families, not one.** Session-bound activities (Hunt, Dungeon) require a
live session and pause on disconnect. Wall-clock activities (Skill Training) accrue against
elapsed server time and are unaffected by disconnection. They share vocabulary and little else;
0A.5 decides whether they share an interface.

**Loot is resolved into the accumulator and materialized at settlement.** The engine records a
deterministic loot result (base item key, rarity, rolled affixes, seed); `ItemInstance` rows are
created transactionally at settlement alongside the XP and gold earned with them.

## Consequences

**Benefits.**
- *"Nothing progresses while paused"* becomes one state-machine property instead of a rule that
  every write path must independently respect. A paused Activity has no tick path; the
  guarantee is structural.
- *"Room progress is not persistent between sessions"* stops being a rule at all. Room progress
  lives in the Activity; the Activity ends; the progress is gone.
- Item creation shares a transaction with the progression it was earned alongside, so a crash
  cannot produce items that were never earned or XP for loot that vanished.
- Write amplification drops from per-tick to per-commit-point.
- Replay and support debugging become tractable: an Activity plus its content version and seed
  describes a run.

**Costs.**
- The accumulator is real state that must itself survive a process restart within the grace
  window, so "ephemeral" is not quite true and 0A.3 must decide its durability.
- Loot Capacity must be computed from committed inventory **plus** the pending accumulator,
  which is slightly more work than reading inventory alone.
- Unsettled progress is invisible to other parts of the system until it settles. Acceptable:
  a single player cannot observe their own hunt from two places, given invariant I9.
- Commit-point frequency becomes a tuning decision with a real failure cost — a crash loses
  everything since the last settlement.

**Constraints created.**
- No code outside settlement may write Character progression from an activity.
- Settlement must be idempotent; replaying an operation id is a no-op.
- The Skill Training settlement path must be structurally incapable of writing Base XP.

## Alternatives considered

**Write through on every tick.** Rejected. It distributes the pause guarantee across every
write path in the system, upholding it only by discipline. It also multiplies database writes
by the tick rate and makes a mid-tick crash leave progression and loot inconsistent.

**Keep in-flight state only in memory or Redis, settle at activity end.** Rejected. A process
restart during a long hunt would lose hours of progression, and the 5-minute grace explicitly
requires the paused activity to survive a disconnect — which a process restart resembles
closely enough that the distinction is not worth betting player progress on.

**One unified Activity abstraction covering Skill Training.** Rejected. Skill Training has no
session, no pause, no combat, no room progression, and must never grant Base XP. Forcing it
into the session-bound lifecycle would mean the shared abstraction carries a "does this one
pause?" flag — and flags of that kind are where invariants go to die.

## Product constraints requiring this architecture

- The 5-minute reconnect grace and zero-progression-while-paused rule — `docs/DECISIONS.md`
- *"Room progress is not persistent between separate Hunt sessions"* — `docs/DECISIONS.md`
- *"Skill Training ... is the only approved offline progression, and it never grants Base XP"*
  — `docs/DECISIONS.md`
- Supply exhaustion and full Loot Capacity change behaviour without ending the Hunt —
  `docs/DECISIONS.md`
- *"Economy operations must be transactional and auditable."* — `AGENTS.md` §5
