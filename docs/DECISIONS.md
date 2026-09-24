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

> **Scope of this section: the PERSONAL Active Party — the Characters of ONE account.**
> Every rule below is about that. None of them is a statement about several *humans* sharing an
> Activity: a cross-account **Expedition Group** is explicitly supported future direction, owned
> by Phase 5B. See
> [`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md) §1
> and [`design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md).
>
> This note adds the scope the wording always implied; it reverses nothing.

- one player/account controls the entire personal Party; **there is no multi-human PERSONAL
  Party**. A shared cross-account Activity is a different system, not a larger Party;
- the account **Character Roster** holds at most **5** characters;
- the **Active Party** holds at most **4** characters, minimum 1;
- five simultaneous active characters **of one account** do not exist. (A future Expedition Group
  may place five Characters in one Activity — one per account, five accounts — which is not this
  rule and does not relax it);
- at most **one roster Character per vocation** per account;
- while a Knight exists on the account — `ACTIVE` or `PENDING_DELETION` — Knight is unavailable as
  a new vocation choice. Only once that Knight is **permanently purged** (*Character deletion*,
  below) does Knight become available again;
- there is no retired or historical Character. A Character either exists — `ACTIVE`, or
  `PENDING_DELETION` during its grace — or has been purged and does not exist at all. A Character
  that exists counts against the roster in either state;
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

## Character deletion

`LOCKED` by the Product Owner, 2026-09-24. **Supersedes retirement** (`ADR-007`, now
`SUPERSEDED`). Architecture:
[`architecture/decisions/ADR-020-character-deletion-grace-and-purge.md`](architecture/decisions/ADR-020-character-deletion-grace-and-purge.md).
Owning gate: PRE-PHASE-4, [`PHASE_GATES.md`](PHASE_GATES.md) § *G4.1*. **Not implemented** — the
code still carries the retirement model until that gate's implementation replaces it.

```text
ACTIVE
  -> PENDING_DELETION for 30 days
       -> restored, if the player reverses the decision inside the 30 days
       -> PERMANENTLY PURGED, once the 30 days expire
```

- a player-requested deletion is **not** immediately destructive;
- for exactly 30 days after the request, the Character and everything needed to restore it
  remain intact, and the player may reverse the deletion and recover the Character;
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
- no Character record survives to keep the deleted Character as history or audit state, and no
  surviving account-wide or shared record keeps its identity, name or id for convenience. Where
  account integrity needs a transaction or aggregate to survive, the account-level fact survives
  **without** the Character's identity;
- **Account-owned state is never deleted because a Character is**: the Account, its Bank, its
  entitlements, its roster capacity and other account-wide state remain. (Roster capacity is
  also never refunded — a Phase 0A decision, `DOMAIN_MODEL.md` §5.4.);
- ordinary append-only and audit guarantees stay in force during play. The purge is a deliberate,
  explicitly designed destructive boundary.

Nothing further is inferred from how any other game handles deletion.

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
  one-time account grant;
- Character-specific starting state that is legitimately part of the normal Level-8
  later-character flow may still be granted by that flow. It is not a one-time grant, and the two
  are never conflated;
- the Origin Character is historical only as a role while it exists. After its purge there is no
  residual Character record; the account-level tutorial-completion fact is the only thing that
  survives for this purpose.

**Not implemented.** The Account has no tutorial-completion fact yet, and the code gives the
Rookgaard tutorial grant to every Character it creates. Both change in the PRE-4 gate
([`PHASE_GATES.md`](PHASE_GATES.md) § *G4.1*), with the purge and never after it. An Origin
Character purged **before** the account completes Rookgaard is a case these rules do not state;
the builder's reading is listed for confirmation in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md)
§ *Character deletion*.

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
- Powerful Imbuements require completing **exactly five** configured boss completions of the
  approved quest/progression chain. The count is locked; the identities of those five bosses
  remain open content design.

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
