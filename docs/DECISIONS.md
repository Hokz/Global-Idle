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

`LOCKED` by the Product Owner, 2026-09-25. Architecture:
[`architecture/decisions/ADR-023-quest-replay-and-one-time-reward-claims.md`](architecture/decisions/ADR-023-quest-replay-and-one-time-reward-claims.md).
**Not implemented** — no quest, dungeon or chest exists yet (Phase 5).

**Content access and replay** and **one-time reward claims** are separate. A quest is never
*"one-time"* in the sense of being inaccessible after completion:

- a quest — a multiplayer quest included — may be run again. Its boss rooms may be repeated, its
  hunt areas stay usable under the content's access rules, a player may help other groups again,
  and a Game Account may select a different actor — its Main or a companion — on a later run;
- none of that re-enables a one-time reward. A quest's **final or primary reward chest is one-time
  per Game Account** (campaign);
- not yet claimed: opening the eligible chest grants the reward exactly once, and the
  authoritative claim state becomes `CLAIMED`. Already claimed: opening it grants nothing a second
  time, and the UI may show the chest as empty;
- the claim state belongs to the **Game Account**, never to the selected actor, so choosing the
  Main or a companion never resets it;
- quest completion and progression state and reward-claim state are never conflated, because
  content is replayable;
- the claim is a typed reward-claim concept, settled exactly once under retry and concurrency —
  never scattered, untyped storage flags. Its physical representation is the implementing phase's;
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
formula, rounding stage or balance number is decided here (*Combat formulas*, below).

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

### Combat formulas — OPEN

The combat formula revision discussed after PR #13 head `86a7681` is **not** decided: attack
coefficients, the minimum and maximum auto-attack formulas, whether Canary's coefficient is
adopted, the starting Skill value, the Defense score and its roll, the Armor roll, the rounding
stages of the combat pipeline, skill scaling, and any balance target derived from them. It is
handled separately. The formulas Phases 2–3.6 implemented and verified are unchanged.

## Vocation identity

- Knight = Tank
- Druid = Support/Healer
- Sorcerer = Elemental DPS
- Paladin = Ranged Physical/Holy DPS
- Monk = Debuff/Hybrid Support

## Equipment

`LOCKED` by the Product Owner, 2026-09-25. **Non-formula rules only** — no slot arithmetic is
decided here.

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
unlocks and the Active Party are Phase 4.

```text
LOGIN / AUTH IDENTITY
  └─ one or more GAME ACCOUNTS (campaigns)
       ├─ exactly one MAIN CHARACTER each
       └─ a COMPANION ROSTER
```

- a Game Account has exactly **one Main Character** — the player's primary created character and
  the Game Account's campaign identity. *Origin Character* in older documents and in code is the
  Main before it completes Rookgaard;
- further vocation actors are unlocked as **companions**, members of the Game Account's roster. A
  companion is **not** an account-lifecycle Character equivalent to the Main: it does not replace
  the Main, and it does not carry the Main's deletion or tutorial semantics;
- the five vocation identities remain Knight, Druid, Sorcerer, Paladin and Monk;
- a player who wants a different Main vocation may use **another Game Account** under the same
  login identity, subject to later account-management design;
- wherever a document says *Account*, it means the **Game Account** — its Bank, Depot, Stash,
  tutorial completion, reward-claim state and roster. The login identity is a separate level above
  it, and how it is stored is the owning phase's choice.

**Carried over, unchanged** — each was locked before and nothing above contradicts it:

- at most **one roster member per vocation**: the Main and every companion hold distinct
  vocations, so a Game Account has at most four companions. A vocation the Main or a companion
  holds is not offered as an unlock;
- companions are unlocked with in-game **Gold**, not with Premium. An unlock is permanent and never
  refunded; exact costs and any other prerequisite remain OPEN;
- a newly unlocked companion starts at Base Level 8, never enters Rookgaard, receives no catch-up
  levels, and has its own vocation, Base Level, Base XP and Skills.

**OPEN, because this decision makes them ambiguous** (`ADR-022` §4,
[`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md)): a companion's own lifecycle; what happens to the
companions and to the Game Account when the Main is deleted or purged; companion custody, Stamina,
occupancy and names; how a low-level companion levels when the Main is always present; and whether
entitlements and sessions belong to the login identity or to each Game Account. Where an older rule
below says *Character* about any roster member — occupancy, Stamina, Shared XP, per-Character
custody — it now applies to the Main, and to a companion only once Phase 4 specifies it.

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

## Character deletion

`LOCKED` by the Product Owner, 2026-09-24, and **amended 2026-09-25** (720 hours, the full freeze,
the historical record and the public Deleted List, below). **Supersedes retirement** (`ADR-007`,
now `SUPERSEDED`). Architecture:
[`architecture/decisions/ADR-020-character-deletion-grace-and-purge.md`](architecture/decisions/ADR-020-character-deletion-grace-and-purge.md).
Owning gate: PRE-PHASE-4, [`PHASE_GATES.md`](PHASE_GATES.md) § *G4.1*. **Not implemented** — the
code still carries the retirement model until that gate's implementation replaces it.

Since 2026-09-25 the Character these rules delete is the **Main Character** (`ADR-022`).
Companions are not account-lifecycle Characters of its kind, and how deletion reaches them — and
what becomes of the Game Account when its only Main is purged — is **OPEN** for the PRE-4
specification (`ADR-020` §5.3).

```text
ACTIVE
  -> PENDING_DELETION for 30 days = exactly 720 elapsed hours, fully frozen
       -> restored, if the player reverses the decision before purgeAt
       -> PERMANENTLY PURGED at purgeAt; an immutable historical record remains
```

- a player-requested deletion is **not** immediately destructive;
- for exactly 30 days after the request, the Character and everything needed to restore it
  remain intact, and the player may reverse the deletion and recover the Character;
- **30 days is exactly 720 elapsed hours** from the accepted request, on the authoritative server
  clock. `purgeAt` is stored and fixed; there are no time-zone or calendar-day semantics
  (2026-09-25);
- the Character's **name stays reserved** throughout the 30 days;
- when the 30 days expire, deletion is **final and irreversible**;
- the final purge removes the Character row and **all** Character-owned state, value and data:
  progression, skills, Stamina, equipment, inventory, Hunt containers and their contents, the Loot
  Pouch, the **Gold Pouch** balance and its Character-scoped ledger history, Character policies
  and configuration, Character-specific activity and run history, and every other row whose sole
  owner or subject is that Character;
- nothing Character-owned moves to a recovery custody or to the Account Bank. Character-owned
  value that still exists at purge time is **destroyed** with the Character;
- after the purge, the name is available for creation again;
- ~~no Character record survives to keep the deleted Character as history or audit state, and no
  surviving account-wide or shared record keeps its identity, name or id for convenience~~ —
  **superseded 2026-09-25** by the historical record and the public Deleted List, below;
- **Account-owned state is never deleted because a Character is**: the Account, its Bank, its
  entitlements, its roster capacity and other account-wide state remain. (Roster capacity is
  also never refunded — a Phase 0A decision, `DOMAIN_MODEL.md` §5.4.) A Character-bound
  consumable is not Account state, even in the Depot: it is purged with its Character — see
  *Character-bound consumables and the Store Container*, below;
- ordinary append-only and audit guarantees stay in force during play. The purge is a deliberate,
  explicitly designed destructive boundary.

Nothing further is inferred from how any other game handles deletion.

### The grace is a full freeze — 2026-09-25

The Product Owner delegated the safety architecture and approved this direction:

- a deletion **copies nothing**. The same authoritative gameplay Character stays persisted and is
  marked `PENDING_DELETION`; there is no second, restorable copy;
- while pending it is **fully frozen**: no Hunt, no Training, no XP, no Skill progression, **no
  Stamina recovery**, no other elapsed-time gameplay recovery, no item move or use, no currency
  mutation, no quest mutation, no reward grant and no bound-item grant;
- restore works only while `now < purgeAt`. It reactivates the same persisted state and returns it
  **exactly as it was when the deletion was accepted** — no reconstruction from a copied snapshot,
  no catch-up and no offline recovery for the pending time;
- at `now ≥ purgeAt` restore is forbidden and the purge is immediately due. A failed purge is a
  degraded, frozen condition, never an extension: the name stays reserved until the purge
  succeeds, retry is automatic, and the condition is visible and alerting;
- the purge is idempotent: a retry cannot double-settle, double-delete value, re-grant, refund or
  duplicate anything. After a successful purge the gameplay state cannot be restored;
- the name is released only by the successful final purge and may then be reused. A historical
  deletion record never reserves it.

### Deletion history, the public Deleted List and analytics — 2026-09-25

The rules that required a purge to leave no identity behind are **superseded**:

- a successful purge removes the **live, restorable** gameplay Character, and an **immutable
  historical deletion record** survives for audit, moderation and analytics. It can never restore
  gameplay;
- a **public Deleted List** shows the former Character's name, vocation, level at the
  deletion/purge snapshot, the deletion/purge date, and a broad reason category that tells a
  voluntary deletion from a rules or moderation deletion. Detailed internal moderation reasons are
  not automatically public;
- the internal deletion audit keeps enough immutable history to answer what was deleted and to
  support anti-duplication, operations and balance analytics — preferably a purge manifest
  (deletion snapshot) plus analytics facts, never old live gameplay rows left restorable;
- historical records may keep identifying fields internally: the Product Owner asked for named
  history. They never take part in live ownership or custody, or in any gameplay uniqueness rule;
- analytics are preserved or collected for XP production, hunt efficiency, loot and drop
  generation, item creation and destruction, deleted Characters, and balance analysis.

### What a pending Character still holds — G4.1b

`LOCKED` by the Product Owner, 2026-09-24. A `PENDING_DELETION` Character keeps every uniqueness
and capacity resource its guaranteed restoration needs, until the final purge:

- it continues to count against `rosterCapacity`;
- its **vocation** remains reserved;
- if it is the Origin Character, the **Origin slot** remains reserved;
- the player cannot create a replacement Character that would consume any of those held
  resources;
- those resources are released **only** by the successful final purge, in the same atomic commit
  that deletes the Character and releases its name;
- a restore before the deadline therefore never depends on freeing or reclaiming a resource, and
  never fails because the player created a replacement;
- the name follows the rule above, unchanged.

Consequences, all intended: an account at roster capacity 1 that deletes its only Character cannot
create another during the 30-day grace, and can restore the pending one at any time before the
deadline; no same-vocation replacement — and, when the pending Character is the Origin Character,
no second Origin Character — can be created before the purge.
Roster capacity stays Account-owned, and is neither reduced nor refunded by a deletion or a purge.

*Read under `ADR-022` (2026-09-25):* the pending Character is the Game Account's Main. It stays the
Main through the grace — its name, its vocation and its Main slot (the *Origin slot*) stay reserved
and nothing can replace it — so these rules hold unchanged for it. Whether anything may take them
after the purge, and what happens to its companions meanwhile, is OPEN (`ADR-020` §5.3).

### Tutorial completion and one-time grants after a purge — G4.1c

`LOCKED` by the Product Owner, 2026-09-24. Tutorial completion belongs to the **Account**, not to
the lifetime of the Origin Character:

- completing the initial Rookgaard tutorial journey marks the account as having completed it;
- deleting or permanently purging the Origin Character does **not** reset that account-level
  state;
- once the account has completed Rookgaard, a Character created after a purge does **not** restart
  the first-character tutorial automatically. It follows the normal later-character flow above:
  Base Level 8, no Rookgaard, the post-Rookgaard game state;
- one-time account or tutorial starting grants are **not** awarded again merely because the Origin
  Character was deleted or purged and another Character was created. *Delete → purge → recreate*
  cannot farm starting items, Gold, containers, entitlements, tutorial rewards or any other
  one-time account grant. The Bootstrap Kit below is not such a grant, and it cannot be farmed
  either;
- Character-specific starting state that is legitimately part of the normal Level-8
  later-character flow may still be granted by that flow. It is not a one-time grant, and the two
  are never conflated;
- the Origin Character is historical only as a role while it exists. After its purge there is no
  residual Character record; the account-level tutorial-completion fact is the only thing that
  survives for this purpose. *(Since 2026-09-25 that means no live record: the immutable historical
  deletion record is history, not a Character, and plays no part in tutorial routing.)*

*Read under `ADR-022` (2026-09-25):* tutorial completion and one-time reward state belong to the
**Game Account**, and every rule above about them stands. The rules about *"a Character created
after a purge"* describe a **replacement Main**, and whether a Game Account may create one after
its Main is purged is OPEN (`ADR-020` §5.3). If it may, they say how it starts.

### Before Rookgaard is complete — the Bootstrap Kit (G4.1c)

`LOCKED` by the Product Owner, 2026-09-24. If the Origin Character is permanently purged **before**
the account completes Rookgaard:

- the next Character created is a **new Origin Character**, at Base Level 1, and it must complete
  the mandatory Rookgaard tutorial journey;
- it receives a fresh **Bootstrap Kit**, sufficient to make the tutorial playable;
- the Bootstrap Kit is **not** a one-time Account reward. It may be issued again to a new
  pre-completion Origin Character after the previous one was permanently purged;
- Bootstrap Kit items are non-exploitable. They cannot be moved to the Depot or the Stash,
  transferred to another Character, traded or listed, sold or converted into Gold or any other
  Account-wide value, or used to generate durable Account-wide rewards or value outside the
  tutorial flow;
- if that Origin Character is later purged, its Bootstrap Kit is purged with it, and the
  replacement Origin Character receives a new, clean kit, so the tutorial stays playable.

**Tutorial Rewards are not the Bootstrap Kit.** Tutorial Rewards are real rewards or durable
Account-level benefits. They are governed by Account-level completion and reward state, stay
one-time where defined as one-time, are never reissued merely because a Character was deleted or
purged, and cannot be farmed through *delete → purge → recreate*. The two are never conflated:

| | Bootstrap Kit | Tutorial Rewards |
|---|---|---|
| purpose | make the mandatory Level-1 tutorial playable | reward progression and completion |
| issued again | to each new pre-completion Origin Character | never because a Character was purged |
| bound to | its Character: non-transferable, non-monetizable | the Account's completion and reward state |
| at the purge | destroyed with the Character | the Account's reward state survives |

```text
Account has NOT completed Rookgaard:  Origin purged -> new Origin, Base Level 1 -> Rookgaard
                                      mandatory -> fresh Bootstrap Kit -> no replay of any
                                      already-consumed one-time Account reward
Account HAS completed Rookgaard:      Origin or later Character purged -> later-character flow,
                                      Base Level 8, skips Rookgaard -> only legitimate
                                      Character-specific Level-8 starting state -> no one-time
                                      Account or tutorial reward repeated
```

Issuing the kit again is not farming: a kit can never leave its Character or become value, and it
is destroyed with that Character, so repeated cycles accumulate nothing.

**Not implemented.** The Account has no tutorial-completion or reward state yet, and nothing binds
a kit: the code gives every Character the same starting grant, whose items can be moved to the
Depot, and whose potions can be stowed in the Stash. The PRE-4 gate
([`PHASE_GATES.md`](PHASE_GATES.md) § *G4.1*) changes that, with the purge and never after it. The
current grant is classified item by item in `ADR-020` §5.2.

**The tutorial's items — 2026-09-25.**

- tutorial utility consumables — its Health and Mana potions — are **Character-bound** and use the
  **Store Container** model (*Character-bound consumables*, below). They are not a Tutorial Reward,
  and their binding never ends. Like every bound consumable they may rest in the Depot, still
  bound, so the kit rule above that keeps kit items out of the Depot now concerns the gear. The
  current direction is **20 Health and 20 Mana potions**; neither quantity is final while combat
  balance is calibrated. The content still grants 20 small health potions in the backpack and no
  mana potion;
- the tutorial's **starter combat gear** — armour, dagger, backpack — must be equipped and used in
  Rookgaard. The Store Container model is for consumables and never reaches an equipment slot, so it
  cannot hold that gear, and the Product Owner has not chosen how the gear is represented. It is
  **not** forced into that model: it is **OPEN** for the PRE-4 specification (`ADR-020` DEL-O4);
- a quest reward is never bound because it came from a quest: the tutorial's **Doublet is an
  ordinary item** (*Quests*, above). The Doublet Quest's final chest is one-time per Game Account.

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
- a **`PENDING_DELETION` Character recovers nothing**: the deletion grace is a full freeze, and a
  restore credits nothing for the pending time (*Character deletion*, 2026-09-25);
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
- a Character-bound consumable is never listed on either Market — see below.

## Character-bound consumables and the Store Container

`LOCKED` by the Product Owner, 2026-09-24. Architecture:
[`architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md`](architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md).
**Not implemented** — owned by the first phase that introduces one (`PHASE_GATES.md` § *GBC.1*).
Since 2026-09-25 that may be the tutorial's own consumables; whether PRE-4 builds this foundation
for them is **OPEN** (`ADR-020` DEL-O5).

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
and that no output becomes transferable Account value.

**Never:** listed on either Market; sold to or bought from another player; traded, gifted, mailed or
moved through any social or exchange interaction; sold to an NPC or counter; converted into Gold,
premium currency or any other transferable value; used as a Forge input; moved to the Stash;
transferred to another Character. These rules are server-authoritative — hiding an action in the
UI is never the boundary.

**Death.** Stored only in the Store Container or the Depot, it is outside the Loot Pouch's
death-at-risk path: ordinary death neither destroys nor drops it.

**Character deletion.** While the Character is `PENDING_DELETION`, its Store Container and its bound
items stay intact and restorable: no Store Container ↔ Depot movement, no use, and no new bound
grant to it; a restore returns them exactly. At the final purge the Store Container is deleted, and
so is every item bound to the Character — **including bound items stored in the Depot**. None of
them transfers, becomes unbound, stays behind in the Depot, moves to the Stash, refunds Store Coin
or premium currency, or converts into any value. The historical deletion record may list them; it
owns and binds nothing.

```text
ordinary, unbound Depot item    ->  KEEP at a purge     (the Account's)
Character-bound Depot item      ->  DELETE at a purge   (its bound Character's)
```

Open, and not decided here: the Store Container's capacity, sorting or subcontainers; Store Coin
pricing; which Daily Rewards and Events grant bound items; XP Boost numbers and durations; Exercise
Weapon Store pricing and charges; the use UI; the outfit and mount unlock model; how a Hunt uses a
bound tutorial potion held in the Store Container; and the final tutorial potion quantities — see
[`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) § *Character-bound consumables*.

## Engineering process

- Architect -> Builder -> Independent Reviewer.
- Same agent should not be sole final reviewer of its own major implementation.
