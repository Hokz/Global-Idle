# Technical Architecture — Phase 0 overview

> **This is not the authoritative architecture.**
>
> The authoritative technical architecture is the Phase 0A package, and its entry point is
> [`docs/architecture/ARCHITECTURE_OVERVIEW.md`](architecture/ARCHITECTURE_OVERVIEW.md).
>
> This file is the original Phase 0 product-level sketch. It is kept because it records the
> approved stack, the entity inventory and the security baseline that the Phase 0A package was
> built to satisfy, and several ADRs cite it. **Where this file and the Phase 0A package
> differ, the Phase 0A package wins** — it is more specific and it resolves questions this
> sketch left open (`prisma/ or database/`, the exact role of Redis, what "offline" means).
>
> Do not add new architecture decisions here. They belong in
> [`docs/architecture/`](architecture/) with an ADR.

## Objective

Build a maintainable browser game first. Optimize only after profiling.

## Proposed starting stack

### Frontend
- Next.js
- React
- TypeScript

### Backend
- NestJS
- TypeScript

### Persistence
- PostgreSQL

### Cache / jobs
- Redis

### ORM / migrations
- Prisma

### Runtime
- Docker Compose for local development

### Realtime
- WebSocket or SSE only where needed

## Monorepo target

```text
/
├─ apps/
│  ├─ web/
│  └─ api/
├─ packages/
│  ├─ shared/
│  ├─ game-data/
│  └─ game-engine/
├─ prisma/ or database/
├─ docs/
├─ AGENTS.md
└─ docker-compose.yml
```

Exact workspace tooling can be chosen during Phase 0.

## Responsibility boundaries

### apps/web
Responsible for:
- map UI;
- inventory;
- character screens;
- party UI;
- hunt/dungeon screens;
- market UI;
- progress visualization.

Never authoritative for game outcomes.

### apps/api
Responsible for:
- authentication;
- authorization;
- character actions;
- activity lifecycle;
- persistence;
- economy transactions;
- market;
- service APIs.

### packages/game-data
Static/data-driven definitions:
- creatures;
- BaseItems;
- affix definitions;
- hunts;
- rooms;
- quests;
- bosses;
- vocation data;
- progression tables.

### packages/game-engine
Pure or mostly-pure game rules:
- combat;
- loot;
- rarity;
- progression;
- supply consumption;
- activity simulation;
- offline Skill Training settlement.

Design this package so implementation language can change later without rewriting the whole application.

## Server-authoritative rule

The server owns:

- combat outcomes;
- RNG;
- loot;
- item rarity;
- affixes;
- Forge;
- XP;
- skills;
- currencies;
- market transfer;
- unlock state.

The client only submits intents and displays results.

## Simulation interface

A stable contract should exist, conceptually similar to:

```ts
simulateActivity(
  state,
  elapsedTime,
  commands
): SimulationResult
```

or a tick-based equivalent.

Do not bind the rest of the application directly to TypeScript-specific combat internals.

## Online activity and session lifecycle

Hunt and Dungeon simulation is **online-only**. The server advances an activity only while it
considers that session connected.

- the server tracks connection liveness for each active session through a heartbeat or
  equivalent mechanism; the exact mechanism and interval belong to the implementation
  specification, not to this document;
- a backgrounded or minimized client keeps progressing while its connection stays alive;
- an unexpected disconnect moves the activity to a paused reconnect-grace state for
  **5 minutes**;
- nothing is simulated while paused - no combat, XP, loot, gold, room progression or supply
  consumption;
- reconnecting within the grace period restores the preserved active-session state and resumes
  simulation from it;
- when the grace period times out, the activity is terminated;
- explicit logout or manual exit bypasses the grace period and ends the activity immediately.

Conceptually:

```text
ONLINE_ACTIVE
→ RECONNECT_GRACE_PAUSED
→ ONLINE_ACTIVE            (reconnect within 5 minutes)

ONLINE_ACTIVE
→ RECONNECT_GRACE_PAUSED
→ ACTIVITY_ENDED           (grace period expires)
```

Offline computation is reserved for one case only: settling dedicated Skill Training
(Exercise Weapon + Training Dummy) progress. There is no offline combat simulation and no
offline batching of Hunt or Dungeon progression.

## Jobs

Redis-backed workers can manage:

- long-running online hunts;
- offline Skill Training settlement;
- boss rotations;
- timers;
- scheduled activity;
- market maintenance;
- notifications.

## Database design principles

Use immutable/stable IDs.

Important entities:

- Account
- Entitlement
- Character
- CharacterSkill
- CharacterWheel
- CharacterSkillTree
- BaseItem
- ItemInstance
- ItemAffix
- ItemImbuement
- Inventory
- Equipment
- CreatureDefinition
- Hunt
- HuntRoom
- WorldLocation
- LootTable
- Quest
- Dungeon
- Boss
- Activity
- MarketListing
- CurrencyLedger
- TransactionLog

## Economy integrity

Never mutate balances casually.

Use:
- transactions;
- idempotency;
- escrow;
- ledgers;
- unique operation IDs;
- audit logs.

Critical actions:
- trade;
- Forge;
- purchase;
- listing;
- currency exchange;
- reward grant.

## RNG

Authoritative RNG is server-side.

For debugging/high-value economy events, retain enough metadata to diagnose:
- what table was rolled;
- result;
- item instance produced;
- operation ID.

## Performance strategy

Do not start in C++/WASM.

Start in the simplest maintainable architecture.

Only move hot simulation paths to:
- Go;
- Rust;
- C++;
- native service

after profiling demonstrates a real need.

WASM may be useful for client-side previews/tools, but never as economic authority.

## Security baseline

Design from day one for:
- no item duplication;
- no currency double-spend;
- no client-trusted reward;
- transactional Forge;
- transactional Market;
- rate limiting;
- authorization on every character/account mutation.
