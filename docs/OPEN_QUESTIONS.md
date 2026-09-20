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

## IP / launch

- final product name;
- rights/licensing strategy;
- map/assets;
- creature/item names;
- lore/quest text;
- public commercial release boundary.
