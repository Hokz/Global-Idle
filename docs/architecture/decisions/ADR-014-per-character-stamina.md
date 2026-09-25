# ADR-014 — Stamina is per-Character, activated by first qualifying XP, sustained by activity state

**Status:** `ACCEPTED`
**Phase:** 0A
**Date:** 2026-09-20
**Amended by:** [ADR-020](./ADR-020-character-deletion-grace-and-purge.md) and
[ADR-022](./ADR-022-game-account-main-character-and-companions.md) (2026-09-25) — see the note under
*Decision*.

## Context

Stamina is a locked product system with an unusual shape. It does not start burning when a
Character enters a Hunt — it starts when the Character first earns qualifying Hunt XP there.
After that it burns continuously while the Hunt advances, including the dead time between kills
and between rooms.

The tempting implementation is a heuristic: *"consume while XP arrived in the last N minutes."*
The Product Owner explicitly rejected that, and the rejection is correct for a reason worth
recording: a heuristic clock disagrees with the activity lifecycle during a long boss fight or a
dry streak, and it needs its own timer to be wrong with.

Stamina also interacts with three other systems: Premium (an account-wide entitlement that
changes both the XP band and the recovery rate), parties (mixed stamina across members), and
Shared XP (a separate eligibility predicate entirely).

## Decision

**Stamina is durable per-Character state, settled at checkpoints, with a two-part rule.**

| | |
|---|---|
| **Activation** | the Character's first qualifying Hunt XP reward in that Hunt |
| **Continuation** | that Character's Hunt participation is in authoritative `ONLINE_ACTIVE` state |

Once activated, consumption tracks the **activity lifecycle**, not XP arrival. It stops the
instant the Hunt stops advancing — pause, manual exit, activity end, or the Character leaving
the party.

A Character is in exactly one **stamina mode**, derived from authoritative state:

```text
CONSUMING    Hunt, activated, ONLINE_ACTIVE
NEUTRAL      Hunt, not yet activated  ·  Hunt paused in reconnect grace
RECOVERING   everything else, including Skill Training
```

Because the mode is a *function* of one authoritative state, it cannot oscillate and cannot be
counted twice within a settlement segment.

**Recovery is not the absence of activity; it is the absence of a consuming activity.** Skill
Training recovers. So does being offline, idling, or browsing menus.

> **Amended 2026-09-25.** A `PENDING_DELETION` Character recovers **nothing**: the deletion grace is
> a full freeze, and a restore credits nothing for the pending interval
> ([ADR-020](./ADR-020-character-deletion-grace-and-purge.md) FZ2–FZ3). Stamina per Character
> applies to the Main Character; whether each companion carries its own Stamina or shares the
> Main's is open ([ADR-022](./ADR-022-game-account-main-character-and-companions.md) GA-O4).

**Segmented settlement.** Any settlement interval that crosses a rate boundary is split at that
boundary and each segment settles at its own rate. Two boundaries do this:

- the **39:00 stamina line**, where a Premium account's 1.5× Hunt XP band ends;
- a **Premium entitlement transition** starting or expiring mid-interval.

Already-settled time is never retroactively rewritten.

**Per-Character, per-predicate eligibility.** Stamina eligibility is evaluated per Character and
combined with Shared XP level eligibility using AND. Reward distribution filters recipients by
stamina *after* computing the shared pool, so an exhausted Character cannot receive value
indirectly through a party member.

## Consequences

**Benefits.**
- One source of truth for "is this burning?" — the activity lifecycle that already exists.
- No second clock, so no second thing to get wrong. The heuristic's failure modes (long boss
  fights, dry streaks) simply do not arise.
- Reconnect grace consumes nothing for free: the pause already stops the lifecycle, and stamina
  reads the lifecycle.
- Segmented settlement keeps the bonus-XP error at zero regardless of checkpoint interval. An
  unsegmented implementation's error would grow with the interval, which is precisely the knob
  operations will want to tune.
- Per-Character ownership makes mixed-party stamina fall out rather than needing special cases.

**Costs.**
- Settlement must detect and split at boundaries, which is more arithmetic than a flat subtract.
  Bounded and testable; cases 22–24 pin it.
- "Qualifying Hunt XP" must be defined precisely enough to be a reliable trigger. It belongs in
  the combat/reward spec, and the architecture only requires that it be a server-side reward
  event.
- Three modes mean three code paths in settlement. The alternative — inferring the mode — is how
  it would drift.

**Constraints created.**
- No heuristic timer may be introduced for stamina, in any form.
- Client elapsed time is never an input.
- Every activity type declares whether it consumes stamina; undeclared fails content validation.

## Alternatives considered

**"Consume while XP arrived in the last N minutes."** Rejected by the Product Owner, and
rightly. It introduces a second clock that disagrees with the lifecycle exactly when the game is
most interesting — a long boss fight consumes nothing, a dry streak stops consuming mid-hunt.

**Consume from Hunt entry.** Rejected. It contradicts the locked activation rule and punishes a
player who enters, inspects and leaves.

**Account-level stamina pool.** Rejected — locked as per-Character. A shared pool would also make
multi-character play strictly worse than single-character play, inverting the roster's purpose.

**Decrement stamina per second.** Rejected. It is a write per second per Character for a value
nobody reads that often, and it makes restart-safety a problem instead of a property. Checkpoint
settlement from a durable marker is restart-safe by construction (`ADR-015`).

**Treat the pre-consumption Hunt state as recovery.** Rejected as an exploit: enter a Hunt, never
earn XP, recover at resting rate while occupying a hunting slot. Neutral is the only reading
that neither exploits nor contradicts the activation rule.

## Product constraints requiring this architecture

- Stamina per Character, 42:00 maximum, no account pool — locked
- Activation on first qualifying Hunt XP; continuation on authoritative activity state — locked
- "N minutes without XP" explicitly rejected as the source of truth — locked
- Premium 42→39 at +50% Hunt Base XP; no low-stamina penalty band — locked
- Zero stamina removes all Hunt reward but does not force exit — locked
- Premium recovery 1:1, Free 1:2, capped at 42:00, no waiting period — locked
- Skill Training recovers stamina — locked
- Premium is Account-wide — locked
- Server time is authoritative — `docs/DECISIONS.md`, `CLIENT_SERVER_BOUNDARIES.md` §6
