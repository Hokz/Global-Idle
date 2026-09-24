# Master Development Roadmap

## 1. Product definition

Global Idle is a **100% browser-based idle strategy RPG**.

The player manages characters, parties, equipment, resources and progression while navigating an interactive world map.

Combat is automated and simulated by the server.

The game should feel like managing an RPG world, not selecting anonymous numbered stages.

## 2. Core loop

```text
WORLD MAP
→ choose hunt / dungeon / boss / service
→ configure character or party
→ configure supplies / build / equipment
→ server simulation
→ XP + gold + loot
→ evaluate/equip/sell items
→ Forge / Imbuement / progression
→ unlock harder content
→ return to world map
```

## 3. Hunts

Hunts are endless idle loops.

### Structure

- entering a hunt opens a themed combat map;
- characters visually move through encounter boxes/rooms;
- rooms 1-10 progressively increase difficulty;
- room 10 is the stable end-loop;
- after clearing room 10, the party repeats room 10 indefinitely;
- the hunt ends when:
  - the party/character dies;
  - the player exits;
  - a configured stop condition triggers.

### Supplies and Loot Capacity

By default, neither state ends the hunt:

- supply exhaustion only warns the player and raises the risk of death;
- full Loot Capacity stops further loot collection, but combat continues;
- player-configured automation may use either state as a stop condition.

### Hunt information

A hunt can show:

- recommended level;
- creature pool;
- elemental weaknesses;
- expected XP/h;
- expected gold/h;
- possible loot;
- supply consumption;
- risk/death estimate.

## 4. Death

Death must matter. As of the Phase 2 correction pass this is no longer a direction — the formula
is the baseline's, transcribed, and it is implemented and tested.

**Experience and skills** follow `Player::getLostPercent()`
([source map §8](specs/phase-2/PHASE_2_CANARY_SOURCE_MAP.md)):

- seven regular blessings, 8 percentage points each;
- Promotion adds 30 points;
- **below level 24** the base loss is a flat 10% AND any blessing reduction of 40% or more is
  replaced by a flat 50% — so full blessings plus Promotion is 80% off there, not 86%;
- **from level 24** the loss follows the fractional level, and 86% is real;
- the loss is rounded up, and the level walks down after it.

**Carried rewards** follow Global Idle's own binary rule
([custody baseline](design/ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md)):

- without Full Bless: the whole Gold Pouch, and later the whole ordinary Loot Pouch;
- with Full Bless: both kept in full;
- partial blessings reduce XP loss and protect nothing carried;
- equipment, the five Hunt containers, supplies, Depot, Stash and the Reward Chest are never
  touched by this rule.

Full Bless is not a free death: the experience loss still applies, the Hunt still ends, and
blessings must be reacquired — a recurring Gold sink by design.

Skill loss is specified and **deferred** to Phase 4, where a real Skill representation exists.

## 5. Skill progression

Character level and skill progression are separate systems.

Preferred direction:

- monsters/content generate a separate Skill XP resource;
- skill progression is not simply derived from character level;
- player choice should matter;
- vocation efficiency can influence costs or gains.

Final model still requires design validation.

## 6. Vocation roles

### Knight
Primary: Tank  
Secondary: Physical melee damage

- highest durability;
- aggro/control;
- health scaling;
- melee damage;
- defensive specialization.

### Druid
Primary: Support / healer  
Secondary: Elemental support damage

- healing;
- cleansing;
- buffs;
- sustain;
- damage below primary DPS vocations by design.

### Sorcerer
Primary: Elemental DPS  
Secondary: AoE/burst/control

- mastery emphasis: Death, Fire, Energy;
- access to Ice/Earth where appropriate;
- no Holy mastery;
- strongest pure magic-damage identity.

### Paladin
Primary: Ranged DPS  
Secondary: Holy damage

- physical ranged;
- Holy;
- comparable top-tier DPS to Sorcerer through a different profile;
- less tank-oriented than the source inspiration.

### Monk
Primary: Debuff / hybrid support  
Secondary: Mid-tier DPS / healing

- enemy debuffs;
- ally cleanse;
- support healing;
- damage above Knight/Druid, below Sorcerer/Paladin;
- intermediate HP/MP identity.

## 7. Parallel progression systems

### Wheel
- level-driven points;
- inspired by a large endgame Wheel system;
- socketable gems;
- important currency sink.

### Class Skill Tree
- separate from the Wheel;
- gold-funded upgrades;
- nodes can have multiple ranks;
- strengthens vocation identity;
- must not erase core class weaknesses.

## 8. Quests

Quests become dungeon-like content.

Early version:
- combat rooms;
- minibosses;
- basic lever/puzzle interactions;
- requirements;
- reward/unlock.

Long-term:
- more complex mechanics;
- at least one meaningful manual interaction/playthrough;
- content should feel like progression, not a checklist.

Quest completion can unlock:
- services;
- blessings;
- powerful Imbuements;
- boss access;
- travel;
- other systems.

## 9. Bosses

Bosses can require a one-time unlock dungeon.

Example flow:

```text
region
→ boss hall
→ 10 encounter rooms
→ first boss kill
→ permanent boss unlock
```

After unlock:
- boss becomes directly selectable;
- boss may enter auto-rotation;
- default target: up to 3 completions/day per boss;
- per-boss rules may override.

## 10. Equipment as central progression

Equipment is the main strategic depth layer.

The player should repeatedly decide whether an item should be:

- equipped;
- sold;
- forged;
- imbued;
- kept for another character;
- used as Forge material.

## 11. Rarity

Locked rarity ladder:

1. Common
2. Semi-Rare
3. Rare
4. Mystic
5. Legendary
6. Stellar

Use one base item definition plus generated item instances.

Do **not** create six static versions of every base item.

### Example

```text
BaseItem:
Dragon Shield

ItemInstance:
rarity = Mystic
affixes:
  +2 Shielding
  +3% Fire Resistance
  +70 HP
forgeTier = 0
imbuements = []
```

## 12. Loot

Creature loot starts from the intended creature loot identity.

Flow:

```text
kill
→ loot roll
→ base item selected
→ if equipment: rarity roll
→ affix roll
→ ItemInstance created
→ loot storage
```

Higher rarity must be exponentially rarer.

## 13. Forge

Forge is both:
- progression;
- an item sink;
- a market/liquidity driver.

Locked structural direction:

- target item is explicitly selected;
- target preserves rarity and affixes;
- target is not destroyed on failed upgrade attempts;
- two sacrifice items are consumed;
- target + sacrifices must match:
  - item Classification;
  - item Rarity;
- all eligible items can progress to Tier 10;
- higher Classification, Rarity and Tier should become harder/more expensive;
- costs can include:
  - gold;
  - dust;
  - exaltation cores;
  - other approved resources.

Exact formulas are open.

## 14. Imbuements

Imbuements are independent of rarity and Forge.

An ItemInstance can have:

```text
base item
+ rarity
+ affixes
+ forge tier
+ imbuements
```

Locked product rules:

- exactly **one** playable power tier: **Powerful**. Basic and Intricate are not player
  progression tiers;
- duration is **12 hours of active use**, not wall-clock expiry. Active-use timer semantics
  apply: nothing is consumed while the item is unequipped, the Character is inactive or offline,
  or the activity is paused in reconnect grace;
- remaining duration is durable state on the `ItemInstance` and **resumes** on re-equip rather
  than resetting;
- access requires completing **exactly five** configured boss completions of the approved
  quest/progression chain.

The *identities* of those five bosses remain open content design. The count does not.

## 15. World map

The primary navigation layer is a surface-world interactive map.

Player can:
- pan;
- zoom;
- filter;
- select activities.

Filters can include:
- level range;
- creatures;
- elemental weakness;
- hunt;
- dungeon;
- quest;
- boss;
- depot;
- refill;
- NPC/service.

The player generally does not manually walk the complete world tile-by-tile.

## 16. Free vs Premium

Premium should be highly valuable without making Free non-competitive.

Direction:

Party capacity is **not** a Premium lever. The account Character Roster holds up to five
unique-vocation characters, the Active Party holds at most four of them, and every roster slot
past the first is unlocked with in-game Gold by Free and Premium players alike. A fifth
simultaneous Active Party member does not exist. See
[`docs/design/party/PARTY_SYSTEM_FOUNDATION.md`](design/party/PARTY_SYSTEM_FOUNDATION.md).

### Free
- starts with the Origin Character;
- unlocks further roster characters with Gold (costs OPEN);
- navigates to services/NPCs;
- standard storage;
- standard automation.

### Premium
- advanced automation;
- remote selling/refill/services after appropriate content unlock;
- stronger loot management;
- advanced boss rotation;
- advanced analytics;
- larger storage/loot convenience;
- potentially a moderate XP convenience bonus after balance review.

Avoid exclusive endgame combat power as the main Premium value.

## 17. Market

Two market denominations are planned:

### Gold Market
Player-to-player market in gold.

### Premium Currency Market
Player-to-player market in premium currency.

Market principles:
- server-side escrow;
- atomic transaction;
- listing fees/taxes;
- price history;
- volume tracking;
- anti-duplication;
- audit log;
- no double-spend.

## 18. Technology direction

Initial recommendation:

- Frontend: Next.js + React + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- Cache/jobs: Redis
- ORM: Prisma
- Realtime: WebSocket/SSE where necessary
- Containers: Docker Compose
- Map: tile/canvas/WebGL layer as needed

Do not start with C++/WASM unless profiling proves it necessary.

## 19. Simulation principle

Server authoritative.

Initial simulator may use fixed ticks.

Example:

```text
tick
→ target selection
→ character actions
→ monster actions
→ damage/healing
→ statuses
→ death check
→ loot
→ supplies
→ room transition
```

### Online-only activity simulation

Activity simulation is online-only. The server advances a Hunt or Dungeon only while it
considers the session connected; a background or minimized client keeps progressing while its
connection stays alive.

An unexpected disconnect pauses the activity and preserves it for 5 minutes. Nothing
progresses while paused - no XP, gold, loot, room progression or supply consumption.
Reconnecting within the window resumes the same session; letting it expire terminates the
activity. Manual exit and explicit logout end it immediately, without grace.

Offline progression exists only for dedicated **Skill Training** (Exercise Weapon + Training
Dummy), which never grants Base XP. That settlement is the one computation allowed to run for
a disconnected character.

## 20. Production roadmap

### Phase 0A — Architecture — `ARCHITECTURE_APPROVED`
- the complete architecture package, entry point
  [`docs/architecture/ARCHITECTURE_OVERVIEW.md`](architecture/ARCHITECTURE_OVERVIEW.md);
- Character activity occupancy, per-Character Stamina, Premium account-wide entitlement,
  active-use timers, `ItemImbuement` timer ownership, Party mixed-Stamina behaviour,
  server-authoritative time.

### Phase 0B — Foundation — `VERIFIED`
- implementation specification:
  [`docs/specs/phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md`](specs/phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md)
  (**`VERIFIED`** — implemented, independently reviewed, accepted 2026-09-21; evidence in
  [`PHASE_0B_FOUNDATION_REVIEW.md`](specs/phase-0b/PHASE_0B_FOUNDATION_REVIEW.md));
- documentation;
- architecture;
- Character occupancy primitive; Stamina durable state; generic `ActiveUseTimer` contract;
  Account entitlement contract; server time service; idempotent duration settlement;
- repository structure;
- web/API/database/Redis skeleton;
- data model;
- simulation contract;
- CI.

### Phase 1 — World/character vertical slice
- implementation specification:
  [`docs/specs/phase-1/PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md`](specs/phase-1/PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md)
  (**`IMPLEMENTATION_SPEC_READY`** — accepted after independent review, 2026-09-21);
- account;
- character;
- vocation;
- map shell;
- one region;
- one hunt entry.

### Phase 2 — Hunt simulator — `VERIFIED`
- implementation specification:
  [`docs/specs/phase-2/PHASE_2_HUNT_SIMULATOR_SPEC.md`](specs/phase-2/PHASE_2_HUNT_SIMULATOR_SPEC.md)
  (**`VERIFIED`** — implemented, independently reviewed, accepted 2026-09-22 at head `03058b5`;
  106/106, 299 tests, 36 E2E, 17 migration assertions, CI #29 green, `pnpm dev` green);
- Hunt Stamina: first-qualifying-XP activation, `ONLINE_ACTIVE` consumption, pause on grace,
  42:00 cap, Premium 42→39 at 1.5× XP, zero-Stamina reward ineligibility without forced exit,
  per-Character behaviour in a Party, Premium 1:1 / Free 1:2 recovery;
- room 1-10;
- room 10 endless loop;
- supplies;
- death;
- XP/gold;
- session persistence, connection lifecycle and the 5-minute reconnect grace.

### Phase 3 — Itemization

> Status lives in [`PROJECT_STATE.json`](./PROJECT_STATE.json), not here.
- implementation specification:
  [`docs/specs/phase-3/PHASE_3_ITEMIZATION_INVENTORY_LOGISTICS_SPEC.md`](specs/phase-3/PHASE_3_ITEMIZATION_INVENTORY_LOGISTICS_SPEC.md);
- BaseItem;
- ItemInstance;
- rarity;
- affixes;
- equipment;
- loot storage.

### Phase 3.5 — Tile / spatial Game Window

> Status lives in [`PROJECT_STATE.json`](./PROJECT_STATE.json), not here.
- implementation specification:
  [`docs/specs/phase-3-5/PHASE_3_5_TILE_SPATIAL_GAME_WINDOW_SPEC.md`](specs/phase-3-5/PHASE_3_5_TILE_SPATIAL_GAME_WINDOW_SPEC.md);
- maps as validated content;
- tiles, collision and occupancy;
- deterministic pathfinding;
- adjacency-gated combat;
- rooms as physical chambers;
- a Canvas game window that renders and decides nothing.

### Phase 3.6 — Movement fidelity: Character speed and tile ground speed

> Status lives in [`PROJECT_STATE.json`](./PROJECT_STATE.json), not here.
- implementation specification:
  [`docs/specs/phase-3-6/PHASE_3_6_MOVEMENT_FIDELITY_SPEC.md`](specs/phase-3-6/PHASE_3_6_MOVEMENT_FIDELITY_SPEC.md);
- a Character's step speed is `110 + (level - 1)`, the source's own progression;
- a tile's ground speed is authored content, and the step is timed by the tile it LEAVES;
- the 50 ms staircase — plateaus, breakpoints, and a one-beat floor — from the source's arithmetic;
- movement-heavy Hunt throughput changes with level and with terrain;
- the pathfinder stays independent of ground speed, exactly as the source's does;
- the supported movement domain is stated and enforced: the source caches and returns a step
  duration as a `uint16_t`, so beyond 65,535 ms Global Idle refuses rather than clamping or
  reproducing the C++ overflow — and a Hunt whose own creatures cannot walk its own map is refused
  when its plan is built, never discovered mid-settlement.

### Phase 3.7 — First real asset visual slice

> Status lives in [`PROJECT_STATE.json`](./PROJECT_STATE.json), not here.
> Specification:
> [`docs/specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md`](specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md).
> No source assets are in the repository and none will be.

- finish the visual slice and take it through independent review;
- the navigation hierarchy, recorded in
  [`design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`](design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md):

  ```text
  WORLD ATLAS → REGIONAL MINI-ATLAS → LOCAL FOCUS (city / subarea) → PLAYABLE HUNT / QUEST
  ```

- one rookie/origin Character outfit, a Rat, floor/wall/decoration tiles, and a small Rookgaard
  visual reference slice, rendered in the verified 15 × 11 Game Window;
- the shell evolves toward a client-like grammar: Game Window centred, system panels at the
  sides, Chat and Server Log below;
- **DEFERRED:** accurate geographic polygons, raster calibration, and the golden region
  border/glow. The architecture must **accept region boundaries later** as data separate from
  raster pixels; until a calibrated polygon exists, an uncalibrated pin renders `demo` and no
  coordinate is invented.

Phase 3.6 leaves the data shape ready: a tile definition already carries a kind and a ground
speed, so the importer adds visual identity without the movement engine changing again.

### PRE-PHASE-4 GATE

Full text: [`PHASE_GATES.md`](PHASE_GATES.md) § *Pre-Phase-4*.

- **character retirement integrity** — consistent filtering on every read path, roster and
  vocation invariants, and `ADR-007`'s **item** recovery scope. The retired Character's **Gold
  Pouch has no stated fate**: that is an open PRE-4 product decision, not an extension of the item
  rule;
- **enforce the `baseXp` → `baseLevel` projection** — `baseXp` is already the durable truth and
  `baseLevel` its stored projection (schema + `progression.ts`). The gate proves and enforces that
  contract on every write path, migration and rollback; it does not choose again;
- **an Actor/Participant combat contract** that supports up to 4 same-account actors now and
  participants from several accounts later. Compatibility adapters keep previously VERIFIED Hunt
  behaviour and fixtures intact. **Do not implement a generic multiplayer platform yet.**

### Phase 4 — Party / vocations

- base Skills, training, and death loss;
- all five vocations and their identities;
- occupancy integration with dedicated Skill Training, and Stamina recovery while training;
- character roster (5) and Gold-based unlocks; **Active Party formation (1-4)** and Frontline;
- Shared XP eligibility;
- **tactical policy primitives** — target selection, healing, supply use, risk/retreat, role.
  These are the player's *strategy*, not their reflexes, and they are baseline gameplay;
- **a one-account Party is NOT a co-op group.** Do not entangle combat actor identity with the
  account id or with one hard-coded Character;
- server authority, deterministic replay, pinned content and transactional settlement are
  retained unchanged.

Recorded in full: [`design/party/PARTY_SYSTEM_FOUNDATION.md`](design/party/PARTY_SYSTEM_FOUNDATION.md).

### Phase 5 — Quest / dungeon / boss framework

The **generic** engine. Solo and one-account Party only; no networking, no lobby.

- dungeon rooms, objectives, rewards and mechanically configurable encounters;
- **pure, versioned, data-driven mechanics**: triggers, guards, assignments and roles,
  priorities, ordered steps, success and failure conditions, quest items collected and used, and
  optional conditional fallback strategies;
- the same definitions must work solo and with a one-account Party;
- **no boss implemented as bespoke code**, and **no lobby in Phase 5**;
- the Requirement / Cost / Reward primitive, built when the first content slice needs it;
- Reward Chest — persistent and safe from Hunt death — and blessing acquisition, where this is
  the natural owning slice;
- travel and access foundations; unlock framework; first-completion rules; boss daily limits and
  rotation.

The cooperative layer that later drives this engine:
[`design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md).

### PRE-5B GATE

Full text: [`PHASE_GATES.md`](PHASE_GATES.md) § *Pre-5B*.

Multi-account membership invariants; **cross-account disconnect decided and tested separately**
from one-account Party behaviour; reward ledger safety across accounts.

### Phase 5B — Multiplayer activities

Three slices, in order. Recorded in
[`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md) and
[`design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md).

#### Slice 1 — social and multi-account infrastructure

- friends and invitations; chat; lobby; readiness; membership;
- per-character occupancy across accounts; one shared run identity; liveness rules;
- reward ledger safety; spectator-only reads;
- **do not re-label a personal Party as a large Party**; cross-account disconnect behaviour is
  decided separately, and one player's disconnect must not automatically pause everybody without
  a separately approved rule.

#### Slice 2 — the first cooperative complex quest

Up to **five human players, one selected Character per account**.

- a pre-room lobby exposing the encounter mechanic checklist and role slots;
- players collectively author a **conditional strategy** — when to change targets, who collects
  an item, where and when it is used, an alternate assignee if the primary cannot act;
- all ready → plan validated and **frozen** → server-authoritative simulation → everyone watches
  the **same** run. **No runtime input bypasses the frozen plan;**
- a dead character immediately stops participating and exits the fight; that human may leave or
  keep watching as a **spectator**, who cannot act, claim combat occupancy or influence RNG;
- **OPEN:** whether death grants rewards, and whether revival exists. Do not invent either.

#### Slice 3 — Warzones

- large public activities on the same multi-account infrastructure;
- tentative target **~25 minimum to ~50 maximum entrants — TUNABLE and TO BE BENCHMARKED**, not a
  locked balance parameter;
- shared objectives with sectors or subgroups, not fifty independent agents in one small arena;
- stress-test simulation cost, fairness and per-account settlement before launch.

**PvP Arena, matchmaking and ranking** stay a later, post-combat-balance milestone. The early
obligation is only neutrality of the Actor / Target / Side concepts.

### Phase 6 — Economy

- Bank services and history; player-to-player transfer; Market, escrow, fees, price history;
- gold sinks; premium-currency market; transaction ledger; anti-duplication tests; audit.

**Ordering note:** the *minimum* multi-account reward and penalty settlement is a **Phase 5B
prerequisite**, proven before the first shared quest — it does not wait for the full Market.
Definition versioning and rarity/affix validation are gates before market, forge or imbuement:
[`PHASE_GATES.md`](PHASE_GATES.md) § *Pre-market*.

Recorded in full: [`design/ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md`](design/ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md).

### Phase 7 — Forge / Imbuement / Wheel / Skill Tree

- Forge target and sacrifices, Tier 0-10, classification and rarity validation;
- Imbuements: **Powerful only**, 12h **active-use** duration on the item, boss-progression unlock
  gate, transaction-safe apply/remove/consume;
- quest unlocks; Wheel; gems; vocation Skill Tree; item sinks.

Combat must accept **stable modifier interfaces** before these subsystems are implemented, so a
new modifier source is configuration rather than a combat rewrite.

### Phase 7A — Advanced progression

- **Bestiary and Charms** — kill counters, Bestiary entries, Charm Points, Charm Runes and the
  multi-stage Charm progression. Owned here, not by Phase 9: it is a progression system with its
  own counters and unlocks, and content that feeds it is a consumer rather than its owner;
- outfits and achievements.

Recorded in full: [`design/FUTURE_DIRECTIONS.md`](design/FUTURE_DIRECTIONS.md) §3.

### Phase 8 — Premium / automation

- Premium purchase, renewal, expiry and entitlement transitions, splitting any unsettled interval
  at the transition;
- the Stamina benefits Phase 2 already consumes; future boost products use `ActiveUseTimer`,
  never wall-clock countdowns;
- advanced Auto-Sell with item / category / rarity / default rules and protected-state overrides;
- automation, remote services, loot and boss automation, analytics, final Free/Premium balance;
- Party-management convenience benefits (OPEN — no fifth active Party slot).

**Not paywalled:** foundational tactical strategy (Phase 4) and the quest mechanic checklist and
plan authoring (Phases 5 / 5B) are **baseline gameplay**.

### Phase 9 — Content expansion

- **world and regional progression rollout** — regional objectives and tasks, progression points,
  and the region-by-region gating they unlock. Owned here because it is the ROLLOUT; the
  requirement/cost/reward primitive it leans on is Phase 5's;
- more regions, hunts, items, quests, bosses and puzzles; quest lines; endgame; telemetry;
  economy rebalance;
- **VERIFIED Atlas calibration and region polygons**, and the region-wide gold hover/selection
  highlight, once actual map geometry is available. **Do not fabricate borders or map
  coordinates** —
  [`design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`](design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md) §5.

Recorded in full: [`design/FUTURE_DIRECTIONS.md`](design/FUTURE_DIRECTIONS.md) §1.

### Phase 10 — Scale / hardening

- whole-system load profiling; backup and restore rehearsal; retention and compaction;
- anti-abuse at real traffic; customer-support tooling; selective performance rewrites if
  profiling proves them necessary.

> **Security, retry/idempotency, economy correctness and realistic load tests MUST occur at the
> phase that introduces their risk — never all postponed to Phase 10.**
> [`PHASE_GATES.md`](PHASE_GATES.md) § *Pre-launch*.

### Operational gate

Do not endlessly stack open pull requests. Integrate accepted PRs in order, with the Product
Owner's authorization, and verify CI on the **actual integration base**. Every `VERIFIED` status
applies to a **named reviewed commit**, never to an evolving head.

## 21. Working philosophy

Build the smallest complete loop first.

Do not import the entire world before proving:

```text
character
→ map
→ hunt
→ combat
→ loot
→ equipment decision
→ sell
→ stronger character
```

That loop is the foundation of the product.

## 22. Detailed design documents

This roadmap stays at product level. Detailed, domain-specific game design lives under
`docs/design/`, indexed by:

- [`docs/DESIGN_INDEX.md`](DESIGN_INDEX.md) — navigation page and status lifecycle for all design documents.

Current detailed design documents:

- [`docs/design/tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md`](design/tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md) — Level 1–8 Rookgaard onboarding through vocation selection.
- [`docs/design/combat/COMBAT_LEVEL_SKILLS_FOUNDATION.md`](design/combat/COMBAT_LEVEL_SKILLS_FOUNDATION.md) — Base Level, Skills, training systems and the layered Combat System architecture.
- [`docs/design/party/PARTY_SYSTEM_FOUNDATION.md`](design/party/PARTY_SYSTEM_FOUNDATION.md) — character roster, unique vocations, Gold unlocks, the 1-4 Active Party, Frontline and Shared XP eligibility.
- [`docs/design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`](design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md) — the four navigation surfaces, region boundaries as data rather than pixels, calibration honesty and the deferred gold region highlight.
- [`docs/design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md) — the co-op lobby checklist as a player-authored conditional strategy, the frozen plan, spectators, and the Party / Expedition / Warzone distinction.

Each design document carries its own status marker and its own list of open decisions. Those
open items are not resolved by this roadmap.

## 23. Gates

Cross-phase correctness obligations — what must be true *before* a phase starts — live in
[`docs/PHASE_GATES.md`](PHASE_GATES.md), referenced inline from §20 above. A gate records
requirements; it never records status.
