# Phase 2 — Hunt Simulator: Implementation Specification

**Document status:** `IMPLEMENTATION_SPEC_READY`
**Phase:** 2 — the Hunt simulator, rooms, Stamina, XP, Gold, supplies, death, and the first
Game Window.
**Baseline:** Phase 0A `ARCHITECTURE_APPROVED` (ADR-001–ADR-018) · Phase 0B `VERIFIED` at
`922e1c3` · Phase 1 `IMPLEMENTATION_COMPLETE` (PR #6)
**Source evidence:** [`PHASE_2_CANARY_SOURCE_MAP.md`](./PHASE_2_CANARY_SOURCE_MAP.md) — every
number below traces to a file and a symbol in `Hokz/canary` at
`f6b81a855aa8e7e34cb98821ceb39ff97e3afa4e`.

> This document removes implementation ambiguity. Where a value could have been invented, the
> source map says where it came from instead; where Global Idle deliberately differs, it is
> labelled as a decision rather than left as a divergence.

---

## 1. Goal and non-goals

### 1.1 What a player can do when Phase 2 is complete

Enter the Rookgaard Sewers from the Atlas and **watch their Character fight**: rats appear,
the Character attacks on its own cadence, damage lands, creatures die, the room clears, the next
room opens. Ten rooms, then room 10 repeats forever. Base XP and Gold accrue and are durable.
Stamina starts burning at the first qualifying XP and not before. Supplies are consumed and run
out. The Character can die. A **backgrounded or minimised tab keeps the Hunt advancing for as long as its heartbeat
still reaches the server**; a connection that actually goes away pauses the run for exactly five
minutes and then ends it.

> **Say it precisely.** An earlier draft of this paragraph said "closing the laptop lid keeps it
> running", which claims more than the system does. What is guaranteed is the HEARTBEAT, not the
> lid: a hidden tab whose timers are throttled to about once a minute still proves liveness
> (P2-D8), and a machine that suspends stops sending anything and takes the ordinary
> liveness-plus-grace path like any other lost connection.

### 1.2 Non-goals

Phase 3 owns loot tables, `BaseItem`, `ItemInstance`, rarity, affixes, inventory, equipment and
the sell loop. **Phase 2 creates none of them**, and creates no shadow version of any of them.

Also out: the other four vocations, spells, runes, conditions, fight modes, other creatures,
other regions, Bestiary, Charms, Imbuements, Forge, the Wheel, quests, the Market, PvP, party
play, production authentication, and every UI surface except the first Game Window
(`UI_SURFACE_ARCHITECTURE.md`).

---

## 2. The simulation model

### 2.1 Ticks, and why the server does not run a loop

```text
1 tick = 1000 ms of simulated time
```

The Rat attacks every 2000 ms and the Character every 2000 ms (source map §1, §2), so a
one-second tick resolves both exactly and leaves room for a faster attacker later.

**No per-activity background loop, and nothing is decremented on a schedule.** The simulation is
advanced ON DEMAND: any read or command computes `elapsed = now − simulatedThrough`, runs
`floor(elapsed / 1000)` ticks, and commits the result in one transaction. That is ADR-015's rule
applied to combat rather than to a timer, and it is what makes the system restart-safe: the
durable state is a *position*, not a process.

**Decision P2-D1 — advance-on-read, not a per-activity worker.** A worker per activity is a
process that can die between two writes; an advance-on-read is a pure function of durable state
and the clock. The cost is that nothing happens while nobody looks, which for an online-only
activity (§8) is exactly correct: no connection, no progress.

### 2.2 Determinism

Every settlement constructs its generator from the durable seed and the tick it starts at:

```text
rng = createSeededRandom(`${activity.rngSeed}:${state.tick}`)
```

So a settlement is a pure function of `(persisted state, tick count, seed)`. A rolled-back
settlement replays identically from the same persisted tick; a restart resumes from the same
tick and produces the same future. Draw ordering inside a tick is fixed and documented in the
engine.

**Decision P2-D2 — the engine gains `simulateHunt`; `simulateActivity` is not touched.** Phase 0B's
E1/E2 pin `simulateActivity` against a committed golden file. Replacing it would break a `VERIFIED`
test to make a new phase pass. Phase 2 adds a function beside it with its own golden fixture.

### 2.3 What the engine is, and is not

`simulateHunt` lives in `@global-idle/game-engine`: **pure**, no I/O, time as a parameter, RNG
injected, content pre-resolved, and an output that DESCRIBES change rather than applying it
(ADR-010). Persistence, Stamina, Gold, the ledger and the connection lifecycle are the domain's,
not the engine's.

```ts
simulateHunt(state: HuntState, profile: CombatProfile, plan: RoomPlan, ticks: number, rng: SeededRandom): HuntStep
```

`HuntStep` carries the next `HuntState`, an ordered list of `rewards` (each with the tick it
happened on), the rooms cleared, supplies used, and the draws consumed.

### 2.4 Tick order

Fixed, and part of the contract:

```text
for each tick:
  1. if the Character is dead or the run ended    -> stop
  2. spawn the room's encounter if it is empty
  3. Character acts   if tick >= characterNextAttackTick
       target = the living creature with the lowest index   (§7)
       roll damage, apply the reduction chain (§3), schedule the next attack
       if the target died -> record a reward at this tick
  4. each living creature acts, in index order, if tick >= its nextAttackTick
       roll damage, apply the reduction chain, schedule the next attack
  5. if the Character's health is at or below 0   -> DIED, stop
  6. if the Character's health is below the supply threshold and a charge remains
       -> consume one charge, heal, record the use
  7. if every creature is dead -> the room is cleared; advance (§4)
```

Step 6 after step 5 is deliberate: a potion cannot save a Character that is already dead, which
is Tibia's behaviour and avoids a supply that is worth more than its charges.

---

## 3. Combat resolution

All four steps and their order come from `Creature::blockHit` (source map §3.6). **The order is
the part official sources never document and the part that changes the numbers most.**

```text
damage = normal_random(0, maxHit)                       // §3.7, centred, not uniform
damage -= uniform_random(defense / 2, defense)          // defence  (always available, §3.6)
damage -= armour term                                   // armour > 3 ? uniform_random(a/2, a-(a%2+1)) : a > 0 ? 1 : 0
damage -= damage * mitigation / 100                     // mitigation
damage  = max(0, floor(damage))
```

Character maximum hit (source map §3.1–§3.3):

```text
minHit = floor(level / 5)
maxHit = round(0.085 * attackFactor * attackValue * attackSkill + floor(level / 5))
damage = normal_random(minHit, maxHit)
```

`level / 5` is integer division. A weapon's raw Attack is compensated by **120%** before it enters
this; the tutorial profile's `attackValue` is already the effective value (§5.2).

**The floor is not zero.** `WeaponMelee::getWeaponDamage` rolls `normal_random(level / 5,
maxDamage)`; only the UNARMED path (`Weapon::useFist`) rolls from zero. The two agree below
Level 5 and diverge from Level 5 up, and the tutorial profile is armed, so the armed floor
applies. Using zero would quietly make a levelling Character weaker than the baseline says it is
— which is the kind of silent divergence `REFERENCES.md` exists to prevent.

Creature maximum hit is the authored `maxDamage` (Rat: 8).

---

## 4. Rooms

Ten rooms in the Rookgaard Sewers. Rooms 1–9 advance when their encounter is cleared. **Room 10
is the stable endless loop**: every clear increments a persisted `cycle` and immediately starts
another room-10 encounter.

Density escalates through **data**, not through code:

| Room | Rats |
|---|---|
| 1–2 | 1 |
| 3–5 | 2 |
| 6–8 | 3 |
| 9 | 4 |
| 10 | 4, endless |

**Room 10 holds four, not five.** An earlier revision wrote five; the authored content was
chosen by measurement instead. Over 200 simulated runs of the shipped content, every run reaches
room 10 and every run ends in death when the supplies run out, with a median of 95 minutes,
4 endless cycles, 40 kills, 200 Base XP and 101 Gold. Five made the endless room a wall rather
than a loop — the run ended there rather than cycling — which is not what "the stable endless
loop" means.

**Decision P2-D3 — rooms are content, not a dungeon engine.** The room plan is an array on the
hunt definition. Phase 5's Dungeon system will need floors, branching and objectives; a Hunt needs
an ordered list of encounters and a flag on the last one.

---

## 5. Content

### 5.1 `creature`

| Field | Rat | Source |
|---|---|---|
| `key` | `creature.rat` | — |
| `label` | Rat | `rat.lua` |
| `maxHealth` | 20 | `monster.health` |
| `experience` | 5 | `monster.experience` |
| `attack.intervalMs` | 2000 | `monster.attacks[1].interval` |
| `attack.maxDamage` | 8 | `monster.attacks[1].maxDamage` (sign dropped) |
| `defense` / `armor` / `mitigation` | 5 / 1 / 0.07 | `monster.defenses` |
| `gold` | `{ chance: 1, min: 1, max: 4 }` | `monster.loot` gold coin, `chance 100000/100000`, `maxCount 4` |
| `speed` | 67 | `monster.speed` — carried for presentation |
| `elements`, `immunities` | as authored | recorded, unused in Phase 2 |

### 5.2 `combat-profile` — the tutorial profile

```text
combat-profile.origin.rookgaard
  maxHealth 150 · attackSkill 10 · attackValue 9.6 · attackFactor 1.0
  attackIntervalMs 2000 · defense 4 · armor 4
  supply { charges 20, healMin 60, healMax 90, useBelowPercent 40 }
```

Every number is sourced (source map §2, §4, §6). `armor 4` is the pre-vocation leather kit.

`attackValue 9.6` is the dagger Canary's own first-vocation kit grants — raw Attack **8**,
compensated by `WEAPON_ATTACK_PERCENT` (120%) exactly as `getEffectiveWeaponAttackValue` does
before the value reaches §3's formula. The **effective** value is authored because that is what
`getMaxWeaponDamage` consumes; authoring the raw 8 and compensating inside the engine would put
an items rule in a pure simulator. It gives a maximum hit of `round(0.085 × 1.0 × 9.6 × 10) = 8`,
which is the number §3 and the source map's fight table both use.

`charges 20`, not 10: ten ends the run at about forty-five minutes, before the endless room has
cycled more than once. Twenty is what produces the measured shape in §4.

**Decision P2-D4 — a combat PROFILE, not equipment.** Part F's first branch was tested and
failed: a Level-1 Character with fists wins 12% of Rat fights and dies in the other 88% (source
map §4, 2000 simulated fights). A starting weapon is necessary, and the smallest honest way to
have one without Phase 3 is an immutable content-authored set of combat *inputs*. **Phase 3
replaces this** with `BaseItem`/`ItemInstance` and what the Character is actually wearing.

### 5.3 `hunt`, extended

`rooms: [{ number, creatures: [{ key, count }], endless? }]`. Build-time validation checks that
every creature key resolves to a `creature`, room numbers are `1..n` without gaps, and exactly
the last room is `endless`.

---

## 6. Stamina — `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §2, §3

Nothing here is new design; it is the locked rules made executable.

| Rule | Implementation |
|---|---|
| Activation | the tick of the **first qualifying XP reward** sets `ActivityParticipant.staminaActivatedAt` |
| Continuation | `ONLINE_ACTIVE` simulated time after activation, **including between kills and rooms** |
| Stops immediately | grace, manual leave, activity end, death |
| Premium band | XP at a reward is multiplied by 1.5 while stamina is **above 39:00**, else 1.0 |
| Segmentation | evaluated **per reward**, at the stamina the Character had on that reward's tick — exact, not pro-rata |
| Zero stamina | the reward is dropped entirely: 0 XP, 0 Gold. Combat continues |
| Where the Gold goes | the Character's **Gold Pouch**, never the Bank (§9.1, ADR-019) |
| Recovery | Premium 1:1, Free 1:2, capped at 42:00, no waiting period, offline and idle eligible; **grace recovers nothing** |
| Retry | every settlement carries `settlementOperationId(activityId, checkpoint)`; a replay is a no-op |

**Decision P2-D5 — per-reward segmentation rather than pro-rata.** §2.2 requires a settlement
crossing 39:00 to be split at the boundary. Rewards are discrete and carry their tick, so the
exact stamina at each reward is computable; pro-rating a settlement's XP across the boundary
would be an approximation where an exact answer exists, and cases 23–24 demand determinism at the
boundary.

## 7. Auto-combat

**Decision P2-D6 — lowest-index living creature.** Deterministic, replayable, and the smallest
rule that is not arbitrary. "Nearest" is Canary's Rat strategy (`strategiesTarget.nearest = 100`)
and needs positions Phase 2 does not simulate; "lowest health" would be a tactical choice this
phase has no evidence for. Position is presentation (§10), not state.

The Character attacks when ready, drinks when hurt and out of danger is not an option it has. No
five-vocation AI, no spells, no fake abilities.

---

## 8. Connection lifecycle

| Event | Effect |
|---|---|
| Connected, `ONLINE_ACTIVE` | the simulation advances |
| Browser backgrounded, connection alive | keeps advancing — it is the *connection* that matters, not the tab |
| Unexpected disconnect | `RECONNECT_GRACE_PAUSED`; Activity, room, cycle, creature health, supplies and the occupancy claim all preserved; **nothing advances**: no ticks, no Stamina, no timers, no XP, no Gold, no supplies |
| Reconnect within 5:00 | resumes the same Activity at the same state |
| Grace expiry | the Activity ends and the occupancy claim is released |
| Manual Leave, explicit sign-out | ends immediately, **no grace** |

`RECONNECT_GRACE` is 5 minutes (`@global-idle/shared`). **The server owns the deadline**; the
client's opinion of elapsed time is never accepted.

**Decision P2-D7 — liveness is a heartbeat, not a socket.** A session is `ONLINE_ACTIVE` while a
heartbeat has arrived within the liveness window. A WebSocket adds a connection model, a
reconnect protocol and a second source of truth for a phase whose only requirement is "is this
session still here". The heartbeat rides the existing polled reads.

---

## 9. Persistence

One row per run, `HuntRun`, keyed by `activityId`:

```text
room · cycle · tick · simulatedThroughMs · characterHealth · encounter (creature health, next-attack ticks)
supplyCharges · sessionXp · sessionGold · checkpointSequence · endedReason · endedAt
```

Plus, on existing tables: `Character.baseXp` (durable Base XP) and
`ActivityParticipant.staminaActivatedAt` (already present, Phase 0B).

**Nothing presentational is persisted.** Positions, sprites and animation phases are derived by
the client from authoritative state.

### 9.1 Gold is CARRIED, not banked

A creature's Gold credits the Character's **Gold Pouch** — a currency custody scope, weightless
and slotless, that the Character is carrying and can lose. The **Bank** is a different number:
account-scoped, safe, and never written by a Hunt.

Both are projections of the one append-only ledger, discriminated by a `custody` dimension on
every entry (ADR-019). Nothing about ADR-003 is weakened: the ledger is still the truth, the
projection is still written only beside its entry, every movement still carries an operation id,
and reconciliation still recomputes from the entries — now per scope.

```text
Hunt reward        +N  ->  (character, POUCH)         hunt.reward
Deposit            -N  ->  (character, POUCH)  }      gold.deposit, one operation, double entry
                   +N  ->  (account,   BANK)   }
Death, unblessed   -N  ->  (character, POUCH)         hunt.death.forfeit
```

**Per Character, not per Account.** What is carried is carried BY someone: a Knight's death cannot
cost a Druid its earnings, and an Active Party must be able to carry several pouches at once.

**No auto-deposit.** The Pouch is not swept into the Bank when a Hunt ends. Depositing is a
deliberate act, which is what makes carrying Gold a choice rather than a formality.

### 9.2 What death costs

Death is the only ending that costs anything. Leaving and losing a connection end the run and take
nothing — punishing a lost connection would make the five-minute grace a trap rather than a mercy.

| | |
|---|---|
| Base XP | Canary's `Player::getLostPercent()`, transcribed — including the sub-24 branch (source map §8) |
| Base Level | recomputed from the remaining XP; 1 is the floor |
| Gold Pouch | **forfeited in full** without Full Bless; **kept in full** with it |
| Bank | untouched, always |
| Supplies, the five Hunt containers, equipment, Depot, Stash, Reward Chest | untouched — Phase 3 onward |
| Skills | deferred: Phase 2 has no durable Skill representation, and inventing one to delete it would be a shadow system |

**Full Bless is a BINARY threshold for what is carried.** Partial blessings reduce the experience
loss exactly as Canary says, and protect nothing in the Pouch. Seven protects it; six does not.

**Full Bless is not a free death.** The experience loss still applies, the Hunt still ends, and
Skill loss will apply when Skills exist.

**Settled once.** The penalty rides the run's own ending: a run that already carries an
`endedReason` is not ended again, so no retry, replay or restart can charge it twice.

Every settlement is one transaction: simulate → write `HuntRun` → award XP → post the Gold ledger
entry → settle Stamina → settle active-use timers, all under
`settlementOperationId(activityId, checkpointSequence)`. A retry re-reads the sequence and does
nothing. **This is what makes duplicated XP, Gold, supply consumption and Stamina impossible
rather than unlikely.**

---

## 10. The Game Window

The first real Game Window (`UI_SURFACE_ARCHITECTURE.md` §1), separate from the Atlas.

Shows, all from the server: the scene, the Character and the living Rats with their health, room
number and room-10 cycle, connection state (live / reconnecting / ended), Stamina with its mode,
session XP and Gold, Base Level and progress, supply charges with a warning when exhausted, the
last few combat events, and the death or end state.

Animation may interpolate between server states so movement reads smoothly. It may never
originate one. **No WASD, no manual attack, no click-to-move** — the Character controls itself.

---

## 11. API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/characters/:id/hunt` | advances the simulation and returns the run state |
| `POST` | `/api/characters/:id/hunt/heartbeat` | liveness; also advances |
| `DELETE` | `/api/characters/:id/activity` | Leave — already exists, now also ends the run |

Entering a Hunt (`POST /api/characters/:id/hunt`) is Phase 1's route, unchanged, and now creates
the `HuntRun` alongside the Activity in the same transaction.

---

## 12. Test matrix

| Group | Ids | Covers |
|---|---|---|
| **SIM** — simulation | SIM1–SIM10 | deterministic ticks; same seed ⇒ same run; Rat combat matches the formula; a room clears; 1→10 advance; room 10 repeats and increments the cycle; a paused run advances nothing; the reduction chain order; the engine is pure; draw ordering is stable across a restart |
| **ST** — stamina | ST1–ST24 | the twenty-four mandatory cases of `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §7, in order |
| **AU** — active use | AU25–AU28 | the four mandatory active-use cases |
| **RW** — rewards | RW1–RW6 | XP awarded and durable; Premium 1.5× band; Free 1.0×; Gold ledger-backed and auditable; zero stamina yields nothing; a retried settlement duplicates nothing |
| **SU** — supplies | SU1–SU3 | consumption; durable exhaustion; exhaustion does not end the Hunt |
| **DE** — death | DE1–DE4 | health reaches zero; the run stops; the Activity ends and the claim is released; the reason is durable |
| **CX** — connection | CX1–CX6 | connected advances; backgrounded-but-connected advances; disconnect pauses; reconnect under 5:00 resumes; over 5:00 expires and releases; Leave and sign-out take no grace |
| **PS** — persistence | PS1–PS5 | reload; process restart; identical deterministic state; no duplicate rewards; room advancement and rewards stay consistent |
| **GW** — game window | GW1–GW8 | Atlas → Hunt → Game Window; visible combat progress; room changes; reload; grace is visible; resume; Leave; death — desktop and touch |
| **SRC** — source fidelity | SRC1–SRC4 | the Rat fixture matches `rat.lua`; the damage formula matches its inputs/outputs; the XP curve matches `getExpForLevel`; the tutorial profile matches its cited sources |
| **DL** — death loss | DL1–DL14 | the flat sub-24 base; blessings below the branch; the 40%→50% replacement; Promotion after it; the ≥24 formula; the vocation gate; the source's rounding including its floating point; the level walk-down; no negative XP; a pre-vocation Character cannot be promoted; the penalty settles once on retry; a second CONCURRENT caller blocks on the run's row lock and applies nothing; two concurrent settlements of a dying run cost exactly one death; a Leave racing a death yields one ending and nothing earned past it |
| **GP** — gold pouch | GP1–GP15 | Gold lands in the Pouch and never the Bank; the Pouch is durable; zero Stamina credits nothing; a retry credits once; death without Full Bless forfeits it once; Full Bless keeps it; Leave and grace destroy nothing; the Bank is distinct and transfers are balanced; every scope reconciles; a BANK row cannot name a Character; a POUCH row for a real Character on its own Account is accepted; a POUCH for a Character that does not exist is refused by the DATABASE; one Account cannot hold a POUCH over another Account's Character; the constraints are in the catalog and the backfilled BANK rows are untouched; both scopes still reconcile exactly |
| **BL** — bless policy | BL1–BL3 | partial Bless reduces XP loss and protects nothing carried; Full Bless is the binary carried-reward threshold; Skill loss is deferred explicitly and no shadow Skill exists |

**Totals: 13 groups, 106 cases** — SIM 10, ST 24, AU 4, RW 6, SU 3, DE 4, CX 6, PS 5, GW 8, SRC 4,
DL 14, GP 15, BL 3
— counted by `scripts/count-matrix.mjs`, which already counts Phase 0B's 92 and Phase 1's 87.
Those two remain in force and are not renumbered.

> **Correction.** An earlier revision of this line said 70. The ten group sizes beside it sum to
> 74, and every one of them is fixed by something outside this document: ST and AU are
> `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §7's twenty-four and four mandatory cases, and the other
> eight are the coverage listed in the table above. The total was the arithmetic error, not the
> groups, so the total is what changed. The counter is the arbiter either way — it reports the
> groups, and a number in prose that disagrees with it fails the build.

---

## 13. Definition of Done

1. Phase 0B 92/92 and Phase 1 87/87 still pass, unmodified.
2. Phase 2 106/106 pass.
3. A Level-1 pre-vocation Character can enter the Sewers and kill a Rat, with every number traced.
4. The simulation is server-authoritative and deterministic from its seed.
5. Rooms 1–10 advance; room 10 repeats and persists its cycle.
6. Base XP is durable and advances Base Level on the Canary curve.
7. Gold is ledger-backed and auditable, and lands in the Character's **Gold Pouch** — carried and
   at risk — rather than in the safe account Bank.
8. Supplies are consumed, exhaust durably, and do not force an exit.
9. Death ends the run, releases the claim and is durable — and COSTS: Base XP by Canary's own
   formula including its sub-24 branch, and the whole Gold Pouch without Full Bless.
10. Stamina activates on the first qualifying XP, segments at 39:00, yields nothing at 0:00, and
    recovers at 1:1 / 1:2.
11. Active-use cases 25–28 hold.
12. Progress is online-only; grace pauses everything for exactly 5:00; reconnect resumes; expiry
    ends and releases; Leave and sign-out take no grace.
13. Reload and restart are safe, and no retry duplicates a reward or a consumption.
14. The Game Window shows automatic combat, and the Atlas stays a separate surface.
15. No Phase 3 itemization exists anywhere in the diff.
16. CI is green, including browser acceptance on desktop and touch.
