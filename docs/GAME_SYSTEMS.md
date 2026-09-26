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
- a Character whose **Game Account is pending deletion** recovers nothing: the grace is a full
  freeze, and a restore credits nothing for the pending time (2026-09-25).

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
and defences follow the type (`docs/DECISIONS.md`, 2026-09-25). The weapon attack and defence
formulas are locked: Attack Value, Max Base Damage, Defense Value — Attack's shape at 0.50 scale
plus flat Weapon Defense and Armor Value — and Armor Value. Armor and Defense decide pass or block
and never reduce damage that passes, Mitigation is a percentage of the damage that passed, and no
vocation gets a hidden multiplier (`docs/DECISIONS.md` § *Combat formulas — weapon attack and
defence*). Ranged Accuracy, the damage roll and the rounding stages stay open.

`baseXp` is the truth and Base Level its stored projection. The curve Phase 2 implemented is
Canary's, and is not locked as Global Idle's (`docs/DECISIONS.md` § *Base XP and Base Level*).

Preferred design:
- Skill XP gained from combat/content;
- player allocates progression;
- vocation-specific efficiencies/costs.

Final choice remains open.

## Game Account, Main Character and Active Party

`LOCKED` 2026-09-25 (`ADR-022`), superseding the roster of five equivalent Characters. One player's
Game Account controls every actor in its personal party. There is no multi-human personal party.

### Main Character and companions

- one **Login** (email / authentication) may own several **Game Accounts**. Each is its own
  campaign, with its own name, Main, companions, progression, quests, reward claims and economy;
  none of it is shared;
- a Game Account has exactly **one Main Character**, its campaign identity, **from creation**. The
  character that begins in Rookgaard **is** the Main, vocationless there, and the same Main
  selects its vocation on proceeding to the Mainland. *Origin Character* is only the legacy and
  code name for that Main in its vocationless Rookgaard state;
- further vocations are unlocked as **companions** — at most one per vocation, so at most four. A
  companion is not an account-lifecycle Character equivalent to the Main;
- a vocation the Main or a companion holds is removed from future unlock choices;
- companions are unlocked with in-game Gold (costs OPEN);
- a newly unlocked companion starts at Base Level 8, skips Rookgaard, gets no catch-up levels;
- an unlocked companion is **permanent**: never deleted, dismissed, removed, replaced, rerolled,
  converted into the Main or unlocked backward;
- the Main / companion distinction adds no hidden combat multiplier;
- a different Main vocation means another Game Account under the same login;
- what a companion holds for itself — custody, Stamina, occupancy — and whether its name is
  player-chosen are OPEN (`ADR-022` §4). Its name is a Character name, unique across the game;
- **deleting a Game Account** (`LOCKED`, `ADR-024`, 2026-09-25): the **whole Game Account** stays
  intact, **fully frozen** and restorable for exactly 720 elapsed hours, and a restore returns it
  exactly, with nothing credited for the pending time. Then it is **permanently purged**: the Main,
  every companion and everything the Game Account owns — items, Pouches, Bank, Depot, Stash,
  progression, claims. The Login and its other Game Accounts are untouched, and nothing transfers
  to them. Until the purge every Character name of the Game Account stays reserved across the
  whole game. There is no replacement Main, no public Deleted List — only an internal history
  record for support — and one lifecycle for every deletion source, moderation included —
  `docs/DECISIONS.md` § *Game Account deletion*.

### Rookgaard

`LOCKED` 2026-09-25: Rookgaard is a full playable, **single-player** region — no vocation, no
companions, no Main-game Party, no co-op. A Game Account's Main begins there vocationless and may
stay indefinitely. Reaching Level 8 offers the vocation and the Mainland; it does not end
Rookgaard. On proceeding to the Mainland the same Main selects its vocation, and the other four
become possible companions — `docs/DECISIONS.md` § *Rookgaard*.

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
  final or primary reward chest is claimed once per Game Account, whichever actor opens it —
  never per Login, so each Game Account of a Login claims its own. Whether other quest content can
  be replayed is decided per content (`ADR-023`).

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
- **Use in a Hunt:** a configured action slot — Health Potion, Mana Potion — drinks an eligible
  bound potion straight from the Store Container by its own threshold, never via a Hunt Container.
  A tutorial potion shares the ordinary potion's definition and is bound on the instance; Canary's
  `UNIQUEID` / `ACTIONID` never encode a binding.
- **Deletion:** frozen and restorable during the 720-hour grace of its Game Account; at the purge,
  deleted with the Game Account wherever it is stored — never refunded, unbound or transferred.
- **Not decided:** which phase first issues the tutorial potions as bound instances (`ADR-024`
  DEL-O5).

## Playable Beta Slice and creator tooling (Phase 4A)

Approved by the Product Owner; **not started** —
[`design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md`](design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md),
`docs/DECISIONS.md` § *Phase 4A — Playable Beta Slice / Creator Preview*.

- **What:** a mandatory playable milestone inside the Phase 4 program, after the Phase 4
  foundation — not a replacement for Phase 4 and not a gate. One person plays from development /
  staging sign-in, through a Game Account and its Rookgaard Main, the Atlas, an NPC, a Hunt, XP, a
  Skill, loot, equipment and a potion through an action slot, to a session restored from the
  server.
- **Creator tooling:** administrative capability belongs to an authenticated development /
  staging **privileged identity**, never to a fake ordinary *"God Character"*. Its server-side
  commands — XP, and Level only through the XP → Level invariant, Skills, vitals, test items, test
  Gold through the ledger, test content, test Hunts, safe progression flags — **never bypass a
  domain invariant**.
- **Combat inspector:** a read-only view of the server's own combat calculation, for whichever
  combat model is implemented. It decides nothing.
- **Values:** rough, visually incomplete and unbalanced is acceptable; `INITIAL/TUNABLE` values
  live in the configuration surface (`ADR-025`).
