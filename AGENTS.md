# AGENTS.md

This file defines how AI coding agents must operate in this repository.

## 1. Project role

You are working on **Global Idle**, a browser-based, server-authoritative idle strategy RPG.

Do not treat this as a generic clicker game.

The project depends on:

- world navigation;
- endless hunts;
- party composition;
- equipment strategy;
- randomized item instances;
- Forge;
- Imbuements;
- Wheel-style progression;
- class skill trees;
- quests as dungeons;
- boss unlocks;
- market/economy;
- Free vs Premium balance.

## 2. Mandatory reading order

Before meaningful work, read:

1. `README.md`
2. `docs/DESIGN_INDEX.md`
3. `docs/MASTER_DEVELOPMENT_ROADMAP.md`
4. `docs/PRODUCT_VISION.md`
5. `docs/GAME_SYSTEMS.md`
6. `docs/ECONOMY.md`
7. `docs/architecture/ARCHITECTURE_OVERVIEW.md`
8. `docs/MVP_SCOPE.md`
9. `docs/DECISIONS.md`
10. `docs/OPEN_QUESTIONS.md`
11. any task-specific design document.

## 3. Agent workflow

Use this workflow:

```text
research
→ choose the best defensible decision
→ document rationale and alternatives
→ complete the assigned phase
→ validate / test
→ pull request
→ independent review
→ correction loop
→ merge only after review
```

**Execution is autonomous.** Do not stop mid-phase to ask permission, and do not leave an item
open merely because it would ordinarily be a Product Owner call.

A builder or architect **may resolve an ordinary OPEN decision** when it is necessary to complete
the assigned phase, provided they:

- do not contradict a **LOCKED** product decision;
- research first, including authoritative sources where the repository is insufficient;
- record the decision and its rationale;
- identify the alternatives considered and the trade-offs;
- keep the change inside the phase's scope;
- validate and test it;
- submit it for independent review;
- **never merge their own work.**

The Product Owner retains final approval and may reverse any autonomous decision during review.

Stop and ask only when:

- an action is destructive or irreversibly external;
- credentials or permissions are required;
- a legal or licensing blocker changes what can be shipped;
- two **LOCKED** requirements are irreconcilable;
- there is genuinely no defensible option after reasonable research.

Note that a *balance or monetization value* is usually not a blocking decision: it is a
configuration input. Defer it as a parameter and continue, rather than stopping the phase.

## 4. Product Owner vs agent authority

### Product Owner owns
- game-design decisions;
- monetization direction;
- balance philosophy;
- Free vs Premium rules;
- final approval.

### Agent owns
- implementation details;
- technical architecture within approved constraints;
- tests;
- refactors necessary for correctness;
- debugging;
- CI repair;
- documentation updates.

Never silently override a locked product decision.

## 5. Architectural principles

- Keep **game data separate from engine logic**.
- Prefer data-driven creatures, items, hunts, quests, bosses, affixes and costs.
- All authoritative outcomes happen on the server.
- Browser/client is never trusted for:
  - damage;
  - loot;
  - rarity;
  - Forge success;
  - XP;
  - currencies;
  - market transfers.
- Economy operations must be transactional and auditable.
- Randomized outcomes should be reproducible/debuggable through server logs where practical.
- Avoid premature C++/WASM optimization.
- Build the first simulator in the simplest maintainable server stack.
- Keep the combat simulation behind a stable interface so it can later move to Go/Rust/C++ if profiling proves necessary.

## 6. Quality requirements

Before calling work complete:

- add tests for the requested behavior;
- add positive and negative controls where applicable;
- review rounding and RNG;
- review item/currency duplication paths;
- review transaction boundaries;
- review reconnect-grace and offline Skill Training consistency;
- review market races;
- review rollback behavior;
- review Premium/Free implications;
- run CI;
- review the full diff again from scratch.

Green CI does **not** prove game correctness.

## 7. Pull request report

Every substantial PR should state:

- what changed;
- why;
- files changed;
- data/schema changes;
- tests added;
- CI status;
- known limitations;
- unresolved design questions;
- migration/rollback notes if relevant.

Do not merge automatically unless explicitly authorized.

## 8. Research sources

For systems inspired by existing games, use source hierarchy defined in `docs/REFERENCES.md`.

Reference implementations are references, not authority.

## 9. IP / asset boundary

Do not assume third-party maps, sprites, names, text, logos, sounds or other proprietary assets can be shipped commercially merely because they are technically accessible.

Mechanics research and internal prototypes are separate from public-release asset rights.

## 10. Immediate focus

**The canonical project state is [`docs/PROJECT_STATE.json`](docs/PROJECT_STATE.json).** Read it
first. It names the active phase, the last independently VERIFIED phase, and the stacked pull
requests in flight. This section explains what that state MEANS; it does not duplicate it, because
a phase marker copied into five documents is a phase marker that goes stale in four of them — and
this file said *"Current phase: Phase 1"* for two entire phases.
`scripts/check-project-state.mjs` fails CI if the two ever disagree again.

Active phase: **Phase 3.7 — First real asset visual slice** (`IMPLEMENTATION_SPEC_READY`). Its
specification is
[`docs/specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md`](docs/specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md).
It has NOT been independently reviewed and no implementation exists; the implementation PR is gated
on review of that spec. User-supplied client assets are a PRIVATE reference and must never be
committed — see its §9.
Last VERIFIED: **Phase 3.6 — Movement fidelity: Character speed and tile ground speed**, accepted
2026-09-23 at head `f96c839d4609ecef2cf592a7f3d3c6e8a91f3ef4` (PR #10, still open and stacked on
PR #9). Phase 3.5 remains VERIFIED at `2e67f4b` (PR #9); Phase 3 at `d46f78b` (PR #8).

Phase 0A (`ARCHITECTURE_APPROVED`), Phase 0B, Phase 1, Phase 2, Phase 3, Phase 3.5 and Phase 3.6
are closed and VERIFIED. Their
primitives — occupancy, Stamina, active-use timers, entitlements, idempotency, content bundles,
transactions, the deterministic Hunt simulator, currency custody, the physical item model, the
tile map with its authoritative movement timeline, cadence-invariant random streams and the
supported movement domain every actor is proved against —
are implemented and independently reviewed. **Reuse them; do not build parallel replacements.**

A phase's own specification is the thing to build against, and the one in
`docs/specs/<phase>/` is authoritative over any summary. Do not silently redesign an approved
specification while coding: record the refinement in that phase's implementation notes instead.

Status vocabulary, and who owns each transition:

| Status | Meaning | Who sets it |
|---|---|---|
| `PLANNED` | named in a roadmap, nothing built | whoever plans |
| `IMPLEMENTATION_SPEC_READY` | the spec is accepted, build against it | the Product Owner |
| `IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW` | the implementer's end state | the implementing agent |
| `VERIFIED` | independently reviewed and accepted | **the Product Owner only** |

An implementing agent never writes `VERIFIED` and never merges its own pull request.

The first playable target is the vertical slice described in `docs/MVP_SCOPE.md`.
