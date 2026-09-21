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

Current phase: **Phase 1 — World / Character vertical slice**.

Phase 0A (`ARCHITECTURE_APPROVED`) and Phase 0B (`VERIFIED`, accepted 2026-09-21) are closed.
Phase 0B's primitives — occupancy, Stamina, active-use timers, entitlements, idempotency,
content bundles, transactions — are implemented and independently reviewed. **Reuse them; do
not build parallel replacements.**

Do not import the entire content universe or build the entire game at once. In particular,
Phase 1 specification (**`IMPLEMENTATION_SPEC_READY`** — build against it, and do not silently
redesign it while coding):
`docs/specs/phase-1/PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md`.

Phase 1 does **not** include the Hunt simulator, combat, loot, itemization, party gameplay or
the five vocation kits — those are Phase 2 and later.

The first playable target is the vertical slice described in `docs/MVP_SCOPE.md`.
