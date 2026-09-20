# ADR-006 — Composition is frozen for a run; power refreshes at settlement checkpoints

**Status:** `PROPOSED`
**Phase:** 0A (supersedes the participant-snapshot wording in ADR-002)
**Date:** 2026-09-20

## Context

`ADR-002` originally said a running Activity snapshots *"the Active Party composition, order and
starting character stats, frozen at activity start."* Freezing composition is right. Freezing
stats is not, and the independent review of 0A.1 caught it.

A Hunt is endless by design: *"room 10 repeats indefinitely"*. Combine that with frozen stats
and a character who levels up two hours into a session keeps fighting with minute-zero power
for as long as the session lasts. The longer a player commits to the game's central loop, the
more stale their own character becomes — which inverts the purpose of the progression system
that the loop exists to feed.

The opposite extreme is equally bad. Re-deriving combat values on every simulation tick means
reading durable Character state per tick, which destroys the engine's purity and defeats the
accumulator model `ADR-002` exists to establish.

## Decision

**Separate identity from power.**

| | **Roster snapshot** | **Participant profile** |
|---|---|---|
| Holds | character ids and slot order | effective levels, skills and derived combat values |
| Changes during the run | never | at each settlement checkpoint |
| Rationale | a mid-run swap is a power exploit and breaks a run's fairness | progression earned in a run must apply to that run |

At each settlement checkpoint the Activity, having just made the accumulated progression
durable, **re-derives the participant profile** from current Character state plus equipment,
Wheel and Skill Tree modifiers, at the Activity's pinned content version. Between checkpoints
the engine uses a stable profile.

**Derived party properties refresh on the same cadence.** Shared XP eligibility is recomputed at
the checkpoint, not per tick and not only at activity start.

## Consequences

**Benefits.**
- Progression applies to the loop that produced it, with a bounded and explainable delay.
- One refresh boundary instead of two. The checkpoint is already the transactional point where
  progression becomes durable; the engine's view of the party changes at the same instant.
- Engine purity survives: the profile is an input handed to the engine, not something it fetches.
- A level-up crossing the Shared XP threshold takes effect predictably rather than at an
  arbitrary tick.

**Costs.**
- A player who levels up mid-run waits until the next checkpoint to feel it. This is the
  accepted trade; the alternative is per-tick durable reads.
- The checkpoint interval becomes a visible tuning knob with two competing pressures: shorter
  bounds crash loss and shortens the level-up-to-power delay, longer reduces write volume. It
  is a `DEFERRED PARAMETER`, not an open architecture question.
- Profile derivation must be deterministic given the same inputs, or two checkpoints could
  produce different power from identical state.

**Constraints created.**
- The engine never reads durable Character state directly; it receives a profile.
- Profile derivation is a pure function of character state, equipment, modifiers and content
  version.

## Alternatives considered

**Freeze stats for the whole run** (the original wording). Rejected — the endless-Hunt
consequence above. It would also punish exactly the players who engage most with the core loop.

**Re-derive every tick.** Rejected. Durable reads per tick destroy engine purity, make the
simulation untestable without a database, and make the tick cost scale with party size and
modifier count.

**Refresh only on level-up events.** Rejected as a hidden second boundary: it needs an event
channel from progression into a running activity, and it would refresh at a moment that is not
transactionally aligned with anything. The checkpoint already exists; adding a second trigger
buys nothing and creates a race.

**Let the player request a refresh.** Rejected. It turns a correctness property into a button,
and a player who forgets to press it is silently weaker.

## Product constraints requiring this architecture

- Hunts are endless; room 10 repeats indefinitely — `docs/DECISIONS.md`
- Base Skill vs Effective Skill is a hard line, with effective values derived from base plus
  equipment, Wheel and Skill Tree — `COMBAT_LEVEL_SKILLS_FOUNDATION.md` §18
- Shared XP eligibility is evaluated across the whole Active Party from current levels —
  `docs/DECISIONS.md`
- *"Keep the combat simulation behind a stable interface"* — `AGENTS.md` §5
