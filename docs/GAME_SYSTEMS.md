# Game Systems

## Online activity / connection

Global Idle is an online idle RPG.

- server-authoritative Hunt/Dungeon simulation runs only for connected sessions;
- a background or minimized client keeps progressing while the connection stays alive;
- offline Hunt/Dungeon combat does not exist - no XP, gold, loot or room progression accrues
  while disconnected;
- Skill Training (Exercise Weapon + Training Dummy) is the only approved offline progression;
- an unexpected disconnect pauses the activity and preserves it for 5 minutes; reconnecting
  within that window resumes the same session, and letting it expire terminates the activity;
- nothing progresses during the paused grace period;
- manual Leave Hunt and explicit logout end the session immediately, without grace.

## Hunts

- rooms 1-10 escalate;
- room 10 loops indefinitely;
- the Hunt ends on death, manual exit, or a player-configured stop condition;
- supply exhaustion and full Loot Capacity warn the player but do not end the Hunt by default;
- combat is server simulated;
- hunt UI can show expected efficiency and risk.

## Supplies

Supplies should be real constraints.

Examples:
- healing resources;
- mana resources;
- ammunition;
- consumables;
- hunt-specific resources.

Exhaustion behavior:

- supplies remain real combat constraints;
- exhaustion increases risk;
- exhaustion does not force the Hunt to stop by default;
- the game warns the player and the character may continue;
- a player-configured automation may choose to stop based on remaining supplies.

Exact consumption rules belong to combat design.

## Death

Punitive by design.

Possible losses:
- character XP/level progress;
- skill progress.

Blessings/protection reduce punishment.

Exact formula remains open.

## Skills

Separate from character level.

Preferred design:
- Skill XP gained from combat/content;
- player allocates progression;
- vocation-specific efficiencies/costs.

Final choice remains open.

## Vocation systems

### Knight
tank / melee / survivability

### Druid
support / healing / cleanse / buffs

### Sorcerer
top magic DPS / elemental mastery

### Paladin
top ranged DPS / physical + Holy

### Monk
debuff / hybrid support / middle DPS

## Wheel

- level points;
- build shaping;
- socketable gems;
- currency sink.

## Class Skill Tree

- separate from Wheel;
- gold-funded;
- multi-rank;
- class-identity focused.

## Quests

Translated into dungeons:
- combat rooms;
- minibosses;
- puzzles;
- unlock rewards.

Long term:
- first completion should require meaningful interaction.

## Bosses

- unlock through first-clear dungeon when applicable;
- repeatable after unlock;
- auto-rotation for unlocked bosses;
- default daily limit target: 3 per boss.

## Items

Two layers:

### BaseItem
Static identity and base rules.

### ItemInstance
Unique dropped object:
- rarity;
- affixes;
- Forge tier;
- Imbuements;
- trade state.

## Rarity

Locked order:

`Common -> Semi-Rare -> Rare -> Mystic -> Legendary -> Stellar`

Rarity is rolled when an eligible equipment instance is created.

## Affixes

Rarity controls:
- allowed affix count;
- value bands;
- special-property eligibility.

Exact pools/values are open.

## Forge

Structure locked:

- target item stays;
- two sacrifice items consumed;
- same Classification;
- same Rarity;
- tiers up to 10;
- target keeps affixes;
- failed attempt does not destroy target;
- higher class/rarity/tier = harder and costlier.

## Imbuements

Independent layer.

Powerful Imbuements may require progression unlocks.

## Market

- Gold Market;
- Premium Currency Market;
- escrow;
- atomicity;
- fees;
- audit log;
- price history.

## Premium

Direction:
- automation;
- convenience;
- capacity;
- fifth party slot;
- remote services after unlock;
- advanced loot management;
- advanced boss rotation.

Free:
- begins with one slot;
- can expand up to four;
- remains competitively viable.
