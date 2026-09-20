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
7. `docs/ARCHITECTURE.md`
8. `docs/MVP_SCOPE.md`
9. `docs/DECISIONS.md`
10. `docs/OPEN_QUESTIONS.md`
11. any task-specific design document.

## 3. Agent workflow

Use this workflow:

```text
research
→ understand
→ design
→ implement narrowly
→ test
→ run CI
→ self-review
→ report
→ independent review
```

Do not stop for every minor uncertainty.

Research first and make a defensible decision when the project rules are clear.

Stop and ask only when:

- the Product Owner must choose between materially different game-design directions;
- an action is destructive;
- credentials/permissions are required;
- legal/licensing uncertainty changes what can be shipped;
- no defensible implementation path exists.

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

Current phase: **Phase 0 / architecture foundation**.

Do not import the entire content universe or build the entire game at once.

The first playable target is the vertical slice described in `docs/MVP_SCOPE.md`.
