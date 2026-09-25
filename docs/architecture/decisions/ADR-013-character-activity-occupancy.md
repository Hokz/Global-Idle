# ADR-013 — One primary action per Character, atomically enforced

**Status:** `ACCEPTED`
**Phase:** 0A
**Date:** 2026-09-20
**Amended by:** [ADR-022](./ADR-022-game-account-main-character-and-companions.md) (2026-09-25) —
the roster is one Main Character plus companions; see the note under *Decision*.

## Context

The Product Owner has locked a rule that shapes the whole activity model: a Character may
perform only one primary gameplay or progression action at a time. A Knight cannot hunt and
train simultaneously. A Knight cannot be in two Hunts.

The account, meanwhile, is explicitly allowed to run different characters on different
activities — that is the point of a five-character roster, and it is how the stamina recovery
model (`ACTIVITY_OCCUPANCY_AND_TIMERS.md` §3) is meant to be played.

`ADR-008` already establishes one **activity claim per account**, so only one session drives the
account. That is a different scope and does not answer this question: one session could still
start a Hunt and a Skill Training for the same Character.

## Decision

**Each Character holds at most one occupancy claim.**

- the claim names the occupying activity;
- acquisition is a **conditional write that fails if a claim already exists** — not an
  application-level "is this character busy?" check;
- it is released on activity end;
- it is **reserved, not released**, during reconnect grace, because the activity still exists
  and the Character is still committed to it;
- a Character in a claim cannot start another activity, join another Hunt or Dungeon, or begin
  Skill Training.

The restriction is on Character **action occupancy**, never on navigation. Browsing the Market,
inspecting the Atlas, reading a skill panel or managing another Character are not actions in
this sense.

Two claims now exist at two scopes, and both are load-bearing:

| Claim | Scope | Prevents |
|---|---|---|
| Activity claim (`ADR-008`) | Account / session | two sessions advancing the same account |
| Occupancy claim (this ADR) | Character | one Character doing two things |

**Invariant I13** — at most one occupancy claim per Character, enforced by constraint.

> **Amended by [ADR-022](./ADR-022-game-account-main-character-and-companions.md), 2026-09-25.** The
> *"five-character roster"* this record assumes is now one Main Character per Game Account plus up
> to four companions. One claim per acting Character stands for the Main. Whether each companion
> holds its own claim, and whether a companion outside the Active Party may act while the Main
> hunts — the concurrency this record calls the point of the roster — is open (`ADR-022` GA-O5),
> for Phase 4.

## Consequences

**Benefits.**
- A locked product rule becomes structurally unbreakable rather than conventionally respected.
- The stamina model gets a clean input: a Character's stamina mode is a function of its single
  occupancy, so it cannot be consuming and recovering at once
  (`ACTIVITY_OCCUPANCY_AND_TIMERS.md` §3.3).
- Roster play stays fully concurrent, which is what makes a five-character roster meaningful.
- Reserving the claim during grace means a returning player finds their Character where they
  left it, rather than having lost it to a second command.

**Costs.**
- Every activity-start path must acquire the claim, and every end path must release it. A
  forgotten release strands a Character, so release belongs in the same transaction as the
  lifecycle transition — never in a separate cleanup step.
- A stranded claim needs a recovery path. The restart sweeper that recovers orphaned activities
  (`SESSION_AND_ACTIVITY_LIFECYCLE.md` §7) covers it, since a claim without a live activity is
  exactly what it looks for.
- Party activities acquire N claims in one transaction, which must be ordered consistently to
  avoid deadlock — the same globally consistent ordering rule as value movement
  (`DATA_ARCHITECTURE.md` §4).

**Constraints created.**
- No activity may start without acquiring the claim in the same transaction.
- Claim release is part of the lifecycle transition, not a follow-up.
- A new activity type must declare that it occupies a Character — there is no unoccupied
  activity.

## Alternatives considered

**Application-level check before starting.** Rejected. Two near-simultaneous start commands both
read "not busy" and both proceed. The window is small and the consequence — a Character hunting
and training, earning both — is exactly the double-progression bug the rule exists to prevent.

**Derive occupancy from existing activity rows.** Rejected as a weaker form of the same thing: it
turns the invariant into a query whose result can be stale by the time it is acted on, and it
spreads the definition of "busy" across every activity table.

**Account-level occupancy only.** Rejected — it would forbid exactly the multi-character
concurrency the product wants, and it is already covered at the right scope by `ADR-008`.

**A boolean `isBusy` flag on Character.** Rejected. It says a Character is busy without saying
with what, so a stranded flag is unrecoverable without guesswork. A claim that names its
activity can always be reconciled against that activity's state.

## Product constraints requiring this architecture

- One primary action per Character — locked by the Product Owner
- Different Characters may act concurrently — locked
- Roster of up to five unique-vocation characters — `docs/DECISIONS.md`
- Skill Training is the only disconnected progression — `docs/DECISIONS.md`
