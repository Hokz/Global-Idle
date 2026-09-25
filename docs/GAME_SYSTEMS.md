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
- creatures use resistances, sensitivities and weaknesses, not absolute immunities: a mismatched
  build is less efficient, not blocked (2026-09-25);
- combat is server simulated;
- hunt UI can show expected efficiency and risk.

## Stamina and activity occupancy

A Character may perform only **one** primary action at a time - it cannot Hunt and Skill Train
at once. Different Characters on the account may act concurrently — under `ADR-022` the Main is
the only such Character, and whether a companion may act on its own is open (GA-O5).

**Stamina is per Character**, maximum 42:00 hours, with no shared account pool. That is the Main's;
whether a companion has its own is open (`ADR-022` GA-O4).

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
  disconnect cycle cannot be used to regenerate Stamina;
- a Character **pending deletion** recovers nothing: the grace is a full freeze, and a restore
  credits nothing for the pending time (2026-09-25).

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

The classic Skills are retained — Magic Level, Sword, Axe, Club, Shielding, Distance and Fist — and
there is no Fishing. Level is not the sole power source, and Hunts reward matching a build to the
Hunt. Damage origin — spell, weapon, rune — and damage type — physical, fire, ice — are separate,
and defences follow the type (`docs/DECISIONS.md`, 2026-09-25). The combat formulas are open.

Preferred design:
- Skill XP gained from combat/content;
- player allocates progression;
- vocation-specific efficiencies/costs.

Final choice remains open.

## Game Account, Main Character and Active Party

`LOCKED` 2026-09-25 (`ADR-022`), superseding the roster of five equivalent Characters. One player's
Game Account controls every actor in its personal party. There is no multi-human personal party.

### Main Character and companions

- a Game Account has exactly **one Main Character**, its campaign identity. *Origin Character* is
  the Main before it completes Rookgaard;
- further vocations are unlocked as **companions** — at most one per vocation, so at most four. A
  companion is not an account-lifecycle Character equivalent to the Main;
- a vocation the Main or a companion holds is removed from future unlock choices;
- companions are unlocked with in-game Gold (costs OPEN);
- a newly unlocked companion starts at Base Level 8, skips Rookgaard, gets no catch-up levels;
- a different Main vocation means another Game Account under the same login;
- a companion's lifecycle, and what it holds for itself — custody, Stamina, occupancy, a name —
  are OPEN (`ADR-022` §4);
- **deleting the Main Character** (`LOCKED`, `ADR-020`, amended 2026-09-25): it stays intact,
  **fully frozen** and restorable for **30 days** — exactly 720 elapsed hours — and a restore
  returns it exactly, with nothing credited for the pending time. Then it is **permanently
  purged** with everything it owns — items, Gold Pouch, progression — and an immutable historical
  record and a public **Deleted List** entry remain. Nothing moves to the Bank. Until the purge it
  keeps its name, its vocation, its roster place and its Main slot — the Origin slot — so no
  replacement can take them and a restore always succeeds. Deleting it never resets the account's
  tutorial completion and never earns a one-time reward twice. What happens to its companions,
  and whether the Game Account may then create a replacement Main — such as the new Level-1
  Origin Character with a fresh **Bootstrap Kit** that the pre-completion rule describes — is OPEN
  for the PRE-4 specification — `docs/DECISIONS.md` § *Character deletion*.

### Active Party

- the personal party of one Game Account: the **Main Character is always present**, and up to
  **three companions** may join it — minimum **1**, maximum **4**;
- a fifth simultaneous active actor does not exist, so with all five vocations unlocked at least
  one companion always sits out;
- unlocked does not mean active - the player chooses the companions and their order;
- companions outside the Active Party neither fight nor receive Shared XP.

### Frontline

- Active Party Slot 1 is the Frontline;
- any vocation may hold it, and the Main need not;
- combat effects of the remaining positions belong to Combat/Party design.

### Shared XP eligibility

```text
minimumShareLevel = ceil(highestLevel × 2 / 3)

level-eligible when   lowestLevel >= minimumShareLevel
```

Evaluated across the whole Active Party from the highest and lowest active Base Levels. One
out-of-range member fails the whole formation, and a newly unlocked Level 8 companion gets no
exception. Exact bonus/distribution values follow Tibia Global as a reference and must be
verified before implementation. How XP is allocated when the formation is not eligible is open,
and matters more now that the Main is always present (`ADR-022` GA-O6).

### Connection

One account/session owns the Active Party, so an unexpected disconnect pauses the entire Party
under the global 5-minute reconnect grace.

### Human multiplayer

Several Game Accounts share one multiplayer Activity, and each selects **exactly one** actor — its
Main or any unlocked companion. The Main is not mandatory. The personal Active Party never enters
as a block, and changing the actor creates no new account, reward entitlement or completion
identity (`ADR-022` MP1–MP5).

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

## Vocation Skill Trees

- separate from Wheel;
- **one per vocation** — no universal tree, and no fixed three paths;
- further paths gated by progression, with long-term crossover;
- gold-funded — a major Gold sink;
- multi-rank;
- respec without refund, never leaving a tree invalid;
- class-identity focused.

## Quests

Translated into dungeons:
- combat rooms;
- minibosses;
- puzzles;
- unlock rewards;
- **human multiplayer / co-op quests are replayable**: completion never locks them, and their
  final or primary reward chest is claimed once per Game Account, whichever actor opens it.
  Whether other quest content can be replayed is decided per content (`ADR-023`).

Long term:
- first completion should require meaningful interaction.

## Bosses

- unlock through first-clear dungeon when applicable — the unlock is access; one-time rewards
  follow the quest claim rules;
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

## Equipment

- Tibia-like armour slots;
- vocations differ by equipment eligibility, weapon and off-hand options, spells, Skill Trees and
  the Wheel — never by a hidden per-vocation Armor or Defense multiplier;
- any vocation may use a shield where the item and the rules allow.

## Rarity

Locked order:

`Common -> Semi-Rare -> Rare -> Mystic -> Legendary -> Stellar`

Rarity is rolled when an eligible equipment instance is created.

## Affixes

Rarity controls:
- allowed affix count;
- value bands;
- special-property eligibility.

Pools are slot-specific, and a reroll changes one chosen affix slot, leaving the others
unchanged. Exact pools, values and reroll costs are open.

## Forge

Structure locked:

- target item stays;
- two sacrifice items consumed;
- same Classification;
- same Rarity;
- tiers up to 10;
- target keeps affixes;
- failed attempt does not destroy target;
- each tier takes two matching sacrifices of the required prior tier, recursively;
- Forge Tier is a separate axis from rarity and affixes;
- an attempt has a success and a failure chance (rates open);
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

## Bestiary

Phase 7A. The Tibia Global Bestiary is the baseline, with its then-current values verified when the
phase is built; it reveals resistances and weaknesses through progression.

## Market

- Gold Market;
- Premium Currency Market;
- escrow;
- atomicity;
- fees;
- audit log;
- price history;
- never a Character-bound consumable, on either Market (`ADR-021`).

## Premium

Direction:
- automation;
- convenience;
- capacity;
- remote services after unlock;
- advanced loot management;
- advanced boss rotation.

**Premium is Account-wide** - every actor of the Game Account, the Main and its companions,
receives applicable benefits. Whether it attaches to the login identity instead is open
(`ADR-022` GA-O8). It grants the 42:00→39:00 Hunt XP band and 1:1 Stamina recovery.

Premium does **not** grant a fifth simultaneous Active Party member, and does not raise the
42:00 Stamina maximum. Companion unlocks are a Gold sink available to every player. Party-related
Premium *convenience* benefits remain to be designed.

Free:
- unlocks companions with Gold like everyone else;
- remains competitively viable.

The Store does **not** sell combat equipment for real-money or premium-currency value.

## Character-bound consumables and the Store Container

`LOCKED` (`docs/DECISIONS.md`, `ADR-021`); **not implemented** — built by the first phase that ships
one.

- **What:** consumables permanently bound to one Character — XP Boosts, Exercise Weapons bought
  with Store Coin or premium currency, Daily Reward and Event consumables, the tutorial's Health
  and Mana potions (2026-09-25), and others configured the same way. A source makes an item bound
  only when its definition says so; a quest reward, the tutorial's Doublet included, is never bound
  for coming from a quest. Outfits and mounts are not part of this.
- **Where:** each Character's **Store Container**, a system custody — not a backpack, not one of the
  five Hunt Container Slots — or the Account's Depot. Only Store Container ↔ Depot, and the Depot
  never makes the item the Account's.
- **Who:** only its bound Character may use it; no other Character can withdraw, use or receive it.
- **Never:** either Market, player trade, gift or mail, NPC sale, the Stash, a Forge input, another
  Character, or any conversion into Gold, premium currency or other value.
- **Death:** never at risk — it is not in the Loot Pouch.
- **Deletion:** frozen and restorable during the 30-day grace; at the purge, deleted with the
  Character wherever it is stored, the Depot included — never refunded, unbound or left behind.
- **Not decided:** how a Hunt uses a bound tutorial potion held in the Store Container, and
  whether PRE-4 builds this for the tutorial (`ADR-020` DEL-O5).
