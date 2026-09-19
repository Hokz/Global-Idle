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

Death must matter.

Direction:

- lose character progression;
- lose some skill progression;
- blessings/protection systems reduce punishment;
- exact values require balancing/research.

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

High-tier Imbuements may require quest/boss unlocks.

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

### Free
- starts with one character/party slot;
- can purchase additional slots up to four;
- navigates to services/NPCs;
- standard storage;
- standard automation.

### Premium
- can unlock the fifth party slot;
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

Offline progression must use the same authoritative rules.

## 20. Production roadmap

### Phase 0 — Foundation
- documentation;
- architecture;
- repository structure;
- web/API/database/Redis skeleton;
- data model;
- simulation contract;
- CI.

### Phase 1 — World/character vertical slice
- account;
- character;
- vocation;
- map shell;
- one region;
- one hunt entry.

### Phase 2 — Hunt simulator
- room 1-10;
- room 10 endless loop;
- supplies;
- death;
- XP/gold;
- persistence/offline.

### Phase 3 — Itemization
- BaseItem;
- ItemInstance;
- rarity;
- affixes;
- equipment;
- loot storage.

### Phase 4 — Party/vocations
- multiple characters;
- all vocation identities;
- party rules;
- combat behavior.

### Phase 5 — Quest/dungeon/boss framework
- dungeon engine;
- puzzles;
- unlocks;
- boss limits;
- boss rotation.

### Phase 6 — Economy
- gold sinks;
- market;
- premium-currency market;
- escrow;
- audit.

### Phase 7 — Forge / Imbuement / Wheel / Skill Tree
- item sinks;
- progression;
- unlock dependencies.

### Phase 8 — Premium/automation
- automation;
- party capacity;
- advanced convenience.

### Phase 9 — Content expansion
- region-by-region content;
- endgame;
- telemetry;
- economy rebalance.

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

Each design document carries its own status marker and its own list of open decisions. Those
open items are not resolved by this roadmap.
