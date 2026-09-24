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

## Stamina and activity occupancy

A Character may perform only **one** primary action at a time - it cannot Hunt and Skill Train
at once. Different Characters on the account may act concurrently.

**Stamina is per Character**, maximum 42:00 hours, with no shared account pool.

- consumption **activates** on the first qualifying Hunt XP and then tracks the Hunt's
  `ONLINE_ACTIVE` state, including time between kills;
- it stops immediately on pause, exit or activity end;
- Premium accounts get **1.5× Hunt Base XP from 42:00 to 39:00**, then normal. Free is normal
  throughout. There is no low-stamina penalty band;
- at exactly 0 the Character earns **no Hunt reward of any kind** but keeps fighting - zero
  stamina never forces an exit;
- eligibility is per Character, and is a separate predicate from Shared XP level eligibility;
- recovery happens whenever the Character is **not reserved in a Stamina-consuming Hunt
  lifecycle** - including Dummy / Exercise Weapon Skill Training, which does **not** block it.
  Premium recovers 1:1, Free 1:2, capped at 42:00;
- **reconnect grace is neutral**: a paused Hunt neither consumes nor recovers, so a deliberate
  disconnect cycle cannot be used to regenerate Stamina.

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
- maximum **one Character per vocation** per account;
- **deleting a Character** (`LOCKED`, `ADR-020`): it stays intact and restorable for **30 days**,
  then is **permanently purged** with everything it owns — items, Gold Pouch, progression.
  Nothing moves to the Bank. Until the purge it keeps its name, its vocation, its roster place
  and, as the Origin Character, the Origin slot, so no replacement can take them and a restore
  always succeeds. Deleting the Origin Character never resets the account's tutorial completion
  and never earns a one-time grant twice — `docs/DECISIONS.md` § *Character deletion*;
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

Exactly **one** playable power tier: **Powerful**. Basic and Intricate are not player
progression tiers.

Duration is **12 hours of active use**, not wall-clock expiry. Nothing is consumed while the
item is unequipped, the Character is inactive or offline, or the activity is paused in reconnect
grace. Remaining duration lives on the item and **resumes** on re-equip rather than resetting.

Powerful Imbuements require completing **exactly five** configured boss completions of the
approved quest/progression chain. The identities of those five bosses are open content design;
the count is not.

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

**Premium is Account-wide** - every Character on the account receives applicable benefits. It
grants the 42:00→39:00 Hunt XP band and 1:1 Stamina recovery.

Premium does **not** grant a fifth simultaneous Active Party member, and does not raise the
42:00 Stamina maximum. Roster expansion is a Gold sink available to every player. Party-related
Premium *convenience* benefits remain to be designed.

Free:
- unlocks roster characters with Gold like everyone else;
- remains competitively viable.
