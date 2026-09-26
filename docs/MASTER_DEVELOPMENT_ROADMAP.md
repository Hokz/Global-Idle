# Master Development Roadmap

## 1. Product definition

Global Idle is a **100% browser-based idle strategy RPG**.

The player manages characters, parties, equipment, resources and progression while navigating an interactive world map.

Each Game Account has one **Main Character**, its campaign identity, and unlocks further vocations
as **companions** that join the Main in a personal party of up to four (`ADR-022`, 2026-09-25).

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

The classic Skills are retained — Magic Level, Sword, Axe, Club, Shielding, Distance and Fist — and
there is no Fishing. Level is not the sole power source: power and build also come from the
Skills, the vocation's Skill Tree, the Wheel, equipment, affixes, the Forge, Imbuements and
Charms, and Hunts reward matching a build to the Hunt (`DECISIONS.md`, 2026-09-25). Damage origin
and damage type are separate, and ordinary Hunts use resistances rather than absolute immunities.
The weapon attack and defence formulas are **locked** (2026-09-25, final synchronization):
the exact Attack Value, Max Base Damage, Defense Value and Armor Value. Armor and Defense decide
pass or block and never reduce damage that passes, Mitigation is a percentage of the damage that
passed, and there is no hidden vocation multiplier (`DECISIONS.md` § *Combat formulas — weapon
attack and defence*). Ranged Accuracy, the damage-roll distribution and minimum damage, the
rounding stages and the tie/order/visual-mapping rules stay open. Nothing is implemented yet; the
engine Phases 2–3.6 verified stays as built until a phase implements them.

## 6. Vocation roles

### Knight
Primary: Tank  
Secondary: Physical melee damage

Its tankiness comes from visible build and progression systems — equipment, Skills, its Skill
Tree, the Wheel — never from a hidden vocation Armor or Defense multiplier (2026-09-25).

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

### Vocation Skill Trees
- separate from the Wheel;
- **one tree per vocation** — there is no universal Skill Tree, and the number of paths is each
  vocation's own, not a fixed three (`DECISIONS.md`, 2026-09-25);
- further paths gated by Level or other progression, with long-term crossover;
- Gold-funded nodes — a major Gold sink;
- nodes can have multiple ranks;
- respec removes chosen nodes, refunds no Gold, and never leaves a tree invalid;
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

**Replay and one-time rewards are separate** (`ADR-023`, 2026-09-25). A **human multiplayer /
co-op** quest can be run again: its boss rooms repeated, its areas reused, other groups helped, a
different actor selected. Its final or primary reward chest is claimed **once per Game Account**,
whichever actor opens it — never per actor or per Login — and replay never re-enables it.
Whether solo, tutorial, story or dungeon content can be replayed is decided per content. A quest
reward item is ordinary unless its definition binds it.

## 9. Bosses

Bosses can require a one-time unlock dungeon. The unlock is **access**; one-time *rewards* follow
the claim rules of §8.

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

Vocations are told apart by equipment eligibility, weapon and off-hand options, spells, Skill
Trees and the Wheel — never by a hidden per-vocation Armor or Defense multiplier. Armour slots stay
Tibia-like, and any vocation may use a shield where the item and the rules allow
(`DECISIONS.md` § *Equipment*).

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

Affix pools are slot-specific, and a reroll changes one chosen affix slot, leaving the others
exactly as they were (`DECISIONS.md` § *Affixes*).

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
- Forge Tier is a separate axis from rarity and affixes. Each next tier takes the target plus
  **two matching sacrifices of the required prior tier**, recursively, and an attempt has a success
  and a failure chance (2026-09-25);
- higher Classification, Rarity and Tier should become harder/more expensive;
- costs can include:
  - gold;
  - dust;
  - exaltation cores;
  - other approved resources.

Exact rates, costs and any further failure consequence are open.

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

Party capacity is **not** a Premium lever. A Game Account has one Main Character and unlocks up
to four companions — one per remaining vocation — with in-game Gold, by Free and Premium players
alike. The personal Active Party is the Main plus up to three companions; a fifth simultaneous
member does not exist (`ADR-022`). See
[`docs/design/party/PARTY_SYSTEM_FOUNDATION.md`](design/party/PARTY_SYSTEM_FOUNDATION.md).

### Free
- starts with its Main Character — the Main from creation, vocationless in Rookgaard, which
  selects its vocation on proceeding to the Mainland (*Origin Character* is only its legacy and
  code name);
- unlocks companions with Gold (costs OPEN);
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

Avoid exclusive endgame combat power as the main Premium value. **The Store does not sell combat
equipment** for real-money or premium-currency value. Its Character-bound items are consumables
(`ADR-021`), and outfits and mounts are cosmetic unlocks outside that model.

## 17. Market

Two market denominations are planned:

### Gold Market
Player-to-player market in gold.

### Premium Currency Market
Player-to-player market in premium currency.

Market principles:
- never a Character-bound consumable, on either market (`ADR-021`);
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

**There is no Phase 3.8** (2026-09-25). The canonical sequence is:

```text
Phase 3.7 — VERIFIED
  ↓
PRE-PHASE-4 specification
  ↓
PRE-PHASE-4 implementation + independent validation
  ↓
Phase 4 foundation
  ↓
PHASE 4A — PLAYABLE BETA SLICE / CREATOR PREVIEW
  ↓
remainder of Phase 4
  ↓
Phase 5
```

The product decisions the gate depends on are made. What remains of it is the **PRE-PHASE-4
specification** — the next work product — and then the implementation of the decided rules and
contracts, independently validated. **Phase 4A** is a mandatory playable milestone inside the
Phase 4 program: it is not a replacement for Phase 4, and not a new pre-4 gate (below).

### PRE-PHASE-4 GATE

Full text: [`PHASE_GATES.md`](PHASE_GATES.md) § *Pre-Phase-4*.

- **the Game Account deletion lifecycle** (`ADR-024`, reusing `ADR-020`'s mechanics; `ADR-020`
  superseded `ADR-007`'s retirement). A request puts the **whole Game Account** into a reversible
  grace of exactly 720 elapsed hours, fully frozen. A restore returns it exactly, with nothing
  credited. Otherwise an atomic, idempotent, race-safe hard purge removes all live Game Account
  state — the Main, every Companion, the Bank, Depot and Stash — proven by a schema-derived closure
  inventory and a post-purge scan. The Login survives, nothing transfers, no replacement Main is
  ever created, and one lifecycle serves every deletion source, moderation included. An internal
  history record for support remains; there is **no public Deleted List**. It replaces
  `retiredAt`. All of its product questions are **resolved**. What is left — moderation authority,
  and when the tutorial potions become bound — is narrow (`ADR-024` §9). **None of it is
  implemented**, and the gate has not passed;
- **globally unique Character names** (G4.4) — enforced at persistence level over every existing
  Character, a pending Game Account's names reserved until its purge;
- **enforce the `baseXp` → `baseLevel` projection** — `baseXp` is already the durable truth and
  `baseLevel` its stored projection (schema + `progression.ts`), as the Product Owner confirmed on
  2026-09-25. The gate proves and enforces that contract on every write path, rollback, migration
  and backfill; it does not choose again, and it does not lock the curve;
- **an Actor/Participant combat contract** that supports the vocationless Main alone in
  Rookgaard, the Main and up to three companions in the Main game, and later exactly one actor per
  Game Account in co-op. No actor is assumed to be the Login, the Game Account or the Main, while
  settlement still knows the owning Game Account. Compatibility adapters keep previously VERIFIED
  Hunt behaviour and fixtures intact. **Do not implement a generic multiplayer platform yet** — no
  networking and no lobby;
- **the tunable configuration surface** (G4.5, `ADR-025`) — one authoritative, validated,
  versioned, server-side place for PROVISIONAL and TUNABLE defaults, before Phase 4 adds its own.

### Phase 4 — Party / vocations

Phase 4 is delivered as one program: the **Phase 4 foundation**, then **Phase 4A — Playable Beta
Slice / Creator Preview** (below), then the **remainder of Phase 4**. Which of the deliverables
below belong to the foundation and which to the remainder is for the Phase 4 specification to
place. Phase 4A's acceptance journey sets the minimum: what it needs is built by the foundation or
by 4A itself.

- base Skills — the classic set, with no Fishing — training, and death loss;
- all five vocations and their identities;
- occupancy integration with dedicated Skill Training, and Stamina recovery while training;
- **companions** (`ADR-022`): the Main Character plus up to four Gold-unlocked companions, one per
  vocation. An unlocked companion is **permanent** — never deleted, dismissed, replaced, rerolled,
  converted or re-locked — and goes only with its whole Game Account (GA11, `ADR-024`). The
  companion questions `ADR-022` §4 still leaves open — custody, Stamina, occupancy, levelling and
  whether names are player-chosen — are settled by this phase's specification. Companion names are
  globally unique Character names (`ADR-024` NM1);
- **the tactical action slots** — Health Potion, Mana Potion, Healing Spell and Attack Spell, with
  Rune and other slots later. A configured slot acts by its rule or threshold, and may consume an
  eligible Character-bound potion straight from the Store Container (`DECISIONS.md` § *Tactical
  action slots*, `ADR-021` U5);
- **the locked weapon attack and defence formulas** need Skills and Shielding, which this phase
  builds. Where they are implemented is placed by the PRE-PHASE-4 specification, and the verified
  Phase 2–3.6 engine is superseded only through explicit matrix amendments;
- the **personal Active Party**: the Main plus up to three companions, 1–4 actors, reorderable,
  with the Frontline in Slot 1;
- Shared XP eligibility;
- **tactical policy primitives** — target selection, healing, supply use, risk/retreat, role.
  These are the player's *strategy*, not their reflexes, and they are baseline gameplay;
- **a one-account Party is NOT a co-op group.** Do not entangle combat actor identity with the
  account id or with one hard-coded Character;
- server authority, deterministic replay, pinned content and transactional settlement are
  retained unchanged.

Recorded in full: [`design/party/PARTY_SYSTEM_FOUNDATION.md`](design/party/PARTY_SYSTEM_FOUNDATION.md).

### Phase 4A — Playable Beta Slice / Creator Preview

> Approved by the Product Owner after the final 2026-09-25 synchronization decisions. **Not
> started.** Status lives in [`PROJECT_STATE.json`](./PROJECT_STATE.json), not here.
> Milestone: [`design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md`](design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md).

A **mandatory playable milestone inside the Phase 4 program**, between the Phase 4 foundation and
the remainder of Phase 4. It is **not** a replacement for Phase 4, and **not** a new pre-4 gate.

- **the acceptance journey, at minimum:** launch the web client; development / staging
  authentication; select or create a Game Account; start its Rookgaard **Main** — vocationless
  there — and choose a globally unique Character name; enter a small Rookgaard Game Window; use a
  small functional Atlas, whose entries show useful labels and details on hover, focus and click;
  interact with at least one real, reusable NPC / dialogue flow; select and enter at least one
  Hunt, preferably the Rookgaard Sewers and its Rats; complete a short combat rotation; gain XP;
  progress at least one relevant Skill; receive loot; equip and unequip real ItemInstances; see
  equipment and stats change combat; use at least one potion through the tactical action-slot
  model; exit, reload or log out; and return to the authoritative persistent state, restored from
  PostgreSQL and server state;
- **the minimum Atlas:** Rookgaard available; the Temple, the Sewers and at least one useful
  marker; Thais may appear locked or future; no invented geographic polygon or coordinate;
- **creator tooling for development and staging:** administrative capability belongs to an
  authenticated **privileged identity**, never to a fake ordinary *"God Character"*. Server-side
  commands set or add XP, set Level only through the authoritative XP → Level invariant, set or
  add Skill progress, restore HP, Mana and Stamina where applicable, grant, remove and equip test
  items, grant and remove test Gold through valid ledger and domain paths, enter approved test
  content, start or reset a test Hunt, set or reset safe test progression flags, and inspect the
  server's combat calculations. **DEV tools must not bypass domain invariants**;
- **a combat inspector** that shows, where implemented, the Attack, Armor and Defense values and
  their rolls, the block / pass outcome, the spark / smoke mapping once locked, Max Base Damage,
  the damage roll, Mitigation, the final HP damage, the Skill and equipment contributions, and the
  deterministic seed and run identity. It reads the server's calculation and decides nothing;
- it may be rough, visually incomplete and unbalanced, with `INITIAL/TUNABLE` values;
- **non-goals:** all of Rookgaard, the full tutorial, final Atlas calibration, final UI, art or
  balance, production public authentication, complete quests, dungeons or bosses, human
  multiplayer, Market or economy expansion, Forge, Imbuements, the Wheel, full Skill Trees,
  Premium, and scale hardening.

### Phase 5 — Quest / dungeon / boss framework

The **generic** engine. Solo and one-account Party only; no networking, no lobby.

- dungeon rooms, objectives, rewards and mechanically configurable encounters;
- **pure, versioned, data-driven mechanics**: triggers, guards, assignments and roles,
  priorities, ordered steps, success and failure conditions, quest items collected and used, and
  optional conditional fallback strategies;
- the same definitions must work solo and with a one-account Party;
- **no boss implemented as bespoke code**, and **no lobby in Phase 5**;
- the Requirement / Cost / Reward primitive, built when the first content slice needs it;
- **the reward-claim primitive** (`ADR-023`): each one-time reward is a typed, exactly-once claim
  per Game Account — never per actor or per Login — kept apart from completion and progression
  state. Which content can be replayed is each content's own definition; co-op quests (Phase 5B)
  can be;
- Reward Chest — persistent and safe from Hunt death — and blessing acquisition, where this is
  the natural owning slice;
- travel and access foundations; unlock framework; first-completion rules; boss daily limits and
  rotation.

The cooperative layer that later drives this engine:
[`design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md).

### PRE-5B GATE

Full text: [`PHASE_GATES.md`](PHASE_GATES.md) § *Pre-5B*.

Multi-account membership invariants, with exactly one selected actor per Game Account;
**cross-account disconnect decided and tested separately** from one-account Party behaviour;
reward ledger safety across accounts, one-time reward claims per Game Account included.

### Phase 5B — Multiplayer activities

Three slices, in order. Recorded in
[`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md) and
[`design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md).

#### Slice 1 — social and multi-account infrastructure

- friends and invitations; chat; lobby; readiness; membership;
- **one selected actor per Game Account** — its Main or any unlocked companion; the Main is not
  mandatory, and a personal Active Party never enters as a block (`ADR-022` MP1–MP5);
- per-character occupancy across accounts; one shared run identity; liveness rules;
- reward ledger safety; spectator-only reads;
- **do not re-label a personal Party as a large Party**; cross-account disconnect behaviour is
  decided separately, and one player's disconnect must not automatically pause everybody without
  a separately approved rule.

#### Slice 2 — the first cooperative complex quest

Up to **five human players, one selected actor per Game Account** — its Main or any unlocked
companion. The quest stays replayable, and its final reward chest is claimed once per Game Account
(`ADR-023`).

- a pre-room lobby exposing the encounter mechanic checklist and role slots;
- players collectively author a **conditional strategy** — when to change targets, who collects
  an item, where and when it is used, an alternate assignee if the primary cannot act;
- all ready → plan validated and **frozen** → server-authoritative simulation → everyone watches
  the **same** run. **No runtime input bypasses the frozen plan;**
- a dead character immediately stops participating and exits the fight; that human may leave or
  keep watching as a **spectator**, who cannot act, claim combat occupancy or influence RNG;
- **OPEN:** whether death grants rewards, and whether revival exists. Do not invent either.

#### Slice 3 — Warzones

- large public activities on the same multi-account infrastructure, one actor per Game Account;
- tentative target **~25 minimum to ~50 maximum entrants — TUNABLE and TO BE BENCHMARKED**, not a
  locked balance parameter;
- shared objectives with sectors or subgroups, not fifty independent agents in one small arena;
- stress-test simulation cost, fairness and per-account settlement before launch.

**PvP Arena, matchmaking and ranking** stay a later, post-combat-balance milestone. The early
obligation is only neutrality of the Actor / Target / Side concepts.

### Phase 6 — Economy

- Bank services and history; player-to-player transfer; Market, escrow, fees, price history;
- gold sinks; premium-currency market; transaction ledger; anti-duplication tests; audit;
- **multi-account farming** — one-time reward claims are per Game Account, and one Login may own
  several. Whether a tradeable one-time reward farmed across Game Accounts is limited is decided
  before player trade ships (OPEN, `PHASE_GATES.md` § *G6.4*).

**Ordering note:** the *minimum* multi-account reward and penalty settlement is a **Phase 5B
prerequisite**, proven before the first shared quest — it does not wait for the full Market.
Definition versioning and rarity/affix validation are gates before market, forge or imbuement:
[`PHASE_GATES.md`](PHASE_GATES.md) § *Pre-market*.

Recorded in full: [`design/ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md`](design/ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md).

### Phase 7 — Forge / Imbuement / Wheel / Skill Tree

- Forge target and sacrifices of the required prior tier, recursively; Tier 0-10; success and
  failure; classification and rarity validation;
- Imbuements: **Powerful only**, 12h **active-use** duration on the item, boss-progression unlock
  gate, transaction-safe apply/remove/consume;
- quest unlocks; Wheel; gems; **vocation Skill Trees** — one per vocation, Gold-funded, with a
  respec that refunds nothing; item sinks.

Combat must accept **stable modifier interfaces** before these subsystems are implemented, so a
new modifier source is configuration rather than a combat rewrite.

### Phase 7A — Advanced progression

- **Bestiary and Charms** — kill counters, Bestiary entries, Charm Points, Charm Runes and the
  multi-stage Charm progression. Owned here, not by Phase 9: it is a progression system with its
  own counters and unlocks, and content that feeds it is a consumer rather than its owner. The
  Tibia Global Bestiary is the baseline: its then-current values are verified and recorded when
  this phase is built, and it reveals resistances and weaknesses (`DECISIONS.md` § *Bestiary*);
- outfits and achievements.

Recorded in full: [`design/FUTURE_DIRECTIONS.md`](design/FUTURE_DIRECTIONS.md) §3.

### Phase 8 — Premium / automation

- Premium purchase, renewal, expiry and entitlement transitions, splitting any unsettled interval
  at the transition. Premium is per Game Account as implemented; whether it attaches to the login
  identity instead is open (`ADR-022` GA-O8);
- the Stamina benefits Phase 2 already consumes; future boost products use `ActiveUseTimer`,
  never wall-clock countdowns;
- advanced Auto-Sell with item / category / rarity / default rules and protected-state overrides;
- automation, remote services, loot and boss automation, analytics, final Free/Premium balance;
- Party-management convenience benefits (OPEN — no fifth active Party slot);
- the Store's **Character-bound consumables** — XP Boosts, Exercise Weapons bought with Store Coin
  — in each Character's Store Container (`ADR-021`). Phase 8 is the obvious first consumer, not the
  owner by right: a Daily Reward or an Event may ship a bound consumable earlier, and **whichever
  phase ships the first one implements the binding and the Store Container first**, behind the
  BOUND-CONSUMABLE gate ([`PHASE_GATES.md`](PHASE_GATES.md) § *GBC.1*). No bound item ships
  before it passes. Since 2026-09-25 the tutorial's Health and Mana potions are bound consumables
  too, used through the action slots straight from the Store Container. Which phase first issues
  them as bound instances is open (`ADR-024` DEL-O5).

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

### Cross-phase — balance telemetry

XP production, hunt efficiency, loot and drop generation, item creation and destruction, deletion
history and balance analysis are preserved or collected (`ADR-020` DH6, 2026-09-25). No single
phase owns it: each gameplay or economy phase records the telemetry it introduces, and later
balance and analytics work — Phase 9's economy rebalance among it — consumes it. The deletion
lifecycle records only its internal history record, which need not count destroyed value
(`ADR-024` HR4).

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

- [`docs/design/tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md`](design/tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md) — Rookgaard onboarding from Level 1, the Level 8 vocation choice and the journey to the Mainland; Rookgaard itself is a permanent, single-player region where a player may stay.
- [`docs/design/combat/COMBAT_LEVEL_SKILLS_FOUNDATION.md`](design/combat/COMBAT_LEVEL_SKILLS_FOUNDATION.md) — Base Level, Skills, training systems and the layered Combat System architecture.
- [`docs/design/party/PARTY_SYSTEM_FOUNDATION.md`](design/party/PARTY_SYSTEM_FOUNDATION.md) — the Main Character and its companions (`ADR-022`), unique vocations, Gold unlocks, the personal 1–4 Active Party, Frontline and Shared XP eligibility.
- [`docs/design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`](design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md) — the four navigation surfaces, region boundaries as data rather than pixels, calibration honesty and the deferred gold region highlight.
- [`docs/design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md) — the co-op lobby checklist as a player-authored conditional strategy, the frozen plan, spectators, and the Party / Expedition / Warzone distinction.
- [`docs/design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md`](design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md) — the Phase 4A playable beta milestone: its acceptance journey, the minimum Atlas, creator tooling for development and staging, the combat inspector and the non-goals.

Each design document carries its own status marker and its own list of open decisions. Those
open items are not resolved by this roadmap.

## 23. Gates

Cross-phase correctness obligations — what must be true *before* a phase starts — live in
[`docs/PHASE_GATES.md`](PHASE_GATES.md), referenced inline from §20 above. A gate records
requirements; it never records status. One gate belongs to no fixed phase: the BOUND-CONSUMABLE
gate (GBC.1) must pass before the first Character-bound consumable ships, whichever phase that
is.
