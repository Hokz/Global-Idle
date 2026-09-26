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

## Determinism, and what is allowed to influence it

**HTTP heartbeat and advance frequency is transport and liveness behaviour. It is NOT a
gameplay-randomness input.**

A durable Activity, its seed, its content version and the authoritative elapsed time define the
run. The number of settlements used to reach that time does not. The same run advanced once by
sixty seconds and sixty times by one second must land on the same tick, the same health, the same
tiles, the same XP, the same Gold and the same loot.

- an Activity owns deterministic RNG streams, and the run persists its POSITION in each of them, so
  a settlement resumes a stream instead of reseeding it;
- combat, physical loot and item identity are separate streams, so a new drop table or a new rarity
  cannot move a hit;
- the stream positions are written in the same transaction as the state they produced, so a
  rollback un-consumes them and a replayed checkpoint re-consumes nothing;
- a settlement that advances no whole tick consumes nothing;
- pathfinding and every other spatial decision consume no randomness at all.

A foreground tab, a backgrounded one, a slow network and a future mobile client must receive the
same luck. This matters before rankings, PvP, Warzones and Market-valued rare drops exist, not
after — which is why it is locked here rather than left to an implementation.

Decided during the Phase 3.5 determinism correction, after the reverse was found to be true. See
`docs/specs/phase-3-5/PHASE_3_5_TILE_SPATIAL_GAME_WINDOW_SPEC.md` §10 and the `RNGC` cases.

## Imported fidelity has a stated domain

**Where Global Idle reproduces a Canary formula, it also states the range in which that formula is
the source's — and it refuses outside it rather than returning a number.**

A source's arithmetic and a source's *representation* are two different facts. Canary's step
duration is a log curve with no upper bound, but `Creature::getStepDuration` caches it into a
`uint16_t` and returns a `uint16_t`, so past 65,535 ms the C++ is undefined on one path and a
silent modular wrap on the other. Neither is behaviour to reproduce, and clamping to the ceiling
would be a number the source never produced.

- an imported formula carries ONE named constant for its limit, and ONE function that applies it;
- outside the domain the engine refuses, naming the inputs — it does not clamp, wrap or guess;
- content validation bounds what can be STORED; the engine bounds what can be COMPUTED, and the
  content build asks the engine rather than restating its limit;
- a deliberate divergence at an edge is labelled ADAPT in the phase's source map, with what the
  source does instead.

Decided during the Phase 3.6 blocker correction, after tests were found asserting a 150,000 ms step
the source cannot express. See `docs/specs/phase-3-6/PHASE_3_6_MOVEMENT_FIDELITY_SPEC.md` §13 and
the `DOM` cases.

## Death

- punitive by design;
- should affect level/XP and skill progression;
- exact numbers open.

## Quests

- translated into dungeons rather than full tile-by-tile recreation;
- long term should include meaningful interactive mechanics.

### Replay and one-time reward claims

`LOCKED` by the Product Owner, 2026-09-25. The replay rule is for **human multiplayer / co-op**
quests. Architecture:
[`architecture/decisions/ADR-023-quest-replay-and-one-time-reward-claims.md`](architecture/decisions/ADR-023-quest-replay-and-one-time-reward-claims.md).
**Not implemented** — no quest, dungeon or chest exists yet (Phase 5).

**Content replayability** and **one-time reward claims** are separate:

- **replayability is defined by the content.** A human multiplayer / co-op quest may be run again:
  its shared quest, boss and content may be repeated, its hunt areas stay usable under the
  content's access rules, a player may help other groups again, and a Game Account may select a
  different actor — its Main or a companion — on a later run. A co-op quest is never *"one-time"*
  in the sense of being inaccessible after completion;
- whether solo, tutorial, story or dungeon quest content can be replayed is **content-specific and
  OPEN** unless separately decided. No rule makes every quest replayable;
- **a one-time reward claim is separate state.** A reward is one-time where its definition says
  so, and a co-op quest's **final or primary reward chest is one-time per Game Account**
  (campaign). Replay never re-enables a one-time reward;
- not yet claimed: opening the eligible chest grants the reward exactly once, and the
  authoritative claim state becomes `CLAIMED`. Already claimed: opening it grants nothing a second
  time, and the UI may show the chest as empty;
- the claim state belongs to the **Game Account**, never to the selected actor, so choosing the
  Main or a companion never resets it. It never belongs to the Login either (final
  synchronization, 2026-09-25). A companion that takes a co-op one-time reward takes it for its own
  Game Account only, and every other Game Account under the same Login keeps its own claim
  (`ADR-023` QR9);
- wherever content is replayable, quest completion and progression state and reward-claim state
  are never conflated;
- the claim is a typed, reusable reward-claim concept, settled exactly once under retry and
  concurrency — never scattered, untyped storage flags. Its physical representation is the
  implementing phase's;
- an ordinary quest reward item — the Doublet included — is a normal item unless its definition
  says otherwise: movable, sellable, tradeable and discardable under the normal item rules. Coming
  from a quest never makes equipment Character-bound.

## Bosses

- one-time unlock dungeon where applicable — the unlock is *access*; one-time *rewards* follow the
  claim rules above;
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
- do not make six static copies of every item;
- **custody and binding are separate axes**: where an item is stored never decides, on its own,
  whose it is — see *Character-bound consumables and the Store Container*, below.

### Affixes

`LOCKED` by the Product Owner, 2026-09-25. Not implemented beyond Phase 3's rolled affixes.

- affix pools are **slot-specific**: what an item can roll depends on its equipment slot and item
  type;
- a reroll targets **one** existing affix — one status slot — that the player chooses. Only that
  slot rerolls;
- the result is random from the legal pool for that item type. It may stay the same attribute at a
  different value, or become another legal attribute;
- every other affix on the item stays exactly as it was.

Pools, values, reroll costs and limits are open.

## Forge

- target explicitly selected;
- target keeps affixes;
- target not destroyed by failed attempt;
- two sacrifice items consumed;
- same Classification;
- same Rarity;
- eligible items can reach Tier 10;
- difficulty/cost scales with Classification + Rarity + Tier.

`LOCKED` by the Product Owner, 2026-09-25:

- **rarity and affixes are one axis, the Forge Tier another.** Affix quality is never called a
  Forge Tier, and forging never changes rarity or affixes;
- the intended recursive sacrifice concept: a target base item plus **two matching sacrifice items
  of the required prior tier** attempt the next Forge Tier, and each higher tier repeats that with
  sacrifices of its own prior tier;
- the Forge has a success and a failure chance.

Exact success rates, and any failure consequence beyond those locked above, are open.

## Imbuements

- separate from rarity;
- separate from Forge;
- progression unlocks may gate high-tier Imbuements.

## Character progression

Two distinct build systems:
- Wheel;
- vocation Skill Tree.

### Classic Skills and the build philosophy

`LOCKED` by the Product Owner, 2026-09-25. **Non-formula rules only**: no combat coefficient,
formula, rounding stage or balance number is decided in this subsection. The weapon attack and
defence formulas are locked separately (*Combat formulas*, below).

- the classic Skills are retained: **Magic Level, Sword, Axe, Club, Shielding, Distance and
  Fist**. There is **no Fishing** skill;
- they are real progression variables, and later feed the combat formulas;
- **Level is not the sole power source.** Level mainly provides base progression — HP, Mana,
  Capacity — plus access and unlocks. Power and build also come from the classic Skills, the
  vocation's Skill Tree, the Wheel, equipment, affixes, the Forge, Imbuements, Charms and later
  systems;
- Hunts should reward **matching a build to the Hunt**, not level alone.

### Damage origin and damage type

`LOCKED` by the Product Owner, 2026-09-25.

- **damage origin** — a spell, a weapon, a rune — and **damage type** — physical, fire, ice and so
  on — are two different things. A spell may deal **physical** damage;
- which defences apply is decided by the damage **type**, never by whether the source was a spell
  or a weapon.

### Creature elemental design

`LOCKED` by the Product Owner, 2026-09-25.

- ordinary Hunt design avoids absolute 100% creature immunities;
- creatures use **resistances, sensitivities and weaknesses** instead;
- a resistant Hunt is **less efficient** for a mismatched build, not generically impossible.

### Vocation Skill Trees and respec

`LOCKED` by the Product Owner, 2026-09-25.

- there is **no universal, shared Skill Tree**. Each vocation has its **own** Skill Tree;
- the number of paths is **not** fixed at three: it depends on each vocation's design;
- further paths can be gated by Character Level or other progression. Earlier examples such as
  Level 1000 or 2000 are illustrations, not locked thresholds;
- crossing over into further paths, long term, is intended;
- **Gold** is an intended major progression sink: nodes are bought with it;
- trees are deep enough that unlocking a later path does not imply the first one is complete;
- **respec:** the player may remove chosen nodes and rebuild. Gold already spent is **not**
  refunded. A tree can never be left structurally invalid — a removed node's dependent descendants
  are handled consistently, in a way the final implementation defines.

Open: whether an extreme endgame can eventually buy every node or keeps an exclusive
specialization, and the Monk's branch identity.

### Base XP and Base Level

`LOCKED` by the Product Owner, 2026-09-25.

- **`baseXp` is the truth.** `baseLevel` is its deterministic, stored projection;
- Canary's reference curve is `getExpForLevel(level) = (((level - 6) * level + 17) * level - 12) /
  6 * 100`, and Phase 2 implemented it (`contexts/hunt/progression.ts`). Global Idle need **not**
  adopt that exact curve unless it is separately locked. The exact curve stays **OPEN**, and the
  implemented one stands until a decision replaces it;
- the PRE-4 gate must prove that XP is authoritative, that the level is a deterministic projection
  of it, that every XP write path syncs the level atomically, that a rollback updates both or
  neither, and that migrations and backfills preserve that invariant
  ([`PHASE_GATES.md`](PHASE_GATES.md) § *G4.2*).

### Combat formulas — weapon attack and defence

`LOCKED` by the Product Owner, 2026-09-25, in the final synchronization after PR #13 head
`fff6faf`. It replaces the *"Combat formulas — OPEN"* entry recorded after `86a7681`. **Not
implemented**: the Hunt engine that Phases 2–3.6 verified still follows Canary (see *Relation to
the implemented engine*, below). It stays as built until the phase that implements these formulas
replaces it, through explicit matrix amendments.

**Attack Value** — the attack's pass/block score, separate from the damage it deals:

```text
E = Skill + Level / 100
w = (WeaponAttack - 7) / 55
s = (E - 1.01) / 263.99

AttackValue = 5 + 85 * w^2 + 350 * s^1.5 + 685 * (w * s)^3
```

**Max Base Damage:**

```text
MaxBaseDamage = 0.085 * WeaponAttack * Skill + Level / 5
```

Accepted reference anchors, all at WeaponAttack 56:

| Level | Skill | MaxBaseDamage ≈ |
|---|---|---|
| 500 | 120 | 671 |
| 500 | 240 | 1,242 |
| 2000 | 360 | 2,114 |
| 4000 | 480 | 3,085 |

**Defense Value** — the same structural formula and weights as Attack Value, with defensive
inputs, at a 0.50 scale, plus two flat terms at the end:

```text
E_def = Shielding + Level / 100
w_def = (ShieldDefense - 7) / 55
s_def = (E_def - 1.01) / 263.99

DefenseCoreRaw    = 5 + 85 * w_def^2 + 350 * s_def^1.5 + 685 * (w_def * s_def)^3
ScaledDefenseCore = DefenseCoreRaw * 0.50

DefenseValue = ScaledDefenseCore + WeaponDefense + ArmorValue
```

**Armor Value:**

```text
ArmorValue = sum of Armor from all equipped armor-bearing slots,
             excluding weapon and shield
```

- ArmorValue remains its **own, independent defensive check**, even though the same ArmorValue is
  also added to DefenseValue as a flat bonus;
- **Armor and Defense decide pass or block only.** They never numerically reduce damage that
  passes;
- **Mitigation** applies only after damage passes:
  `FinalDamage = PassedDamage * (1 - MitigationPercent)`;
- **no hidden vocation multiplier** — on Armor, on Defense or anywhere in these formulas. A
  Knight's tankiness comes from visible build and progression systems, and being the Main or a
  companion adds no multiplier either (`ADR-022` GA13).

**Still OPEN:**

- the exact ranged Accuracy system;
- the exact damage-roll distribution and minimum damage, unless separately locked;
- the exact rounding stages, where not already specified;
- the exact tie, order and visual-mapping rules, where not already locked elsewhere.

**Not stated when the formulas were locked, and so not decided here:**

- how the scores are compared — Attack Value against Defense Value, and against ArmorValue's own
  check — which the tie and order rules above complete;
- whether Skill and Shielding are base or effective values;
- ShieldDefense when no shield is carried, and inputs below the 7 that `w` and `w_def` subtract.

**Relation to the implemented engine.** The verified engine follows Canary's `Creature::blockHit`:
defence and armour each subtract a random amount from the damage, then mitigation applies. Its
maximum melee hit is Canary's `Weapons::getMaxWeaponDamage`,
`round(0.085 × attackFactor × attackValue × attackSkill + floor(level / 5))`, with `attackFactor`
1 in today's content. The locked Max Base Damage has that shape without the factor. The locked
pass/block rule replaces the subtraction.

## Vocation identity

- Knight = Tank
- Druid = Support/Healer
- Sorcerer = Elemental DPS
- Paladin = Ranged Physical/Holy DPS
- Monk = Debuff/Hybrid Support

## Equipment

`LOCKED` by the Product Owner, 2026-09-25. **Non-formula rules only** — no slot arithmetic is
decided in this section. How the equipped slots add up to Armor Value — every armour-bearing slot,
excluding the weapon and the shield — is locked with the combat formulas (*Combat formulas*,
above).

- the ordinary armour slots stay Tibia-like;
- vocations are told apart mainly by **equipment eligibility**, weapon and off-hand options,
  spells, Skill Trees, the Wheel and similar systems — **never** by a hidden per-vocation Armor or
  Defense multiplier;
- an item's requirements may restrict it by vocation or class, and by level;
- any vocation may use a **shield** where the item and the rules allow it;
- **Knight:** a one-handed weapon with a shield, or a two-handed weapon;
- **Monk:** primarily two-handed. Its final equipment identity is open;
- **Paladin:** shield-compatible throwing and spear-style options, and two-handed bows and
  crossbows;
- **mages:** a wand or rod with a shield, with a **spellbook** as the preferred and typical
  off-hand where content allows.

## Bestiary

`LOCKED` direction, Product Owner, 2026-09-25. **Not implemented** (Phase 7A).

- the **Tibia Global Bestiary** is the baseline for structure, creature characterization and
  categories, and kill-count thresholds;
- when the Bestiary phase is built, it **verifies** the then-current Tibia Global values from
  reliable sources and records the exact values it adopts. No threshold is frozen from memory
  before then;
- the Bestiary reveals useful creature knowledge — resistances and weaknesses among it — through
  progression, and supports build planning;
- the exact reveal UX and any deliberate divergence belong to the owning phase.

## Game Account, Main Character and companions

`LOCKED` by the Product Owner, 2026-09-25. **Supersedes** the roster of up to five equivalent
Characters per account that this section described until 2026-09-24. Architecture:
[`architecture/decisions/ADR-022-game-account-main-character-and-companions.md`](architecture/decisions/ADR-022-game-account-main-character-and-companions.md).
**Not implemented** — every Character in code today is a Main before Rookgaard; companions,
unlocks and the Active Party are Phase 4. **Extended** in the final synchronization of 2026-09-25
(the Login, the Game Account's name, permanent companions).

```text
LOGIN / AUTH IDENTITY  (email / authentication)
  └─ one or more GAME ACCOUNTS (campaigns), each with its own name
       ├─ exactly one MAIN CHARACTER each, once it enters the Main game
       └─ a COMPANION ROSTER of up to four permanent companions
```

- a **Login** — based on email / authentication — may own **several Game Accounts**. Each is an
  independent campaign and session identity with its **own name and display identity**. That name
  is not a Character name: the two are separate namespaces;
- each Game Account has its own Main, up to four Companions, and its own campaign, progression and
  quest state, one-time reward claims, and gameplay and economy state. Nothing of it is shared with
  another Game Account under the same Login;
- the vocation chosen on entering the Main game becomes the **Main's** vocation, and the other four
  vocations are the Game Account's possible Companions;
- an unlocked Companion is **permanent**. It can never be deleted, dismissed, removed, replaced,
  rerolled, converted into the Main or unlocked backward, and it disappears only with its whole
  Game Account (*Game Account deletion*, below);
- the Main / Companion distinction creates **no hidden combat multiplier**;

- a Game Account has exactly **one Main Character** — the player's primary created character and
  the Game Account's campaign identity. *Origin Character* in older documents and in code is the
  Main before it proceeds to the Mainland: the Game Account's vocationless Rookgaard character,
  which becomes the Main on entering the Main game (*Rookgaard*, below);
- further vocation actors are unlocked as **companions**, members of the Game Account's roster. A
  companion is **not** an account-lifecycle Character equivalent to the Main: it does not replace
  the Main, and it has no deletion or tutorial semantics of its own. Deletion is the whole Game
  Account's (*Game Account deletion*, below);
- the five vocation identities remain Knight, Druid, Sorcerer, Paladin and Monk;
- a player who wants a different Main vocation may use **another Game Account** under the same
  login identity, subject to later account-management design;
- wherever a document says *Account*, it means the **Game Account** — its Bank, Depot, Stash,
  tutorial completion, reward-claim state and roster. The login identity is a separate level above
  it, and how it is stored is the owning phase's choice. It must exist apart from the Game Account
  before the first purge, because the Login survives one
  ([`ADR-024`](architecture/decisions/ADR-024-game-account-deletion-grace-and-purge.md) §5).

**Carried over, unchanged** — each was locked before and nothing above contradicts it:

- at most **one roster member per vocation**: the Main and every companion hold distinct
  vocations, so a Game Account has at most four companions. A vocation the Main or a companion
  holds is not offered as an unlock;
- companions are unlocked with in-game **Gold**, not with Premium. An unlock is permanent and never
  refunded; exact costs and any other prerequisite remain OPEN;
- a newly unlocked companion starts at Base Level 8, never enters Rookgaard, receives no catch-up
  levels, and has its own vocation, Base Level, Base XP and Skills.

**OPEN, because this decision makes them ambiguous** (`ADR-022` §4,
[`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md)): companion custody, Stamina and occupancy; whether a
companion's name is chosen by the player; how a low-level companion levels when the Main is always
present; whether entitlements and sessions belong to the login identity or to each Game Account;
whether Game Account names are unique; whether a later Game Account may skip the guided tutorial;
and how Game Accounts are created, listed and switched. **No longer open:** a companion's lifecycle
— it is permanent — and what deleting the Main does to its companions and its Game Account: the
Game Account is what is deleted. Where an older rule below says *Character* about any roster member
— occupancy, Stamina, Shared XP, per-Character custody — it now applies to the Main, and to a
companion only once Phase 4 specifies it.

## Rookgaard

`LOCKED` by the Product Owner, 2026-09-25, final synchronization. Design:
[`design/tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md`](design/tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md).

- Rookgaard is a **full playable region**, and indefinite **Rookstaying** is allowed. The
  tutorial's Level 8 event offers the vocation and the journey to the Mainland; it does not end
  Rookgaard;
- Rookgaard has no vocation, no Companions, no Main-game Party and no Main-game multiplayer or
  co-op. It is **single-player**;
- a Game Account's character begins there **vocationless**, and stays vocationless, with no
  Companions, for as long as the player remains;
- on proceeding to the **Mainland**, the player selects the **Main vocation** there, and the other
  four vocations become the Game Account's possible Companions.

OPEN: whether a player who has stayed may still leave later, what Rookgaard offers a Rookstayer
beyond Level 8, and whether the Level 8 event still interrupts a running Hunt
(`TUTORIAL_ROOKGAARD_ROADMAP.md` §43).

## Personal Active Party

> **Scope: the PERSONAL Active Party — the actors of ONE Game Account.** None of these rules is a
> statement about several humans sharing an Activity (*Human multiplayer*, below).

`LOCKED` by the Product Owner, 2026-09-25:

- a personal or solo Hunt belongs to one Game Account;
- the **Main Character is always present**. Up to **three companions** may join it: at most
  **four** combat actors, minimum one — the Main alone;
- the player may reorder the formation. Slot 1 is the **Frontline**, and the Main need not hold
  it;
- one player controls the whole personal party; **there is no multi-human personal party**;
- five simultaneous active actors of one Game Account do not exist, and Premium never creates a
  fifth;
- roster companions outside the Active Party do not fight and do not receive Shared XP;
- unlocking a companion never forces it into the Active Party;
- one Game Account's session owns the whole Active Party, so the 5-minute reconnect grace pauses
  the entire party activity.

## Human multiplayer — one selected actor per Game Account

`LOCKED` by the Product Owner, 2026-09-25:

- in human multiplayer or co-op, several human Game Accounts share **one** multiplayer Activity;
- each participating Game Account selects **exactly one** eligible combat actor from its unlocked
  roster — its **Main or any unlocked companion**. The Main is **not** mandatory in multiplayer;
- the personal four-actor Active Party **never** enters multiplayer as a block;
- changing the selected actor never creates another account, another reward entitlement or another
  completion identity.

Unchanged: the first cooperative quest takes **up to five humans, one selected actor per Game
Account**; the Warzone scale stays tentative and benchmark-driven; the lobby strategy and
frozen-plan architecture remain in force
([`design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md),
[`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md)).

### Shared XP eligibility

Evaluated across the **entire** Active Party — the Main and its active companions — using only the
highest and lowest active Base Levels:

```text
minimumShareLevel = ceil(highestLevel × 2 / 3)

level-eligible when   lowestLevel >= minimumShareLevel
```

- one out-of-range active member makes the whole formation fail eligibility;
- a newly unlocked Level-8 companion receives **no** exception;
- Tibia Global's Shared Experience metrics are the reference direction for the bonus and
  distribution table, but the exact adopted values must be verified and documented before
  implementation, never invented;
- how XP is allocated when a multi-actor formation is *not* Shared-XP eligible is OPEN — and matters
  more now that the Main is always present (`ADR-022` GA-O6).

## Game Account deletion

`LOCKED` by the Product Owner, 2026-09-25, in the final synchronization. The deletion target is
the **Game Account**. This **supersedes** the Character deletion of 2026-09-24, as amended on
2026-09-25, wherever it depended on a Character being deleted while its Account lived on
(*Superseded*, below). Architecture:
[`architecture/decisions/ADR-024-game-account-deletion-grace-and-purge.md`](architecture/decisions/ADR-024-game-account-deletion-grace-and-purge.md),
which reuses the lifecycle mechanics of
[`ADR-020`](architecture/decisions/ADR-020-character-deletion-grace-and-purge.md). Owning gate:
PRE-PHASE-4, [`PHASE_GATES.md`](PHASE_GATES.md) § *G4.1*. **Not implemented** — the code still
carries the retirement model (`ADR-007`, `SUPERSEDED`) until that gate's implementation replaces
it.

```text
LOGIN                    survives; its other Game Accounts are untouched
  └─ GAME ACCOUNT  ACTIVE
       -> PENDING_DELETION  exactly 720 elapsed hours; the WHOLE Game Account frozen
            -> restored exactly as it was, if the player reverses it before purgeAt
            -> PERMANENTLY PURGED at purgeAt: the Main, every Companion and everything
               the Game Account owns; an internal history record remains
```

- the deletion target is the **Game Account** — the whole campaign. The **Login** survives, and
  every other Game Account under it is unaffected;
- the lifecycle is `ACTIVE` → `PENDING_DELETION` → exactly **720 elapsed hours** → hard purge,
  unless restored. `purgeAt` is stored and fixed on the authoritative server clock; there are no
  time-zone or calendar-day semantics;
- a deletion is not immediately destructive. Until `purgeAt` the player may restore the Game
  Account, which returns **exactly as it was when the deletion was accepted** — no catch-up and no
  offline recovery for the pending time;
- the **whole Game Account is frozen** during the grace: no Hunt, no Training, no XP, no Skill
  progression, no Stamina or other elapsed-time recovery, no item move or use, no currency
  mutation — the Bank included — no quest or reward mutation, no companion unlock, no Character
  creation and no bound-item grant;
- at `now ≥ purgeAt` restore is forbidden and the purge is due at once. A failed purge is a
  degraded, frozen condition, never an extension: the names stay reserved, retry is automatic,
  and the condition is visible and alerting. The purge is idempotent;
- the purge removes **all live Game Account state**, as applicable: the Main, every Companion,
  progression, skills, vocation and campaign state and Party state; equipment and items,
  containers, Store Containers, and the live state of the Loot Pouch and the Gold Pouch; quest and
  progression state, reward claims, tutorial and campaign state; and every other live object
  scoped to the Game Account or its actors — which includes its Bank, its Depot and its Stash;
- nothing transfers to another Game Account, and nothing becomes Login-level value;
- a purged Game Account is gone. A new campaign requires a **new Game Account**: nothing creates a
  replacement Main inside a deleted one;
- a Companion disappears only with its whole Game Account;
- there is **one lifecycle for every deletion source** — a player's request, a rules or moderation
  action — with the same 720-hour grace and the same purge. There is **no instant moderation
  purge**, and no second deletion model or bypass. Who may start and who may restore a moderation
  deletion is OPEN (`ADR-024` DEL-O3);
- ordinary append-only and audit guarantees stay in force during play. The purge is a deliberate,
  explicitly designed destructive boundary.

Nothing further is inferred from how any other game handles deletion.

### Names

- Character names are **globally unique** across the entire game and database. This supersedes
  the per-account uniqueness Phase 1 implemented;
- while a Game Account is `PENDING_DELETION`, all of its Character names — the Main's and every
  Companion's — stay **globally reserved**. Only a successful purge releases them;
- historical records never reserve a name;
- Game Account display names are a **different namespace** from Character names. Whether they must
  be unique is OPEN (`ADR-022` GA-O11).

### Deletion history

- there is **no public Deleted List**;
- a purge leaves an **internal history record, for support**. It may keep the Game Account
  reference, the deletion and purge dates, the Main's name, vocation and level, each Companion's
  name, vocation and level, and a broad campaign summary;
- it is **not** required to record Gold destroyed, Pouch value destroyed, destroyed item value or
  count, or economy-sink totals. The Pouches' live state is simply purged;
- the record is never live ownership, custody, restoration state, name reservation, reward-claim
  state or uniqueness state;
- balance telemetry — XP production, hunt efficiency, loot and drop generation, item creation and
  destruction, deleted Characters and balance analysis — stays a **game-wide direction**, recorded
  by each gameplay or economy phase for what it introduces (`ADR-020` DH6). The deletion lifecycle
  builds none of it, and a purge must not corrupt durable audit or analytics data that already
  exists.

### Superseded — Character deletion, 2026-09-24 and its 2026-09-25 amendments

These rules deleted a **Character** while its Account lived on. They are kept as history in
`ADR-020`, whose lifecycle mechanics `ADR-024` reuses:

- the Character as the deletion target, and Account-owned state surviving its deletion;
- G4.1b — a pending Character holding its vocation, its roster place and the Origin slot, so that
  no replacement could take them;
- G4.1c — tutorial completion surviving the Origin Character's purge, the later-character flow
  after a purge, and a pre-completion replacement Origin Character with a fresh **Bootstrap Kit**;
- the public Deleted List, with its broad reason category, and a purge manifest of what was
  destroyed;
- names unique per account.

What carries into the Game Account rule unchanged: the 720-hour grace, the full freeze and exact
restore, the failed-purge condition, idempotence, release of names only by the purge, and that
nothing survives a purge into a bank or a recovery custody. G4.1a — the Gold Pouch kept intact
through the grace and destroyed at the purge, never moved to the Bank — holds within the Game
Account purge, which destroys the Bank as well.

## Tutorial starting items

`LOCKED` by the Product Owner, 2026-09-25, final synchronization. **Supersedes** the Bootstrap
Kit (2026-09-24) and the open question of how the starter gear is represented.

- the Rookgaard **starter gear** — armour, dagger and backpack — is **ordinary, low-value items**.
  It has no special Character-bound model and no special anti-duplication custody. It becomes
  obsolete and may be discarded, and a player who stays in Rookgaard may keep using it;
- the tutorial's **Health and Mana potions** are **Character-bound consumables**
  (*Character-bound consumables and the Store Container*, below). They use the **same
  `ItemDefinition`** as the ordinary potion: the binding is on the **instance**, not on the effect.
  They are permanently bound to the Character that received them, and may live in its Store
  Container;
- they are used through the **tactical action slots** (below). A configured slot may consume an
  eligible bound potion directly from the Store Container, by its own rule or threshold; the potion
  never has to move to a Hunt Container;
- Canary's `UNIQUEID` and `ACTIONID` are **not** a Character-ownership or binding system. A binding
  is never encoded through them. The durable binding relation or attribute on the instance stays,
  and its physical schema is an implementation choice;
- the current direction is **20 Health and 20 Mana potions**; neither quantity is final while combat
  balance is calibrated. The content still grants 20 small health potions in the backpack, unbound,
  and no mana potion. Which phase first issues them as bound instances is OPEN (`ADR-024` DEL-O5);
- a quest reward is never bound because it came from a quest: the tutorial's **Doublet is an
  ordinary item** (*Quests*, above). Whether the Doublet Quest can be replayed, and whether its
  chest is a one-time Tutorial Reward, are **OPEN** (`TUTORIAL_ROOKGAARD_ROADMAP.md` §43). If the
  chest is one-time, it is claimed once per Game Account.

## Tactical action slots

`LOCKED` direction, Product Owner, 2026-09-25. **Not implemented** — the tactical policy
primitives are Phase 4's.

- the tactical **action-slot** system has Health Potion, Mana Potion, Healing Spell and Attack
  Spell slots, with Rune and other tactical slots later;
- a configured slot acts by its own rule or threshold;
- a slot may consume an eligible **Character-bound potion directly from the Store Container**.
  Ordinary potions are still carried in Hunt Containers, as Phase 3 built them.

OPEN (Phase 4): each slot's exact rules and thresholds, and which source a slot draws from first
when the Store Container and the carried supplies both hold an eligible potion.

## Character activity occupancy

- a Character may perform only **one** primary gameplay/progression action at a time;
- the same Character cannot Hunt and Skill Train simultaneously, and cannot be in two
  activities;
- **different** Characters on the same account may act concurrently. *Under `ADR-022` the Main is
  the only such Character; whether a companion outside the Active Party may act on its own while
  the Main hunts is OPEN (GA-O5);*
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
- offline, idle, menus, hubs, Market and Atlas all recover **while the Character is not reserved
  in a Stamina-consuming Hunt lifecycle**;
- **reconnect grace is neutral**: a Hunt paused in the 5-minute grace is a *reserved* Hunt state,
  and it neither consumes nor recovers Stamina. "Offline recovers" does not extend to it. This
  prevents a deliberate disconnect/reconnect cycle from becoming a Stamina regeneration exploit;
- the **pre-consumption Hunt state** — in a Hunt, no qualifying XP yet — is neutral for the same
  reason;
- **Premium: 1 minute of eligible time = +1 minute** (1:1);
- **Free: 2 minutes of eligible time = +1 minute** (1:2);
- capped at 42:00; there is no mandatory waiting period;
- every activity type must declare whether it consumes Stamina;
- a Character of a **`PENDING_DELETION` Game Account recovers nothing**: the deletion grace is a
  full freeze, and a restore credits nothing for the pending time (*Game Account deletion*);
- Stamina per Character applies to the Main; whether each companion has its own Stamina is OPEN
  (`ADR-022` GA-O4).

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
- Powerful Imbuements require completing **exactly five** configured boss completions of the
  approved quest/progression chain. The count is locked; the identities of those five bosses
  remain open content design.

## Free/Premium

- **Premium is an Account-wide entitlement**, not a Character one. Every actor of the account — the
  Main and its companions — receives applicable benefits. *Account* here is the Game Account, as
  implemented; whether Premium should instead attach to the login identity and cover all its Game
  Accounts is OPEN (`ADR-022` GA-O8);
- a Premium transition splits an unsettled interval at the transition boundary; already-settled
  time is never retroactively rewritten;
- companions are unlocked with in-game **Gold**, not with Premium;
- Premium must not create a fifth simultaneous Active Party member;
- Party-related Premium benefits are OPEN and require separate product design;
- Premium emphasis = automation/convenience/capacity;
- Free must remain competitive;
- the Store does **not** sell combat equipment for real-money or premium-currency value. Its
  Character-bound items are consumables — see below.

## Economy

- Gold Market;
- Premium Currency Market;
- economy integrity is critical;
- Market must be transactional and use escrow;
- a Character-bound consumable is never listed on either Market — see below;
- one-time reward claims are per Game Account, and one Login may own several Game Accounts. Whether
  and how a tradeable one-time reward farmed across several Game Accounts is limited is OPEN, for
  the phase that introduces player trade (Phase 6).

## Character-bound consumables and the Store Container

`LOCKED` by the Product Owner, 2026-09-24. Architecture:
[`architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md`](architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md).
**Not implemented** — owned by the first phase that introduces one (`PHASE_GATES.md` § *GBC.1*).
Since 2026-09-25 that may be the tutorial's own potions. Which phase first issues them as bound
instances — PRE-4, or the phase that builds the action slots — is **OPEN** (`ADR-024` DEL-O5).

The Product Owner may call them *"Unique Items"*; the technical term is **Character-bound
consumable**, because every `ItemInstance` is already unique by identity. A Character-bound
consumable is a consumable permanently bound to one Character — for example XP Boosts, Exercise
Weapons bought with Store Coin or premium currency, Daily Reward consumables, Event consumables,
the **tutorial's utility consumables** (2026-09-25), and other consumables explicitly configured
the same way.

**Scope.**

- the Character-bound Store system is for **consumables**, not combat equipment. Combat equipment
  is **not** sold through the Store for real-money or premium-currency value;
- an Exercise Weapon belongs here because it is a charge-based training consumable, not because it
  is combat equipment;
- **outfits and mounts are outside this model.** They get their own cosmetic unlock or
  entitlement design;
- acquisition source and binding are separate: a Store, Daily Reward or Event source makes an item
  bound only when its item or reward definition says so.

**Binding.**

- a bound item has one immutable bound Character. Where it is stored is not whose it is: moving it
  to the Account's Depot neither removes nor changes the binding;
- no other Character — the same Account's included — can withdraw, use, receive, trade, consume or
  otherwise take control of it;
- the binding can never be removed, reassigned, sold, gifted or converted.

**The Store Container.** Every Character may have one: a system custody, not a physical backpack,
not one of the five Hunt Container Slots — it consumes none of them — not equipment and not the
Loot Pouch. Its capacity is not decided.

**Custody.** The only ordinary storage movement of a Character-bound consumable is between its
bound Character's Store Container and the Account's Depot. In the Depot it is still the
Character's. It never moves to a Hunt Container, a Character container, the Loot Pouch, the Stash,
another Character, Market escrow, any trade, mail, gift or social-transfer custody, a Forge input,
or an equipment slot.

**Use.** Only its bound Character may use it, by the item's own use rule. Using it consumes it or
spends its charges; that is not a custody transfer. Every use checks, on the server, that the caller
owns the Account, that the target Character is the bound Character and is `ACTIVE` and eligible,
and that no output becomes transferable Account value. A bound potion is used through the tactical
action slots, straight from the Store Container (*Tactical action slots*, above; `ADR-021` U5).
Canary's `UNIQUEID` and `ACTIONID` never encode a binding (`ADR-021` B6).

**Never:** listed on either Market; sold to or bought from another player; traded, gifted, mailed or
moved through any social or exchange interaction; sold to an NPC or counter; converted into Gold,
premium currency or any other transferable value; used as a Forge input; moved to the Stash;
transferred to another Character. These rules are server-authoritative — hiding an action in the
UI is never the boundary.

**Death.** Stored only in the Store Container or the Depot, it is outside the Loot Pouch's
death-at-risk path: ordinary death neither destroys nor drops it.

**Deletion.** While its Game Account is `PENDING_DELETION`, a Character's Store Container and its
bound items stay intact and restorable: no Store Container ↔ Depot movement, no use, and no new
bound grant to it; a restore returns them exactly. At the final purge the whole Game Account goes
(*Game Account deletion*): its Store Containers and every item it owns, **bound items stored in
the Depot included**, and unbound ones too. None of them transfers, becomes unbound, moves to the
Stash or another Game Account, refunds Store Coin or premium currency, or converts into any value.
The internal history record owns and binds nothing.

*Until the final synchronization a purge deleted one Character, so a bound Depot item was deleted
while an unbound one was kept as the Account's. Since `ADR-024` the Game Account's Depot goes
with it, and that distinction no longer arises at a purge. The binding still decides who may use
or move an item.*

Open, and not decided here: the Store Container's capacity, sorting or subcontainers; Store Coin
pricing; which Daily Rewards and Events grant bound items; XP Boost numbers and durations; Exercise
Weapon Store pricing and charges; the use UI for items that are not used through an action slot;
the outfit and mount unlock model; which phase first issues the tutorial potions as bound
instances; and the final tutorial potion quantities — see
[`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) § *Character-bound consumables*.

## Tunable configuration

`LOCKED` direction, Product Owner, 2026-09-25. Architecture:
[`architecture/decisions/ADR-025-tunable-configuration-surface.md`](architecture/decisions/ADR-025-tunable-configuration-surface.md).
**Not implemented** — its first form is the PRE-PHASE-4 gate's (`PHASE_GATES.md` § *G4.5*).

- PROVISIONAL and TUNABLE defaults live in **one authoritative server-side configuration
  surface** — the purpose Canary's `config.lua` and its stages serve, though not necessarily Lua.
  Examples: companion unlock prices, Shared XP bonuses, boss cooldowns, rates, training
  multipliers, costs, thresholds and temporary limits;
- its values have validated types and ranges, are versioned and traceable and server-authoritative,
  and have safe defaults and test fixtures;
- **never configuration:** ownership; the relation between a Login and its Game Accounts; the
  identity of the Main and of each Companion; exactly-once claims; global name uniqueness; binding
  integrity; the atomic deletion and purge guarantees; transaction semantics; security and
  authority boundaries.

## Engineering process

- Architect -> Builder -> Independent Reviewer.
- Same agent should not be sole final reviewer of its own major implementation.
