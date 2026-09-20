# Character Activity Occupancy, Stamina and Active-Use Timers

**Document status:** `PHASE_0A_COMPLETE` / PENDING INDEPENDENT REVIEW
**Phase:** 0A (extends 0A.1 and 0A.4)
**Depends on:** `ADR-002`, `ADR-006`, `ADR-013`, `ADR-014`, `ADR-015`

This document covers four locked product systems that share one mechanism: **what a Character is
doing determines what it burns.**

---

## 1. Character activity occupancy — LOCKED

> A Character may perform only **one** primary gameplay/progression action at a time.

| | |
|---|---|
| Knight hunting, Druid training | ✅ allowed |
| Knight hunting **and** Knight training | ❌ forbidden |
| Knight in two Hunts | ❌ forbidden |

The restriction is on **Character action occupancy**, not on the player. The account may freely
navigate hubs, inspect the Market, Atlas, inventory and skills, use menus, and manage other
characters. Account-level concurrency across *different* characters is expected and supported —
it is how a five-character roster is meant to be played.

### Enforcement

`DECIDED IN PHASE 0A` — see `ADR-013`. Occupancy is an **atomically enforced invariant**, not an
application check:

- each Character has at most one **occupancy claim** at any instant;
- the claim names the occupying activity;
- acquisition is a conditional write that fails if a claim already exists;
- it is released on activity end, and **reserved** (not released) during reconnect grace, since
  the activity still exists.

An application-level "is this character busy?" check loses the race between two near-simultaneous
start commands. A uniqueness constraint does not.

**Invariant I13** — at most one occupancy claim per Character.

Note the two claims are different scopes and both are needed:

| Claim | Scope | Purpose |
|---|---|---|
| Activity claim (`ADR-008`) | **Account / session** | only one session drives the account |
| Occupancy claim (`ADR-013`) | **Character** | only one action per character |

---

## 2. Stamina — LOCKED

Stamina belongs to **each Character independently**. There is no shared account pool.

```text
maximum: 42:00 hours, per Character
```

`DECIDED IN PHASE 0A` — stamina is durable Character-context state, settled at activity
checkpoints like every other progression value. It is never decremented per second
(`ADR-014`, `ADR-015`).

### 2.1 Consumption

Consumption has an **activation trigger** and a distinct **continuation signal**. Conflating
them is the mistake this section exists to prevent.

| | |
|---|---|
| **Activation** | the Character receives its **first qualifying Hunt XP reward** in that Hunt |
| **Continuation** | that Character's Hunt participation is in authoritative `ONLINE_ACTIVE` simulation state |

Before first qualifying XP the Character is in a **pre-consumption Hunt state**: physically in
the Hunt, consuming nothing.

Once activated, consumption continues while the Hunt is `ONLINE_ACTIVE` — **including the time
between kills and between rooms**. Idle seconds inside an advancing Hunt still burn stamina.

Consumption stops **immediately** when the authoritative Hunt stops advancing for that
Character:

- reconnect grace / paused activity;
- manual exit;
- activity end;
- the Character no longer participating;
- any other server state in which Hunt simulation is not advancing.

`DECIDED IN PHASE 0A` — **"N minutes without XP" is explicitly not the source of truth.** XP
activates; the activity lifecycle sustains. A no-XP timeout would silently disagree with the
lifecycle during a long boss fight or a dry streak, and would need its own clock to go wrong.

**Server time is authoritative. Client elapsed time is never accepted** — consistent with
`CLIENT_SERVER_BOUNDARIES.md` §6.

### 2.2 Premium XP band — LOCKED

Premium is an **Account-wide** entitlement (§4). For any Character on a Premium account:

| Stamina band | Hunt Base XP |
|---|---|
| 42:00 → 39:00 | **1.5×** — exactly +50% |
| 39:00 → >0 | 1.0× |

Free accounts use 1.0× across the whole range. **There is no low-stamina reduced-XP band**, and
Premium does not raise the 42:00 maximum.

`DECIDED IN PHASE 0A` — **the band is evaluated per settlement segment, not per settlement.** A
settlement interval that crosses 39:00 is **split at the boundary**: the portion above 39:00
settles at 1.5×, the portion below at 1.0×. Settling the whole interval at whichever rate applied
at one end would either grant or deny bonus XP for time that did not qualify, and the error would
scale with the checkpoint interval.

The boundaries at exactly 39:00 and exactly 0:00 are deterministic and must be pinned by test
(§7, cases 23–24).

### 2.3 Zero stamina — LOCKED

At exactly 0 stamina the Character becomes **Hunt-reward-ineligible**. It receives:

- 0 Hunt Base XP;
- 0 Hunt-generated Skill progress;
- 0 Hunt Gold;
- 0 Hunt loot;
- 0 other Hunt reward value.

**Zero stamina does not force Hunt exit.** The Character keeps fighting: it attacks, takes
damage, consumes supplies, can die, and contributes combat actions. This matches the product's
standing rule that the game reports state and the player decides.

### 2.4 Stamina in a Party

Eligibility is evaluated **per Character**:

- one exhausted member does not exhaust the others;
- eligible members continue receiving their valid rewards;
- an exhausted Character **must not** receive reward indirectly through Shared XP or any other
  distribution path.

`DECIDED IN PHASE 0A` — **Shared XP level eligibility and stamina reward eligibility are
separate predicates**, evaluated independently and combined with AND. A party may be
Shared-XP-eligible while one member earns nothing because it is exhausted. Reward distribution
therefore filters recipients by stamina *after* computing the shared pool, so an exhausted member
cannot be a conduit.

---

## 3. Stamina recovery — LOCKED

The correct distinction is **not** "doing something vs doing nothing". It is:

> **participating in a Stamina-consuming activity vs not participating in one.**

`DECIDED IN PHASE 0A` — **Skill Training does not block recovery.** An earlier assumption that
any activity blocks recovery is superseded. A Character at a Training Dummy is, for stamina
purposes, recovering.

Worked example:

| Character | Doing | Stamina |
|---|---|---|
| Knight | Hunt (post-activation) | consuming |
| Druid | Dummy / Exercise Weapon training | **recovering** |
| Sorcerer | Dummy training | **recovering** |
| Paladin | Dummy training | **recovering** |
| Monk | Dummy training | **recovering** |

If the Druid later joins the Hunt, only the Druid switches to consuming; the other three keep
recovering.

### 3.1 Rates

| Account | Eligible non-consuming time | Stamina gained |
|---|---|---|
| **Premium** | 1 minute | +1 minute (1:1) |
| **Free** | 2 minutes | +1 minute (1:2) |

Capped at 42:00. **There is no mandatory waiting period** before recovery begins.

### 3.2 What recovers

Any state in which the Character is not in an active Stamina-consuming Hunt:

- offline;
- resting / idle;
- account online while that Character is not hunting;
- Dummy / Exercise Weapon Skill Training;
- menus, hubs, Market, Atlas while the Character is not hunting;
- any future activity explicitly configured as non-consuming.

`DECIDED IN PHASE 0A` — **every activity type declares whether it consumes Stamina.** The
declaration is part of the activity definition, and the default for a new type is *undeclared →
rejected at content validation*. Silently assuming every activity consumes — or that none does —
is how a future feature quietly breaks the economy of time.

### 3.3 The pre-consumption Hunt state

A Character physically in a Hunt that has not yet triggered its first qualifying XP is neither
consuming nor a normal recovery context.

`DECIDED IN PHASE 0A` — **the pre-consumption state is explicitly neutral: it neither consumes
nor recovers.** Treating it as recovery would create an exploit — enter a Hunt, never earn XP,
and recover at the same rate as resting while occupying a hunting slot. Treating it as
consumption would contradict the locked activation rule. Neutral is the only reading that
cannot oscillate: a Character's stamina mode is a **function of one authoritative state**, so it
can never be counted twice or flip between modes within a settlement segment.

```text
CHARACTER STAMINA MODE (exactly one, derived from authoritative state)

  CONSUMING    Hunt, activated, ONLINE_ACTIVE
  NEUTRAL      Hunt, not yet activated  ·  Hunt paused in reconnect grace
  RECOVERING   everything else
```

---

## 4. Premium entitlement — LOCKED

**Premium belongs to the Account, not to a Character.** Every Character on the account receives
applicable benefits: the 42→39 XP band and 1:1 recovery.

A Premium transition is authoritative server state. `DECIDED IN PHASE 0A`:

- an unsettled interval spanning a transition is **split at the transition boundary** and each
  segment settles at its own rate;
- **already-settled time and rewards are never retroactively rewritten**;
- future time uses the new rate.

This is the same segmentation rule as the 39:00 stamina boundary (§2.2), and for the same
reason: the error otherwise scales with the checkpoint interval.

Store and payment flows are later scope. The **entitlement consumption model** must exist before
Hunt stamina can read it.

---

## 5. Active-use timer framework — LOCKED DIRECTION

One reusable, server-authoritative duration model for every timed gameplay effect: XP boosts,
status boosts, loot boosts, Imbuements, and whatever comes later.

> **Duration decreases only while the effect is in a qualifying state where it can actually
> operate. It does not burn because wall-clock time passed.**

| Effect | Qualifying state |
|---|---|
| XP boost | reward-generating Hunt usage |
| Combat / status boost | qualifying active combat |
| Loot boost | reward-generating activity |
| Imbuement | its item equipped **and** actively used in a qualifying activity |

Reconnect grace **pauses** every active-use timer, because the simulation is paused.

### 5.1 Mechanism

`DECIDED IN PHASE 0A` — see `ADR-015`. **Timers are never decremented per second.**

A timer is `{ remainingDuration, qualifyingSince }`:

- entering a qualifying state records `qualifyingSince` from the **server clock**;
- leaving it settles `remainingDuration -= (now - qualifyingSince)` and clears the marker;
- settlement also happens at every activity checkpoint, so a long qualifying run is chunked;
- each settlement carries an operation id, so a retry cannot double-consume;
- the settlement is a pure subtraction of a server-measured interval — restart-safe, because
  `qualifyingSince` is durable and a crash simply resettles from it.

Properties this buys: server-clock based, restart-safe, retry-safe, idempotent, aligned with
activity settlement, resistant to double consumption, and structurally unable to trust client
elapsed time.

Stamina uses the same machinery with the sign inverted — it is the framework's first consumer
and its reference implementation.

---

## 6. Imbuements — LOCKED

Global Idle has **one** playable Imbuement power tier: **Powerful**.

`DECIDED IN PHASE 0A` — Basic and Intricate are **not** implemented as player progression tiers.
A source reference may use three tiers; Global Idle exposes one, so the domain has a single
imbuement power level and the content schema does not carry a tier field for player-facing
progression.

### 6.1 Duration

```text
12 hours of ACTIVE USE
```

Not wall-clock expiry. An Imbuement consumes **nothing** while:

- the item is unequipped;
- the Character is not in a qualifying active-use context;
- the Character is offline or inactive;
- the activity is paused in reconnect grace.

Remaining duration is **durable `ItemImbuement` state on the `ItemInstance`** — it travels with
the item. Re-equipping **resumes** the remaining duration; it never resets it. A server restart
preserves the exact remaining value, because it is persisted, not held in memory.

### 6.2 Unlock

Powerful Imbuements require the approved quest/boss progression. The Product Owner specifies
that the relevant access requires completing the **five required bosses** of that chain.

`DECIDED IN PHASE 0A` — **the unlock is modelled as a named requirement over a configurable set
of boss-completion facts**, not as five hard-coded checks:

```text
unlock.imbuement.powerful  ⟵  requires ALL of { boss completion keys }
```

The set lives in content (`CONTENT_DATA_ARCHITECTURE.md`), so its membership is a reviewable
data change rather than a code change. Architecture is unaffected by which bosses they are or
how many there turn out to be.

> **⚠ Evidence gap — needs the Product Owner.** The Global Idle repository defines **no boss or
> quest names at all**. The task instructs using existing repository references and not inventing
> names, so none are invented here. For transparency: the analogous chain in the Canary research
> reference has **six** pre-final bosses plus a final one, each gating a distinct Powerful
> imbuement — not five. The count and the specific set therefore need the Product Owner to name
> them before content can be authored. This blocks **content**, not architecture: the requirement
> model above works for any set of any size.

---

## 7. Mandatory tests for later implementation

Recorded here and in the roadmaps so the implementing phase cannot quietly skip them.

### Stamina

| # | Test |
|---|---|
| 1 | Hunt entry before first qualifying XP consumes 0 |
| 2 | First qualifying XP activates consumption |
| 3 | Time between kills still consumes while `ONLINE_ACTIVE` |
| 4 | Reconnect grace consumes 0 |
| 5 | Manual exit stops consumption immediately |
| 6 | Activity end stops consumption immediately |
| 7 | Premium 42:00→39:00 applies 1.5× XP only |
| 8 | Premium below 39:00 uses 1.0× |
| 9 | Free uses 1.0× from 42:00→0 |
| 10 | Exactly 0 stamina yields zero Hunt rewards of every kind |
| 11 | Zero stamina does not automatically end combat |
| 12 | Mixed-Party stamina affects each Character independently |
| 13 | An exhausted Character cannot receive XP indirectly through Shared XP |
| 14 | Recovery never exceeds 42:00 |
| 15 | Premium recovery = 1:1 |
| 16 | Free recovery = 1:2 |
| 17 | Dummy / Exercise training still recovers Stamina |
| 18 | Offline idle recovers Stamina |
| 19 | A different Character can Hunt while others train or recover |
| 20 | The same Character cannot Hunt and Skill Train concurrently |
| 21 | Crash / retry cannot double-consume or double-recover |
| 22 | A Premium transition mid-interval applies correctly segmented rates |
| 23 | The boundary at exactly 39:00 is deterministic |
| 24 | The boundary at exactly 0:00 is deterministic |

### Active-use timers

| # | Test |
|---|---|
| 25 | Offline wall-clock does not consume |
| 26 | Reconnect grace does not consume |
| 27 | Qualifying active use does consume |
| 28 | Retry / restart does not double-consume |

### Imbuements

| # | Test |
|---|---|
| 29 | Powerful is the only tier |
| 30 | Initial remaining duration = 12h active use |
| 31 | Equipped + qualifying activity consumes |
| 32 | An unequipped item consumes 0 |
| 33 | Inactive / offline consumes 0 |
| 34 | Reconnect grace consumes 0 |
| 35 | Re-equip resumes remaining duration rather than resetting it |
| 36 | Restart preserves the exact remaining duration |
| 37 | Access denied before the required boss unlock |
| 38 | Access allowed after the required boss unlock |

---

## 8. Checklist

- [x] One occupancy claim per Character, atomically enforced (I13)
- [x] Account-level concurrency across different Characters preserved
- [x] Stamina per Character, 42:00 cap, no account pool
- [x] Activation = first qualifying XP; continuation = `ONLINE_ACTIVE`
- [x] No "N minutes without XP" heuristic anywhere
- [x] Time between kills consumes
- [x] Pause, exit and end stop consumption immediately
- [x] Premium 42→39 at 1.5×, segmented at the boundary
- [x] No low-stamina XP penalty band
- [x] Zero stamina removes all Hunt reward, keeps combat
- [x] Stamina and Shared XP eligibility are independent predicates
- [x] Skill Training recovers Stamina
- [x] Premium 1:1, Free 1:2, capped, no waiting period
- [x] Pre-consumption Hunt state is neutral and cannot oscillate
- [x] Premium is Account-wide; transitions segment the interval
- [x] Active-use timers never decrement per second
- [x] Imbuement: Powerful only, 12h active use, durable on the item, resumes on re-equip
- [x] Client elapsed time is never accepted for any of the above
