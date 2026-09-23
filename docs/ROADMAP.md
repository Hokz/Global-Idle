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

## Phase 0B — Technical Foundation — `VERIFIED`

**Specification:**
[`docs/specs/phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md`](specs/phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md)
— **`VERIFIED`**. Implemented, independently reviewed, and accepted by the Product Owner on
2026-09-21. Evidence:
[`docs/specs/phase-0b/PHASE_0B_FOUNDATION_REVIEW.md`](specs/phase-0b/PHASE_0B_FOUNDATION_REVIEW.md)
— 92/92 contractual matrix, 116 tests, both CI jobs green, `pnpm dev` verified end to end.

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

## Phase 1 — Character + World Map — `IMPLEMENTATION_SPEC_READY`

**Specification:**
[`docs/specs/phase-1/PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md`](specs/phase-1/PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md)
— **`IMPLEMENTATION_SPEC_READY`**, accepted by the Product Owner after independent review on
2026-09-21. Implementation follows on its own branch and pull request.

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

## Phase 2 — Hunt Simulation — `VERIFIED`

**Specification:**
[`docs/specs/phase-2/PHASE_2_HUNT_SIMULATOR_SPEC.md`](specs/phase-2/PHASE_2_HUNT_SIMULATOR_SPEC.md)
— **`VERIFIED`**. Implemented, independently reviewed, and accepted by the Product Owner on
2026-09-22 at head `03058b5`. Evidence:
[`PHASE_2_IMPLEMENTATION_NOTES.md`](specs/phase-2/PHASE_2_IMPLEMENTATION_NOTES.md) and
[`PHASE_2_CANARY_SOURCE_MAP.md`](specs/phase-2/PHASE_2_CANARY_SOURCE_MAP.md) — 106/106 contractual
matrix, 299 tests across 33 files, 36 Playwright cases on desktop and touch, 17 migration
assertions, CI run #29 green on all three jobs, and `pnpm dev` verified end to end. No Phase 2
blockers remain.

The functional evidence includes an INSTRUMENTED browser walkthrough — a script drove a real
browser and recorded the console, page errors and every response status. A human aesthetic review
of the layout is not claimed and was not part of this acceptance.

- room system;
- rooms 1-10;
- room-10 infinite loop;
- monster encounters;
- supplies;
- death — and what it COSTS: Base XP by Canary's own formula, and the whole Gold Pouch without
  Full Bless;
- XP;
- gold, into a **Gold Pouch** that is carried and at risk — the Bank is a different, safe number
  ([ADR-019](architecture/decisions/ADR-019-currency-custody-scopes.md));
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

## Phase 3 — Loot + Itemization + Inventory/Logistics

> Status lives in [`PROJECT_STATE.json`](./PROJECT_STATE.json), not here.

**Specification:**
[`docs/specs/phase-3/PHASE_3_ITEMIZATION_INVENTORY_LOGISTICS_SPEC.md`](specs/phase-3/PHASE_3_ITEMIZATION_INVENTORY_LOGISTICS_SPEC.md)
— `IMPLEMENTATION_SPEC_READY`. Implementation is on its own branch and pull
request, stacked on Phase 2, with status
`IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`.


- loot tables;
- BaseItem;
- ItemInstance;
- Common -> Stellar;
- affix generation;
- inventory;
- equipment;
- weight, stacking and `maxStack`;
- the five Character Hunt container slots, and their Gold unlocks;
- container space;
- Loot Pouch, and the physical Loot-Pouch death loss;
- Loot Filter;
- Depot;
- Stash;
- item movement, desktop and touch;
- Manage Containers routing;
- sell loop;
- basic NPC purchase and refill.

Recorded in full: [`design/INVENTORY_AND_LOGISTICS_FOUNDATION.md`](design/INVENTORY_AND_LOGISTICS_FOUNDATION.md).

## Phase 3.5 — Tile / spatial Game Window

> Status lives in [`PROJECT_STATE.json`](./PROJECT_STATE.json), not here.

**Specification:**
[`docs/specs/phase-3-5/PHASE_3_5_TILE_SPATIAL_GAME_WINDOW_SPEC.md`](specs/phase-3-5/PHASE_3_5_TILE_SPATIAL_GAME_WINDOW_SPEC.md).
Implementation is on its own branch, stacked on Phase 3.

The Hunt stops being an abstraction and becomes a PLACE. The minimum
authoritative spatial engine the next playable slice needs, and no more:

- maps as validated, compiled CONTENT — never rows in PostgreSQL;
- tiles, walls and collision, with two actors never on one square;
- deterministic four-direction A* to a goal set, with no randomness at all;
- combat gated on adjacency, and a target rule that fights what it can reach;
- rooms 1–10 as ten physical chambers joined by one-tile doorways;
- a Canvas game window that is a CAMERA — it draws the server's answer and
  decides nothing;
- `POST` advances the run, `GET` reads it, and a monotonic revision means a
  late snapshot can never rewind the world on screen;
- a developer-only debug overlay, off unless a build asks for it.

Not in this phase: player-driven movement, diagonals, line of sight, ranged
attacks, multi-floor play, a map editor.

## Phase 3.6 — Movement fidelity: Character speed and tile ground speed

> Status lives in [`PROJECT_STATE.json`](./PROJECT_STATE.json), not here.

**Specification:**
[`docs/specs/phase-3-6/PHASE_3_6_MOVEMENT_FIDELITY_SPEC.md`](specs/phase-3-6/PHASE_3_6_MOVEMENT_FIDELITY_SPEC.md).
Implementation is on its own branch, stacked on Phase 3.5.

A step stops costing a constant. How long it takes now depends on WHO is walking and on WHAT they
are standing on — which is the difference between an animation detail and an economy:

    travel time -> combat uptime -> kills/hour -> XP, Gold and loot per hour

- a Character's step speed is `110 + (level - 1)`, the source's own progression, with no invented
  vocation differences because the source has none;
- a tile's ground speed is authored content, an integer, and LOWER means faster;
- the step is timed by the tile the actor DEPARTS from, as the source times it;
- the 50 ms staircase is the whole of what "bugging speed" means: plateaus where more speed buys
  nothing, breakpoints where it buys a whole beat, and a floor of one beat where it stops buying;
- measured: the same Character finishes twice the encounters on fast ground in the same time;
- and the imported arithmetic carries its own limits: a step longer than the 65,535 ms the source
  can represent is **refused** — when the map compiles, and again when a Hunt's own creatures are
  matched to its own map, so content that cannot be simulated is caught before an Activity starts
  rather than by the simulator halfway through one.

Not in this phase: haste, paralyze, equipment speed, mounts, conditions of any kind, a
travel-time-optimised pathfinder, and any ingestion of real client assets. The shipped map keeps
the default ground, because its tiles have no sourced metadata yet.

## Phase 3.7 — First real asset visual slice

**SPECIFIED — NOT IMPLEMENTED.** Its specification is
[`docs/specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md`](specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md),
pending independent review. No source assets are in the repository, and none will be: user-supplied
client graphics are a PRIVATE reference, the public build ships distributable placeholders, and the
three surfaces are deliberately distinct — a macro Atlas over a raster, a Rookgaard city overlay,
and ORIGINAL compact hunt arenas that do not reconstruct Tibia's dungeons.

After movement fidelity, the next milestone is to make the game LOOK like the thing it is meant to
be, before Party work widens the scope again: one origin Character outfit with walking frames, a
Rat, real floor and wall tiles, a small Rookgaard visual reference slice rendered in the verified
15 × 11 window, and the beginning of a Tibia-like shell around it — Game Window centred, system
panels at the sides, Chat and Server Log below.

## Phase 4 — Skills + Party + Vocations

- real Skills representation, and **durable Skill death loss** (deferred from Phase 2 on purpose:
  inventing a Skill so that death could delete it would have been a shadow system);
- vocation Capacity from the baseline;
- aggregated Party logistics;
- Promotion acquisition, if this is the natural owning slice.

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

- the Requirement / Cost / Reward primitive, built when the first content slice actually needs it;
- Reward Chest — persistent, and SAFE from Hunt death;
- blessing acquisition and reacquisition, if this is the natural owning slice;
- travel and access foundations;
- generic dungeon rooms;
- basic puzzles;
- unlock framework;
- first-completion rules;
- bosses;
- daily limit;
- boss rotation.

## Phase 5B — Multiplayer Activities

- cross-account Expeditions and Warzones;
- PvP Arena, matchmaking, rating and ranking.

Recorded in full: [`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md).
Nothing here is built early; the only architectural obligation is not to make Team A vs Team B
impossible.

## Phase 6 — Economy

- full Bank services and history;
- player-to-player transfer;
- Market, escrow, fees and price history.

Recorded in full: [`design/ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md`](design/ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md).

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

### Phase 7A — Advanced Progression

- **Bestiary and Charms** — kill counters, Bestiary entries, Charm Points, Charm Runes, and the
  multi-stage Charm progression. Owned HERE, not by Phase 9: it is a progression system with its
  own counters and unlocks, and the content that feeds it is a consumer rather than its owner;
- outfits and achievements.

Recorded in full: [`design/FUTURE_DIRECTIONS.md`](design/FUTURE_DIRECTIONS.md) §3.

## Phase 8 — Premium

- Auto-Sell, with item / category / rarity / default rules and protected-state overrides;
- advanced loot management;
- approved remote services.

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

- **world and regional progression rollout** — regional objectives and tasks, progression points,
  and the region-by-region gating they unlock. Owned HERE because it is the ROLLOUT of content
  across regions; the requirement/cost/reward primitive it leans on is Phase 5's;
- more regions;
- more hunts;
- more items;
- more quests;
- more bosses;
- more puzzles;
- endgame.

Recorded in full: [`design/FUTURE_DIRECTIONS.md`](design/FUTURE_DIRECTIONS.md) §1.

## Phase 10 — Scale / Hardening

- telemetry;
- economy balance;
- load tests;
- profiling;
- anti-abuse;
- backup/recovery;
- customer-support tooling;
- selective performance rewrites if necessary.
