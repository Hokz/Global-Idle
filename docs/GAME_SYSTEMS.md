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

## Character roster and Active Party

One player account controls every character. There is no multi-human party.

### Character Roster

- all vocation characters the account has unlocked;
- maximum **5**;
- maximum one character per vocation - duplicates are prohibited account-wide;
- an owned vocation is removed from future unlock choices;
- additional roster slots are unlocked with in-game Gold (costs OPEN);
- later unlocked characters start at Base Level 8, skip Rookgaard, get no catch-up levels.

### Active Party

- the characters currently fighting, chosen from the roster;
- minimum **1**, maximum **4**;
- a fifth simultaneous active character does not exist, so with all five vocations unlocked at
  least one always sits out;
- unlocked does not mean active - the player chooses the formation;
- inactive roster characters neither fight nor receive Shared XP.

### Frontline

- Active Party Slot 1 is the Frontline;
- any vocation may hold it, and the Origin Character is not required to;
- combat effects of the remaining positions belong to Combat/Party design.

### Shared XP eligibility

```text
minimumShareLevel = ceil(highestLevel × 2 / 3)

level-eligible when   lowestLevel >= minimumShareLevel
```

Evaluated across the whole Active Party from the highest and lowest active Base Levels. One
out-of-range member fails the whole formation, and newly unlocked Level 8 characters get no
exception. Exact bonus/distribution values follow Tibia Global as a reference and must be
verified before implementation.

### Connection

One account/session owns the Active Party, so an unexpected disconnect pauses the entire Party
under the global 5-minute reconnect grace.

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
- remote services after unlock;
- advanced loot management;
- advanced boss rotation.

Premium does **not** grant a fifth simultaneous Active Party member. Roster expansion is a Gold
sink available to every player. Party-related Premium benefits are OPEN.

Free:
- unlocks roster characters with Gold like everyone else;
- remains competitively viable.
