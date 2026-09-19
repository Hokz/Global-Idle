# Technical Architecture

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
- offline catch-up.

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

## Online vs offline

Both must use the same core rules.

Avoid having:
- one algorithm while browser is open;
- a mathematically unrelated algorithm offline.

Optimized offline batching may be introduced later, but results must remain acceptably equivalent.

## Jobs

Redis-backed workers can manage:

- long-running hunts;
- offline catch-up;
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
