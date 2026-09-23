# Open Design / Research Questions

These are intentionally unresolved.

Agents should not silently invent permanent answers.

The existence of offline Hunt/Dungeon progression is **not** an open question. It is locked in
`docs/DECISIONS.md`: activity simulation is online-only, and dedicated Skill Training is the
only approved offline progression. Only that training's limits and rates remain open.

## Progression

- exact XP curve;
- exact skill-progression model;
- universal Skill XP vs skill-specific XP vs hybrid;
- vocation skill-efficiency curves;
- death XP loss;
- death skill loss;
- blessing/protection formulas.

## Rarity

- drop probability by rarity;
- rarity scaling by content difficulty;
- affix count per rarity;
- affix pools by equipment slot;
- affix value ranges;
- whether certain special effects begin only at Legendary/Stellar.

## Forge

- success chance by:
  - Classification;
  - Rarity;
  - Tier;
- exact gold cost;
- exact dust cost;
- exact exaltation-core cost;
- maximum Fatal/effect scaling;
- whether pity/protection mechanics exist;
- whether some materials change failure behavior.

## Combat

- final stat formulas;
- party targeting;
- rotations/behavior rules;
- aggro;
- support logic;
- debuff stacking;
- elemental penetration/resistance;
- exact supply-consumption rules.

## Party and roster

Roster maximum (5), Active Party maximum (4) and the one-character-per-vocation rule are
locked in `docs/DECISIONS.md` and are **not** open.

- exact Gold price for Roster Slots 2-5;
- whether unlock costs scale linearly, exponentially or by milestones;
- whether prerequisites besides Gold exist;
- XP behavior when a multi-character formation is not Shared-XP eligible;
- exact adopted Tibia Global Shared XP bonus and distribution values;
- exact definition of a "qualifying Hunt XP reward" for Stamina activation;
- the identities of the five bosses in the Powerful Imbuement unlock set (the count is locked at five);
- combat consequences of Party ordering beyond Slot 1 being the Frontline;
- final name for the "Origin Character" concept;
- final Skill Point state granted to a newly unlocked Level 8 character.

## Vocation balance

- Druid support/damage ceiling;
- Sorcerer mastery benefits;
- Paladin physical/Holy split;
- Monk debuff catalog;
- Knight tank threat and mitigation;
- HP/mana growth final values.

## Wheel

- exact adaptation from level 1;
- node layout;
- gem economy;
- reset/respec costs.

## Skill Tree

- node catalog;
- number of ranks;
- gold curve;
- unlock requirements;
- respec model.

## Bosses

- exact daily limits;
- reward scaling;
- whether auto-rotation consumes additional resources;
- individual cooldown exceptions.

## Premium

- Premium duration/price;
- Gold and premium-currency costs of Imbuement materials;
- Premium Party-management benefit, now that the fifth active Party slot is superseded;
- premium-currency package pricing;
- maximum offline Skill Training duration;
- Exercise Weapon charge settlement while offline;
- offline training-rate rules;
- automation entitlements;
- storage/loot limits;
- regional pricing.

## Market

- listing fees;
- sale tax;
- listing duration;
- market limits;
- price-history window;
- anti-manipulation rules;
- premium-currency transfer restrictions.

## World, Atlas and regions

Owned by Phase 9, except where noted. Direction:
[`design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`](design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md).

- where calibrated region polygons come from, and what licence covers them;
- whether a region boundary is one polygon or a multi-polygon with holes;
- whether the world atlas and the regional mini-atlas share one coordinate space or two;
- what the region highlight does at a boundary two regions share.

The navigation hierarchy itself and the "no invented coordinate" rule are **not** open: they are
approved direction in that document.

## Cooperative play

Owned by Phase 5B unless a gate is named. Direction:
[`design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md).

- whether a dead participant still receives rewards, and whether revival exists at all
  (slice 2 — **do not invent this**);
- what a cross-account disconnect does. Decided and tested **separately** from one-account Party
  behaviour; one player's disconnect must not automatically pause everybody without a separately
  approved rule (**PRE-5B gate**);
- how contribution is measured, and whether it affects reward;
- how loot is distributed across accounts, and whether the Reward Chest is the vehicle;
- how much conditional logic the plan-authoring surface should allow;
- what happens when a frozen plan becomes unsatisfiable mid-run;
- scheduling and matchmaking for Warzone entry;
- the real Warzone entrant ceiling. The ~25–50 target is **tentative and to be benchmarked**, not
  a locked balance parameter (slice 3).

## Pre-phase gates

Stated in full in [`PHASE_GATES.md`](PHASE_GATES.md). Open where the answer is not yet written:

- which of `baseXp` and `baseLevel` is authoritative and which is derived (**PRE-4 gate**);
- the shape of the Actor/Participant combat contract, and which compatibility adapters keep the
  verified Hunt fixtures intact (**PRE-4 gate**);
- `ItemDefinition` version semantics for live `ItemInstance` rows (**PRE-MARKET gate**).

## IP / launch

- final product name;
- rights/licensing strategy;
- map/assets;
- creature/item names;
- lore/quest text;
- public commercial release boundary.
