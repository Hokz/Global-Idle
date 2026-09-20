# ADR-015 — Active-use duration timers settle at checkpoints, never by wall clock

**Status:** `PROPOSED`
**Phase:** 0A
**Date:** 2026-09-20

## Context

Several locked systems measure duration in *use*, not in elapsed real time: XP boosts, status
boosts, loot boosts, Stamina, and Imbuements with their 12 hours of **active use**.

The obvious implementation — store an expiry timestamp, compare to now — is wrong for every one
of them. An Imbuement must not expire while the item sits unequipped in a bag overnight. An XP
boost must not drain while the player is at work. Stamina must not burn during reconnect grace.

The other obvious implementation — decrement every second — is a write per second per timer per
Character, for values nobody reads that often, and it makes restart-safety a problem to solve
rather than a property to have.

## Decision

**One reusable model: `{ remainingDuration, qualifyingSince }`, settled at checkpoints.**

- entering a qualifying state records `qualifyingSince` from the **server clock**;
- leaving it settles `remainingDuration -= (now - qualifyingSince)` and clears the marker;
- settlement also runs at every activity checkpoint, so a long qualifying run is chunked rather
  than held open indefinitely;
- each settlement carries an **operation id**, so a retry is a no-op;
- both fields are **durable**, so a crash resettles from `qualifyingSince` rather than losing or
  double-counting the interval.

**Qualifying state is declared per effect**, not assumed:

| Effect | Qualifies while |
|---|---|
| XP boost | reward-generating Hunt usage |
| Combat / status boost | qualifying active combat |
| Loot boost | reward-generating activity |
| Imbuement | its item is equipped **and** in use in a qualifying activity |
| Stamina | the same machinery, sign inverted — consuming or recovering by mode |

**Reconnect grace pauses every active-use timer**, because the simulation is paused. This is not
a special case: grace leaves the qualifying state, which settles the timer and clears the
marker, exactly like any other exit.

## Consequences

**Benefits.**
- One mechanism for a whole family of features, so a future boost product cannot invent its own
  ad-hoc countdown and get pausing wrong.
- Restart-safe by construction: `qualifyingSince` is durable, so recovery is arithmetic rather
  than reconstruction.
- Retry-safe by construction: the operation id makes a resettled interval idempotent.
- Writes scale with checkpoints, not with seconds.
- Client elapsed time has nowhere to enter. The server measures the interval it owns.
- Aligns with `ADR-002`'s settlement model, so timers and progression commit together.

**Costs.**
- A timer's remaining value between checkpoints is `remainingDuration - (now - qualifyingSince)`,
  a computed read rather than a stored one. Cheap, but every consumer must compute it rather
  than trusting the stored field — including the UI.
- Every effect must declare its qualifying state. This is the work; it is also the point.
- A qualifying state that is entered and left rapidly produces many small settlements. Bounded
  by checkpoint alignment, and the operation id keeps them correct.

**Constraints created.**
- No feature may implement a countdown with a wall-clock expiry timestamp.
- No timer is decremented on a schedule.
- `qualifyingSince` is written only by state transitions, never by a background job.

## Alternatives considered

**Expiry timestamp compared to now.** Rejected. It is wall-clock expiry, which is precisely what
every one of these effects must not be. An Imbuement would drain in a bag; a boost would drain
while the player sleeps.

**Decrement every second.** Rejected. Write amplification for no read benefit, and a crash
between decrements either loses or double-counts depending on ordering — restart-safety becomes
a design problem instead of a property.

**Track duration in the client and report it.** Rejected outright. It is the exact shape
`CLIENT_SERVER_BOUNDARIES.md` §6 forbids: a client that reports how long it used something can
mint duration, and for Imbuements that is real economic value.

**A separate bespoke mechanism per effect.** Rejected. Five implementations of "pause correctly
during reconnect grace" is five chances to get it wrong, and the fifth would be written under
deadline by someone who has not read this ADR.

## Product constraints requiring this architecture

- Duration decreases only in a qualifying state; wall clock does not burn it — locked
- Reconnect grace pauses active-use timers — locked
- Imbuement: 12 hours of **active use**, no burn while unequipped, inactive or paused — locked
- Re-equipping resumes remaining duration rather than resetting it — locked
- Restart preserves exact remaining duration — locked
- "Do not persist a decrement every second" — locked
- Server time is authoritative; client elapsed time is never accepted — `docs/DECISIONS.md`
