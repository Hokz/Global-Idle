# Game Engine / Simulation Architecture

**Document status:** `PHASE_0A_COMPLETE` / `ARCHITECTURE_APPROVED`
**Phase:** 0A.5
**Depends on:** `ADR-002`, `ADR-006`, `ADR-010`, `ADR-011`

---

## 1. What the engine is

A **pure function library** that resolves game rules. It has no I/O, no clock, no randomness of
its own, no framework types and no database. `ADR-010` records the decision and its reasoning;
this document describes the shape that follows.

Two product requirements drive everything here:

> *"Keep the combat simulation behind a stable interface so it can later move to Go/Rust/C++ if
> profiling proves necessary."*
> *"Randomized outcomes should be reproducible/debuggable through server logs where practical."*
> — `AGENTS.md` §5

---

## 2. Separation of concerns

| Concern | Belongs to | Note |
|---|---|---|
| Combat resolution, loot rolls, progression math | **engine** | pure |
| Deciding *when* to tick, *when* to settle | **orchestration** | application layer |
| Reading and writing durable state | **persistence** | never called from the engine |
| Creature, item, hunt definitions | **content** | passed in, pre-resolved (`ADR-011`) |
| Randomness | **injected** | seeded generator, seed persisted |
| Time | **injected** | elapsed time is a parameter |
| Scheduling, claims, sessions | **application** | the engine is unaware sessions exist |

The engine does not know what a session is, that a reconnect grace exists, or that a database
is involved. It is handed a situation and returns what happens.

---

## 3. Conceptual interfaces

Illustrative shapes, **not** locked signatures. Phase 0B may rename and reshape these; what is
fixed is the *character* of the boundary — explicit inputs, described outputs, no I/O.

```ts
// Advance a session-bound activity by a bounded amount of simulated time.
simulateActivity(
  state:    ActivityRunState,      // room, encounter, supplies
  party:    ParticipantProfile[],  // refreshed at checkpoints (ADR-006)
  content:  ResolvedContentSlice,  // pinned version, pre-loaded
  elapsed:  Duration,              // injected, never read from a clock
  rng:      SeededRandom,          // injected, seed persisted
): SimulationResult                // new state + described effects
```

```ts
resolveCombatStep(encounter, party, content, rng): CombatStepResult
resolveLoot(creature, party, capacityRemaining, content, rng): LootResult
applyProgression(profiles, earned, content): ProgressionDelta
deriveParticipantProfile(character, equipment, modifiers, content): ParticipantProfile
```

`SimulationResult` **describes** change; it does not perform it:

- new run state (room, supplies, encounter);
- accumulated deltas (XP, gold, resolved loot records, consumption);
- presentation events, for rendering only;
- terminal signals (party wipe, stop condition met, loot capacity reached).

Orchestration folds that into durable state inside a transaction. The engine never writes.

---

## 4. Time

`DECIDED IN PHASE 0A` — **the engine is handed elapsed time; it never asks for it.**

- No `Date.now()`, no timers, no scheduling inside engine code.
- Ticks are a parameter, so the same run can be replayed at any granularity.
- Wall-clock accrual for Skill Training is computed by the application from persisted
  timestamps and passed in as a duration.

This is also a security property: `CLIENT_SERVER_BOUNDARIES.md` §6 forbids client-supplied time,
and an engine that cannot read a clock cannot be tricked by one.

`DEFERRED PARAMETER` — tick duration, attack cadence and cooldown granularity. These are combat
balance values, consumed as configuration.

---

## 5. Randomness and reproducibility

`DECIDED IN PHASE 0A`:

- every Activity persists an **RNG seed** at start;
- the engine receives a **seeded generator**, never a global one;
- RNG draws are **ordered and named** by purpose (`loot`, `rarity`, `affix`, `crit`), so adding a
  new draw in one subsystem does not silently shift every downstream result;
- high-value randomized outcomes — rarity above a threshold, forge results — record enough
  metadata to reconstruct them: table rolled, seed position, result, operation id.

The payoff: a support report becomes a fixture. Activity inputs plus seed plus content version
reproduce the exact run, deterministically, years later.

`DEFERRED` to Phase 0B: the specific PRNG algorithm. It must be seedable, deterministic across
platforms, and not the language's default global.

---

## 6. Purity enforcement

`DECIDED IN PHASE 0A` — purity is enforced by the **build**, not by review discipline.

The `game-engine` package may not import:

- any ORM, database or cache client;
- any HTTP, framework or transport type;
- any logging or metrics library with side effects;
- ambient clock or global random APIs.

`ADR-012` puts these rules in the dependency configuration from Phase 0B's first commit. A rule
that depends on everyone remembering erodes under deadline pressure; a rule that fails the build
does not.

---

## 7. Where the rules actually live

The combat foundation specifies a **layered** model, and the engine mirrors it:

```text
BASELINE            level + effective skill + weapon + vocation parameters
      ↓
EQUIPMENT MODIFIERS
      ↓
VOCATION MODIFIERS
      ↓
WHEEL MODIFIERS
      ↓
SKILL TREE MODIFIERS
      ↓
BUFFS / DEBUFFS
      ↓
TARGET DEFENCE / RESISTANCE
      ↓
FINAL RESULT
```

`DECIDED IN PHASE 0A` — each layer is a **separate, individually testable transform**, not a
branch inside one formula. The combat foundation asks for this directly
(*"Do not create one giant formula containing every system"*), and it is what makes a balance
change reviewable and a stacking bug findable.

**Effective Skill is computed, never stored** (`DOMAIN_MODEL.md` §5.11). It is derived inside
`deriveParticipantProfile`, at checkpoints.

`DEFERRED PARAMETER` — every coefficient, curve and threshold in those layers. They are open
balance questions in `COMBAT_LEVEL_SKILLS_FOUNDATION.md` §45 and are consumed as content.

---

## 8. Loot resolution

Loot is the sharpest test of the boundary, because it creates value.

1. The engine rolls the loot table, then the rarity layer, then affixes — in that order
   (`docs/DECISIONS.md`: rarity and affixes are a layer applied *after* the table drops an item).
2. It produces a **loot record**: base item key, content version, rarity, rolled affixes, seed
   position. Not an `ItemInstance`.
3. `ItemInstance` rows are **materialized at settlement**, transactionally, alongside the XP and
   gold earned with them (`ADR-002`).
4. Remaining pooled Loot Capacity is an **input**; at zero, collection stops while combat
   continues (`docs/DECISIONS.md`).

The engine therefore cannot create an item, cannot duplicate one, and cannot be the component
that gets anti-dupe wrong.

---

## 9. Testability

The engine is testable with **no database, no browser, no API, no network**:

- deterministic fixtures — fixed seed, fixed content version, fixed inputs, asserted outputs;
- layer-by-layer unit tests, since each transform is separable (§7);
- long-horizon progression simulations, which is exactly the developer-only balance tool
  `COMBAT_LEVEL_SKILLS_FOUNDATION.md` §43 asks for, and which this boundary makes nearly free;
- replay of a recorded activity as a regression test.

`AGENTS.md` §6 warns that green CI does not prove game correctness. The determinism here is what
makes the *game* testable, not just the code.

---

## 10. The port story

If profiling ever justifies moving the engine to Go, Rust or C++:

- the boundary is a function with explicit inputs and a described output;
- no persistence, framework or transport code has to move with it;
- fixtures become the conformance suite — the new implementation must reproduce recorded runs
  exactly;
- orchestration is unchanged.

That is the whole reason for the constraints above. `AGENTS.md` §5 is explicit that the move
should happen *only* after profiling proves a need, and nothing here anticipates it beyond
keeping the door open.

---

## 11. Engine checklist

- [x] No I/O, no framework types, no persistence access
- [x] Time injected, never read
- [x] RNG injected and seeded; seed persisted with the activity
- [x] Content pinned and pre-resolved
- [x] Output describes change; orchestration applies it
- [x] Combat layers are separate transforms
- [x] Effective Skill derived, never stored
- [x] Engine cannot create or move an item
- [x] Purity enforced by build-time dependency rules
- [x] Deterministic replay from seed plus inputs plus content version
