# Roadmap

## Phase 0A — Architecture — `ARCHITECTURE_APPROVED`

Goal: convert approved design into an explicit technical architecture.

Entry point: [`docs/architecture/ARCHITECTURE_OVERVIEW.md`](architecture/ARCHITECTURE_OVERVIEW.md).
All 18 ADRs are `ACCEPTED` — `ADR-001`–`ADR-017` from Phase 0A, and `ADR-018` with the Phase 0B specification.

Documented, not implemented:
- Character activity occupancy;
- per-Character Stamina ownership;
- Premium account-wide entitlement boundary;
- the Stamina consuming / neutral / recovering state model;
- reward eligibility at zero Stamina;
- the active-use timer abstraction;
- durable timer and persistence principles;
- `ItemImbuement` timer ownership;
- Party mixed-Stamina behaviour;
- server-authoritative time.

## Phase 0B — Technical Foundation

**Specification:**
[`docs/specs/phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md`](specs/phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md)
— **`IMPLEMENTATION_SPEC_READY`**, approved by the Product Owner after independent review.
Implementation follows on its own branch and pull request.

Goal: prepare the project so implementation does not begin on ambiguous foundations.

Build the reusable foundation, **not** the Hunt balance loop:
- Character activity-occupancy primitive and constraint;
- Stamina durable state representation;
- generic `ActiveUseTimer` / duration state contract;
- Account entitlement / Premium state contract;
- server-authoritative time service interface;
- idempotent duration-settlement utility;
- transaction and checkpoint integration;
- concurrency constraints;
- test fixtures for time progression;
- persistence and migration support;
- package boundaries.

Deliverables:
- documentation baseline;
- monorepo;
- web/API skeleton;
- PostgreSQL;
- Redis;
- ORM/migrations;
- Docker Compose;
- CI;
- shared types;
- game-data package;
- game-engine package;
- initial entities;
- simulation contract.

No full gameplay yet.

## Phase 1 — Character + World Map

- account;
- character creation;
- one vocation;
- basic stats;
- Character Stamina value and state in the server model and API contract;
- Premium entitlement state on the Account model;
- a UI surface for Stamina on the character panel (store/payment flow not required yet);
- surface-map shell;
- one region;
- hunt marker;
- activity selection.

## Phase 2 — Hunt Simulation

- room system;
- rooms 1-10;
- room-10 infinite loop;
- monster encounters;
- supplies;
- death;
- XP;
- gold;
- server-side activity state, persisted across reloads and the grace period;
- connection/session lifecycle;
- background/minimized online continuity;
- 5-minute reconnect grace.

### Hunt Stamina behaviour

- first-qualifying-XP activation;
- `ONLINE_ACTIVE` consumption, including time between kills;
- immediate pause on reconnect grace;
- stop on Hunt end or leave;
- per-Character consumption in a Party;
- 42:00 cap;
- Premium 42:00→39:00 at 1.5× Hunt Base XP, 39:00→0 normal;
- Free normal XP throughout;
- zero-Stamina reward ineligibility across XP, skill progress, gold and loot;
- zero Stamina does not force a Hunt exit;
- mixed-Stamina Party behaviour, with exhausted members excluded from reward allocation;
- recovery settlement for non-hunting Characters, Premium 1:1 and Free 1:2;
- restart, retry and checkpoint correctness.

At least one timer path should exercise the reusable `ActiveUseTimer` foundation here.

Mandatory tests: cases 1–28 in
[`docs/architecture/ACTIVITY_OCCUPANCY_AND_TIMERS.md`](architecture/ACTIVITY_OCCUPANCY_AND_TIMERS.md) §7.

## Phase 3 — Loot + Itemization

- loot tables;
- BaseItem;
- ItemInstance;
- Common -> Stellar;
- affix generation;
- inventory;
- equipment;
- sell loop.

## Phase 4 — Skills + Party + Vocations

- final skill progression model;
- character roster with unique vocations;
- Gold-based character/roster unlocks;
- Active Party formation (1-4);
- Party positioning / Frontline;
- Shared XP eligibility;
- role logic;
- all five vocation identities;
- configurable combat behavior;
- dedicated offline Skill Training settlement;
- occupancy integration: the same Character cannot Hunt and Skill Train, different Characters
  can do both concurrently;
- Dummy / Exercise Weapon training recovers Stamina;
- offline Skill Training and offline Stamina recovery settle correctly together;
- no Base XP from dedicated Skill Training;
- Party/Shared XP reward eligibility stays a separate predicate from Stamina eligibility.

## Phase 5 — Quest/Dungeon/Boss Framework

- generic dungeon rooms;
- basic puzzles;
- unlock framework;
- first-completion rules;
- bosses;
- daily limit;
- boss rotation.

## Phase 6 — Economy

- gold sinks;
- market;
- escrow;
- fees;
- price history;
- premium-currency market;
- transaction ledger;
- anti-duplication tests.

## Phase 7 — Forge / Imbuement / Wheel / Skill Tree

- Forge target + sacrifices;
- Tier 0-10;
- rarity/classification validation;
- Imbuements: **Powerful only**, 12h **active-use** duration, remaining duration on the item,
  no burn while unequipped, inactive or paused, transaction-safe apply/remove/consume, UI
  remaining-time display, and tests across restart, re-equip and reconnect (cases 29–38);
- the boss-progression unlock gate for Powerful Imbuements;
- quest unlocks;
- Wheel;
- gems;
- vocation Skill Tree.

## Phase 8 — Premium

- Premium purchase, renewal and expiry;
- entitlement transitions, segmenting any unsettled interval at the transition;
- the Stamina benefits Phase 2 already consumes (Premium XP band and 1:1 recovery);
- future boost products must use `ActiveUseTimer`, never an ad-hoc wall-clock countdown;
- Party-management convenience benefits (still to be designed; no fifth active Party slot);
- automation;
- remote services;
- loot automation;
- boss automation;
- analytics;
- final Free/Premium balance.

## Phase 9 — Content Expansion

- more regions;
- more hunts;
- more items;
- more quests;
- more bosses;
- more puzzles;
- endgame.

## Phase 10 — Scale / Hardening

- telemetry;
- economy balance;
- load tests;
- profiling;
- anti-abuse;
- backup/recovery;
- customer-support tooling;
- selective performance rewrites if necessary.
