# Locked Decisions

This document records decisions that agents should not silently reverse.

## Product format

- Browser-based.
- Idle strategy RPG.
- Server-authoritative.
- Interactive surface world map.
- Combat automated by the server.

## Online / offline activity

Global Idle is an **online** idle RPG.

- Hunts and Dungeons progress only while the player's session is connected to the server;
- the browser/client never calculates combat; simulation stays server-authoritative;
- a background, minimized or inactive tab continues normally while the server still considers
  the session connected;
- there is no offline Hunt or Dungeon combat, Base XP, gold, creature loot or room progression;
- Skill Training with Exercise Weapons and Training Dummies is the only approved offline
  progression, and it never grants Base XP.

### Reconnect grace period

Unexpected connection loss uses a **5-minute** reconnect grace period.

- the active combat/activity simulation pauses immediately on connection loss;
- the activity session is preserved for up to 5 minutes;
- nothing progresses while paused: no XP, loot, gold, room progression or supply consumption;
- reconnecting within 5 minutes restores the preserved session and resumes it from that state;
- when the grace period expires the active Hunt/Dungeon session terminates and normal re-entry
  rules apply later - for a Hunt Area, a later re-entry starts again at Room 1;
- explicit player actions bypass the grace period: manual Leave Hunt, and explicit
  logout/leave where the server receives that intent, end the session immediately;
- when the server can only observe transport/session loss - browser or tab closure included -
  it applies the same 5-minute grace period.

## Hunts

- rooms 1-10 escalate;
- room 10 repeats indefinitely;
- the Hunt ends on death, manual exit, or a player-configured stop condition;
- supply exhaustion does not force exit by default;
- full Loot Capacity does not force exit by default;
- when supplies are exhausted, the game warns the player and combat may continue;
- when Loot Capacity is full, the game warns the player and combat may continue, but
  additional loot is no longer collected.

### Room terminology

- **Room** is the single generic unit of activity progression, in the domain, the engine and the
  content schema;
- *Floor* is a dungeon-flavoured display label for the same concept, kept for player-facing text;
- boss halls are rooms too.

Decided during Phase 0A architecture, because a generic dungeon engine cannot carry two
incompatible names for its own progression unit. See
`docs/architecture/DOMAIN_MODEL.md` §5.8.

## Death

- punitive by design;
- should affect level/XP and skill progression;
- exact numbers open.

## Quests

- translated into dungeons rather than full tile-by-tile recreation;
- long term should include meaningful interactive mechanics.

## Bosses

- one-time unlock dungeon where applicable;
- repeatable after unlock;
- auto-rotation supported;
- default design target: up to 3 completions/day per boss.

## Rarity

Exact order:

1. Common
2. Semi-Rare
3. Rare
4. Mystic
5. Legendary
6. Stellar

## Item architecture

- one BaseItem definition;
- rarity/affixes live on ItemInstance;
- do not make six static copies of every item.

## Forge

- target explicitly selected;
- target keeps affixes;
- target not destroyed by failed attempt;
- two sacrifice items consumed;
- same Classification;
- same Rarity;
- eligible items can reach Tier 10;
- difficulty/cost scales with Classification + Rarity + Tier.

## Imbuements

- separate from rarity;
- separate from Forge;
- progression unlocks may gate high-tier Imbuements.

## Character progression

Two distinct build systems:
- Wheel;
- vocation Skill Tree.

## Vocation identity

- Knight = Tank
- Druid = Support/Healer
- Sorcerer = Elemental DPS
- Paladin = Ranged Physical/Holy DPS
- Monk = Debuff/Hybrid Support

## Party and character roster

- one player/account controls the entire Party; there is no multi-human party;
- the account **Character Roster** holds at most **5** characters;
- the **Active Party** holds at most **4** characters, minimum 1;
- five simultaneous active characters do not exist;
- at most one character per vocation - duplicate vocations are prohibited account-wide;
- a vocation the account already owns is never offered again as a future unlock;
- additional roster slots are unlocked with in-game Gold; exact costs remain OPEN;
- later unlocked characters start at Base Level 8, skip Rookgaard, and receive no catch-up
  levels;
- unlocking a character never forces it into the Active Party; the player may deliberately run
  solo, duo, trio or four characters;
- roster characters outside the Active Party do not fight and do not receive Shared XP;
- Active Party Slot 1 is the **Frontline**; the Origin Character is not required to hold Slot 1,
  nor to be in the Active Party at all;
- one account/session owns the whole Active Party, so the 5-minute reconnect grace pauses the
  entire Party activity.

### Shared XP eligibility

Evaluated across the **entire** Active Party, using only the highest and lowest active Base
Levels:

```text
minimumShareLevel = ceil(highestLevel × 2 / 3)

level-eligible when   lowestLevel >= minimumShareLevel
```

- one out-of-range active member makes the whole formation fail eligibility;
- newly unlocked Level 8 characters receive **no** exception;
- Tibia Global's Shared Experience metrics are the reference direction for the bonus and
  distribution table, but the exact adopted values must be verified and documented before
  implementation, never invented;
- how XP is allocated when a multi-character formation is *not* Shared-XP eligible is OPEN.

## Character activity occupancy

- a Character may perform only **one** primary gameplay/progression action at a time;
- the same Character cannot Hunt and Skill Train simultaneously, and cannot be in two
  activities;
- **different** Characters on the same account may act concurrently;
- the restriction is on Character action occupancy, not on UI navigation - the player may browse
  hubs, Market, Atlas, inventory and skills freely.

## Stamina

Stamina belongs to **each Character independently**. There is no shared account pool.

- maximum **42:00 hours** per Character;
- Premium does not raise the maximum.

### Consumption

- entering a Hunt consumes nothing;
- consumption **activates** when that Character receives its **first qualifying Hunt XP reward**
  in that Hunt;
- once activated, consumption continues while that Character's Hunt is in authoritative
  `ONLINE_ACTIVE` state, **including the time between kills and rooms**;
- consumption stops immediately on reconnect grace, manual exit, activity end, or the Character
  leaving the party;
- "N minutes without XP" is **not** the source of truth: XP activates, the activity lifecycle
  sustains;
- server time is authoritative; client elapsed time is never accepted.

### Premium XP band

| Stamina | Hunt Base XP |
|---|---|
| Premium, 42:00 → 39:00 | **1.5×** (exactly +50%) |
| Premium, 39:00 → >0 | 1.0× |
| Free, 42:00 → >0 | 1.0× |

There is **no** low-stamina reduced-XP band. An interval crossing 39:00 is split at the boundary
and each segment settles at its own rate.

### Zero stamina

At exactly 0 the Character is **Hunt-reward-ineligible**: no Base XP, no Hunt skill progress, no
gold, no loot, no other Hunt reward value.

- it does **not** force a Hunt exit - the Character keeps attacking, taking damage, consuming
  supplies and being able to die;
- eligibility is per Character: one exhausted member does not exhaust the others;
- an exhausted Character must not receive reward indirectly through Shared XP or any other
  distribution path;
- stamina eligibility and Shared XP level eligibility are **separate predicates**.

### Recovery

The distinction is *participating in a Stamina-consuming activity* vs *not participating in one*
- not "doing something vs doing nothing".

- **Dummy / Exercise Weapon Skill Training recovers Stamina.** An earlier assumption that it
  blocked recovery is superseded;
- offline, idle, menus, hubs, Market and Atlas all recover while the Character is not hunting;
- **Premium: 1 minute of eligible time = +1 minute** (1:1);
- **Free: 2 minutes of eligible time = +1 minute** (1:2);
- capped at 42:00; there is no mandatory waiting period;
- every activity type must declare whether it consumes Stamina.

## Active-use timers

Timed effects - XP boosts, status boosts, loot boosts, Imbuements - measure **active use**, not
wall-clock time.

- duration decreases only while the effect is in a qualifying state where it can operate;
- offline, idle and menu time do not burn duration;
- reconnect grace **pauses** every active-use timer;
- duration is never decremented every second; it is settled from durable state at checkpoints;
- settlement is idempotent, restart-safe and server-clock based.

## Imbuements

- exactly **one** playable power tier: **Powerful**. Basic and Intricate are not player
  progression tiers;
- duration is **12 hours of active use**, not wall-clock expiry;
- no duration is consumed while the item is unequipped, the Character is inactive or offline, or
  the activity is paused in reconnect grace;
- remaining duration is durable state on the `ItemInstance`, and travels with the item;
- re-equipping **resumes** the remaining duration; it never resets it;
- Powerful Imbuements require the approved quest/boss progression unlock.

## Free/Premium

- **Premium is an Account-wide entitlement**, not a Character one. Every Character on the account
  receives applicable benefits;
- a Premium transition splits an unsettled interval at the transition boundary; already-settled
  time is never retroactively rewritten;
- additional roster characters are unlocked with in-game **Gold**, not with Premium;
- Premium must not create a fifth simultaneous Active Party member;
- Party-related Premium benefits are OPEN and require separate product design;
- Premium emphasis = automation/convenience/capacity;
- Free must remain competitive.

## Economy

- Gold Market;
- Premium Currency Market;
- economy integrity is critical;
- Market must be transactional and use escrow.

## Engineering process

- Architect -> Builder -> Independent Reviewer.
- Same agent should not be sole final reviewer of its own major implementation.
