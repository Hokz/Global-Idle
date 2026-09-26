# ADR-025 — Tunable gameplay values live in one authoritative server-side configuration surface

**Status:** `ACCEPTED` — the direction is `LOCKED` by the Product Owner (2026-09-25). Recorded in
the final 2026-09-25 governance synchronization, which follows PR #13 head `fff6faf`. **Pending
independent review.**
**Relates to:** [ADR-010](./ADR-010-pure-engine-injected-clock-and-rng.md) — the engine is a pure
function of explicit inputs. [ADR-011](./ADR-011-content-as-versioned-artifact.md) — content is a
versioned artifact that an Activity pins.
**Owning gate:** PRE-PHASE-4 — [`PHASE_GATES.md`](../../PHASE_GATES.md) § *G4.5*. **Nothing in
this record is implemented.**
**Date:** 2026-09-25

## Context

Many values in the design are deliberately **PROVISIONAL** or **TUNABLE**. Examples: companion
unlock prices, Shared XP bonuses, boss cooldowns, rates, training multipliers, costs, thresholds
and temporary limits. Balance calibration will change them, and more are on the way with every
phase.

Canary keeps values of this kind in one place, `config.lua` and its experience stages, apart from
the engine that reads them. Global Idle has no equivalent yet:

- some values are named constants in code, marked where they are tunable — for example the
  `INITIAL/TUNABLE` item constants in `packages/shared/src/constants.ts`;
- some live in the content bundles as data — for example the affix weights of
  `packages/game-data`, also marked `INITIAL/TUNABLE`;
- the rest are still open numbers in the design documents.

Scattered, a tunable value is hard to find, easy to duplicate, and changes without a trace.

## Decision

### 1. The rule — `LOCKED BY PRODUCT` (2026-09-25)

| # | Rule |
|---|---|
| CF1 | PROVISIONAL and TUNABLE defaults live in **one authoritative server-side configuration surface** — the role Canary's `config.lua` and stages play. It is not necessarily Lua. |
| CF2 | Its values have **validated types and ranges**. |
| CF3 | They are **versioned and traceable**. |
| CF4 | They are **server-authoritative**. |
| CF5 | They have **safe defaults**. |
| CF6 | They have **test fixtures**. |

Examples of what belongs in it: companion unlock prices, Shared XP bonuses, boss cooldowns, rates,
training multipliers, costs, thresholds and temporary limits.

**Never configuration** — these are invariants, not values:

| # | Not configurable |
|---|---|
| NC1 | ownership |
| NC2 | the relation between a Login and its Game Accounts |
| NC3 | the identity of the Main and of each Companion |
| NC4 | exactly-once reward claims |
| NC5 | global Character-name uniqueness |
| NC6 | binding integrity |
| NC7 | the atomic deletion and purge guarantees |
| NC8 | transaction semantics |
| NC9 | security and authority boundaries |

### 2. What that means — architecture

- **One surface, not two sources.** A tunable value is read from the surface, never re-typed as a
  literal somewhere else. A value that lives there does not also live in code or content.
- **Validated before it is used.** An out-of-type or out-of-range value is refused where the
  configuration is loaded, and never clamped or guessed at the point of use. That is the same
  discipline `DECISIONS.md` § *Imported fidelity has a stated domain* sets for formulas.
- **Server only.** The client may display a value it is sent. It never supplies one, and no
  client request changes one (`DOMAIN_MODEL.md` §8).
- **Pinned where it feeds a run.** An Activity is defined by its seed, its content version and
  the authoritative elapsed time (`DECISIONS.md` § *Determinism, and what is allowed to influence
  it*). A tunable value that feeds a running Activity's simulation or settlement is therefore
  fixed for that Activity, as its content version is (`ADR-011`). A configuration change never
  alters a run already in flight, and a settlement can be traced to the version that produced it.
- **Traceable.** Every version is recorded, and so is what changed in it, so that a balance
  change can be found after the fact and reverted.
- **Safe defaults.** Every value has a default that is valid on its own, so a missing override
  never produces an undefined or unsafe game.
- **Fixtures.** Tests pin the defaults they rely on, and a test that exercises a changed value
  names it, so a retune never silently rewrites a verified expectation.
- **A LOCKED value is not a tunable.** CF1 governs PROVISIONAL and TUNABLE defaults. A value the
  Product Owner has locked — the 720-hour deletion grace, the 42:00 Stamina maximum, the
  coefficients of the locked combat formulas — changes only by a new Product Owner decision,
  never by a configuration edit. It may still be a named constant.

**Left to the implementing phase:** the surface's physical form — a file, a table, a section of
the content bundle or its own versioned artifact — how its version relates to the content
version, and which existing `INITIAL/TUNABLE` values move into it first.

## Consequences

**Benefits.**

- One place to see and change what is tunable. Balance work stops touching engine code.
- Every retune is validated, traceable and reproducible, and cannot change a run in flight.
- The line between a tunable number and a guarantee is written down, so no balance change can
  loosen ownership, claims, names, bindings, deletion or security.

**Costs.**

- One more versioned input, which an Activity must pin with its content version.
- The values already scattered across code and content must move into the surface, each with a
  type, a range, a default and a fixture.

**Constraints created.**

- No new PROVISIONAL or TUNABLE value is added outside the surface once it exists.
- Nothing listed in NC1–NC9 is ever exposed as configuration.
- No client input sets or overrides a configuration value.

## Alternatives considered

**Leave tunables where each phase put them.** Rejected by CF1. It is how the scattering described
under *Context* happened.

**Make everything configurable.** Rejected by NC1–NC9. A guarantee that can be switched off is not
a guarantee.

**Hot-reload values into running Activities.** Rejected. A run is defined by its pinned inputs,
and a value that changes mid-run makes two settlements of the same run disagree.

**Keep the values in the content bundle only.** Not decided here. The bundle is one possible
physical form, and it would satisfy CF3 and pinning. The choice is the implementing phase's.

## Product constraints requiring this architecture

- CF1–CF6 and NC1–NC9 — Product Owner, 2026-09-25.
- *"Prefer data-driven creatures, items, hunts, quests, bosses, affixes and costs."* — `AGENTS.md`
  §5.
- *"a balance or monetization value is usually not a blocking decision: it is a configuration
  input."* — `AGENTS.md` §3.
