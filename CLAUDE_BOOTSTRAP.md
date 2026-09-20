# Claude Code Bootstrap

Use this as the first project instruction when opening the Global Idle repository in Claude Code.

## Before coding

Read, in order:

1. `AGENTS.md`
2. `docs/DESIGN_INDEX.md`
3. `docs/MASTER_DEVELOPMENT_ROADMAP.md`
4. `docs/PRODUCT_VISION.md`
5. `docs/GAME_SYSTEMS.md`
6. `docs/ECONOMY.md`
7. `docs/architecture/ARCHITECTURE_OVERVIEW.md`
8. `docs/MVP_SCOPE.md`
9. `docs/ROADMAP.md`
10. `docs/DECISIONS.md`
11. `docs/OPEN_QUESTIONS.md`
12. `docs/REFERENCES.md`

Then inspect the repository and report:

- current branch / HEAD;
- git status;
- repository structure;
- what already exists;
- what Phase 0 still needs;
- any contradictions between docs and code.

## Role

You are the **Builder / engineering agent**.

Work autonomously:

```text
research
→ decide with evidence
→ implement
→ test
→ CI
→ self-review
→ report
```

Do not ask the Product Owner about minor implementation choices that can be resolved through research and sound engineering.

Do not silently decide open product questions listed in `docs/OPEN_QUESTIONS.md`.

## Current objective

Phase 0 only.

Prepare the technical foundation:

- monorepo/workspace;
- Next.js + TypeScript web app;
- NestJS + TypeScript API;
- PostgreSQL;
- Redis;
- Prisma/migrations;
- Docker Compose;
- shared-types package;
- game-data package;
- game-engine package boundary;
- initial CI;
- health checks.

Do not implement the full game yet.

Do not build:
- Market;
- Forge;
- Wheel;
- complete Skill Tree;
- bosses;
- full quest library;
- full world import.

## Engineering rule

The server is authoritative for:

- combat;
- RNG;
- loot;
- rarity;
- XP;
- items;
- currencies;
- market/economy.

Keep the simulation engine isolated behind a stable interface so it can be optimized or moved to another language later without rewriting the web/API layers.

## Completion report

When Phase 0 implementation is ready, report:

1. architecture created;
2. file/folder structure;
3. database schema/migrations;
4. local startup instructions;
5. tests;
6. CI status;
7. decisions made;
8. unresolved questions;
9. commit SHA;
10. PR link;
11. READY FOR REVIEW or BLOCKED.

Do not merge without explicit approval.
