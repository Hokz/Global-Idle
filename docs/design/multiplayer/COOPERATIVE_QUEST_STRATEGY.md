# Cooperative quest strategy — the player-authored plan

**Status:** `APPROVED DIRECTION` for the model below · `OPEN` for every item in §9 ·
`FUTURE / NOT IMPLEMENTED` — nothing here is built.

**Owning phases:** Phase 5 owns the generic quest mechanics engine (solo and one-account Party,
no networking) · Phase 5B slice 1 owns multi-account infrastructure · Phase 5B slice 2 owns the
first cooperative quest · Phase 5B slice 3 owns Warzones.

**Related:** [`MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](../MULTIPLAYER_ACTIVITIES_FOUNDATION.md)
· [`../party/PARTY_SYSTEM_FOUNDATION.md`](../party/PARTY_SYSTEM_FOUNDATION.md)
· [`docs/PHASE_GATES.md`](../../PHASE_GATES.md)
· [`docs/MASTER_DEVELOPMENT_ROADMAP.md`](../../MASTER_DEVELOPMENT_ROADMAP.md) §20

---

## 1. Three group concepts that are not each other — `APPROVED DIRECTION`

```text
ACTIVE PARTY        1-4 Characters, ONE account                       Phase 4
EXPEDITION GROUP    up to 5 humans, ONE Character per account         Phase 5B slice 2
WARZONE             ~25-50 entrants, TENTATIVE and to be benchmarked  Phase 5B slice 3
```

They differ in kind, not in size:

- an **Active Party** is one player's roster acting at once. Occupancy, Stamina and rewards are
  already per Character, which is what makes it possible without any networking;
- an **Expedition Group** is several *accounts* in one Activity. That brings invitations,
  lobbies, fairness, disconnect policy, cross-account settlement and spectating — none of which
  a one-account Party needs;
- a **Warzone** is the same multi-account infrastructure at a scale that has to be measured
  before it is promised.

**A personal Party is never re-labelled as a large Party.** Growing the Active Party's cap is not
how the game gets cooperative play; the Expedition Group is.

## 2. The lobby is where the strategy is written — `APPROVED DIRECTION`

The pre-room lobby is not a waiting screen. It is where players **author the plan the server will
execute**, and it is the core of the cooperative experience.

The lobby exposes:

- **an encounter mechanic checklist** — what this fight actually does. The mechanics are declared
  by the quest definition, so players can plan against them instead of discovering them by dying;
- **role slots** — who is expected to do what;
- **the authoring surface** for the conditional strategy below.

## 3. A strategy is conditional, not a set of labels — `APPROVED DIRECTION`

This is the distinction that matters most in this document.

A role label ("healer") is static and says nothing about a fight. What players author is a
**conditional plan**: triggers, guards, assignments, priorities and ordered steps. For example —
and these are *illustrative shapes, not locked content*:

- when the boss reaches a phase threshold, the group switches target priority;
- a named participant collects a quest item when it appears;
- that item is used at a stated place, or at a stated moment, or on a stated condition;
- if the primary assignee cannot act — dead, out of position, already carrying something — a
  stated **alternate assignee** takes the task;
- a retreat or regroup condition, and what the group does after it.

The plan is **data**, versioned like any other content, and it is the only input the players get.

## 4. Readiness, freezing and execution — `APPROVED DIRECTION`

```text
lobby → all participants ready
      → plan VALIDATED and FROZEN
      → server-authoritative deterministic simulation
      → every participant watches the SAME run
```

- **Validated** means the server checks the plan against the encounter's declared mechanics and
  the group's composition before anything starts. An invalid plan is rejected in the lobby, where
  it can still be fixed.
- **Frozen** means it cannot change once the run begins.
- **There is no runtime input that bypasses the frozen plan.** No mid-fight commands, no manual
  overrides, no "one player can still click". If players want different behaviour they author it
  beforehand; that is the game.
- The run is one authoritative simulation, broadcast read-only. Every participant sees the same
  events, the same numbers and the same outcome — the determinism rules already locked in
  [`docs/DECISIONS.md`](../../DECISIONS.md) apply unchanged.

## 5. Death and spectating — `APPROVED DIRECTION`

- a **dead character immediately stops participating** and exits the active fight;
- the human behind it may **leave** or **keep watching as a spectator**;
- a **spectator cannot act, cannot claim occupancy in combat, and cannot influence RNG**. A
  spectator is a reader of the run, nothing more.

**OPEN, and deliberately not answered here:** whether death still grants rewards, and whether any
revival mechanic exists. Do not invent either. See §9.

## 6. Multi-account settlement — `APPROVED DIRECTION`

Rewards and penalties in a shared run settle **per account**. The minimum settlement safety
needed for this — a reward ledger that cannot double-pay or lose a payout across accounts — must
exist and be proven **before the first shared quest**, not deferred to the full Market.

See [`docs/PHASE_GATES.md`](../../PHASE_GATES.md) § *Pre-5B* and § *Pre-market*.

## 7. What Phase 5 must deliver for this to be possible — `APPROVED DIRECTION`

Phase 5 builds the quest engine **without any networking**, and it must already be the engine
this document later drives:

- pure, versioned, **data-driven** mechanics — triggers, guards, assignments and roles,
  priorities, ordered steps, success and failure conditions, quest items collected and used, and
  optional conditional fallback strategies;
- the same definitions must work **solo** and with a **one-account Party**;
- **no boss implemented as bespoke code**, and **no lobby built in Phase 5**.

If Phase 5 produces one hand-written boss script, Phase 5B slice 2 has nothing to build on.

## 8. Warzones — `TENTATIVE`

Scale target **~25 minimum to ~50 maximum entrants**, explicitly **tunable and to be
benchmarked**. These are not locked balance parameters.

Shape, not numbers:

- shared objectives, with **sectors or subgroups** — not fifty independent agents in one small
  arena;
- simulation cost, fairness and per-account settlement stress-tested before launch.

PvP Arena, matchmaking and ranking stay a later, post-combat-balance milestone. The only early
obligation is neutrality: keep **Actor**, **Target** and **Side** concepts free of any assumption
that one side is "the player".

## 9. Open questions

Tracked in [`docs/OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md) under *Cooperative play*:

- whether a dead participant still receives rewards, and whether revival exists at all;
- what a cross-account disconnect does — decided and tested **separately** from one-account Party
  behaviour. One player's disconnect must **not** automatically pause everybody unless that rule
  is separately approved;
- how contribution is measured, and whether it affects reward;
- how loot is distributed across accounts, and whether the Reward Chest is the vehicle;
- the plan authoring surface's expressive limits — how much conditional logic is too much;
- what happens when a frozen plan becomes unsatisfiable mid-run;
- scheduling and matchmaking for Warzone entry;
- the real Warzone entrant ceiling, after benchmarking.
