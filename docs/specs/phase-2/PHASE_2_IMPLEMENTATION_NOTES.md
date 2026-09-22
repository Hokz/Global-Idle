# Phase 2 — Implementation notes

**Status:** `VERIFIED` — accepted by the Product Owner on 2026-09-22 at head
`03058b5bd337900d08bc253c35b8825e06b35af7`, after independent review.
**Spec:** [`PHASE_2_HUNT_SIMULATOR_SPEC.md`](./PHASE_2_HUNT_SIMULATOR_SPEC.md) ·
**Evidence:** [`PHASE_2_CANARY_SOURCE_MAP.md`](./PHASE_2_CANARY_SOURCE_MAP.md)
**Matrix:** Phase 2 **106/106**, with Phase 0B 92/92 and Phase 1 87/87 still passing.
**Accepted evidence:** 299 tests across 33 files · 36 Playwright cases, desktop and touch ·
17 migration assertions · CI run #29 green on all three jobs · `pnpm dev` green.

The functional evidence includes the INSTRUMENTED browser walkthrough of §7. A human aesthetic
review of the layout is **not** claimed and was not part of this acceptance; §7 still records it
as owed.

This document records what the implementation DECIDED, what it FOUND, and what it COST — the
things a specification cannot know in advance. It is not a summary of the spec.

---

## 0. The correction pass — Gold custody and death

Two Product Owner decisions made after Phase 2 was specified superseded two of its behaviours.
Neither is a failure against the original assignment; both change what Phase 2 MEANS, so they are
Phase 2's to fix rather than a later phase's to inherit.

### 0.1 Hunt Gold was safe the instant it dropped

`hunt.reward` posted straight into the account's `CurrencyBalance`. That made every coin a Rat
dropped **immediately equivalent to banked Gold**, and quietly deleted the risk a Hunt is supposed
to carry: there was nothing a death could take.

The locked rule is `creature Gold -> Gold Pouch`, and `Gold Pouch != Bank`.

The obvious shortcut — a `goldPouch` integer on `Character` — is the exact shape ADR-003 forbids:
a mutable balance no ledger explains, and the one number a player will argue about after a death.
So custody became a **dimension of the ledger** instead
([ADR-019](../../architecture/decisions/ADR-019-currency-custody-scopes.md)): every entry and every
projection row carries `(subjectId, custody, currency)`, where the subject is the Account for
`BANK` and the **Character** for `POUCH`. A composite foreign key and a CHECK enforce the pairing
— see §0.5, which is where that claim was first made too loosely and then made true.

Everything ADR-003 decided still holds — append-only, projection written only beside its entry,
one operation id per movement, reconciliation recomputed from the entries — now **per scope**,
which is the same guarantee at the granularity the data has. Three consequences fall out for free:

- a deposit is **double entry**, two rows under one operation id summing to zero, so it is already
  expressible and already balanced before any Bank UI exists;
- a death forfeiture is a single negative entry with a reason, so the movement most likely to be
  disputed is the one the ledger explains best;
- a future custody — Market escrow, a shared Party pool — is an enum value, not a new table.

**Per Character, not per Account.** It costs one column now and a migration of live money later.

### 0.2 Death ended the run and cost nothing

The formula is Canary's, and the correction is mostly about refusing a summary.

> "Seven blessings at 8% plus Promotion's 30% is 86% off."

That is **true from level 24 and false below it**, and every Character Phase 2 can represent is
below level 24. `Player::getLostPercent()` takes a different branch there: a blessing reduction of
40% or more is **replaced by a flat 50%** before Promotion is added. So at low level the fifth
blessing is worth 18 points, the sixth and seventh are worth nothing, and full blessings plus
Promotion is **80% off, not 86%**.

Three more things the source says that a summary would have lost, each of which changes behaviour:

| | |
|---|---|
| `vocation == VOCATION_NONE \|\| level > 7` | The familiar "no XP loss below level 8" is only HALF the guard. Global Idle's Origin Character is vocation-less until the Oracle, so it is on the first side and **always** loses. Reading only the second half would have made the whole tutorial death-free |
| `isPromoted()` for vocation 0 | **false**, from source: nothing promotes from vocation 0. The 30-point discount is not available to a Rookgaard Character, and a database CHECK now refuses `promoted` without a vocation rather than trusting a call site |
| `ceil`, in binary64 | The source computes `(1 - 0.30)` in floating point and lands a hair high, so when the exact product is a whole number it charges one extra point. Phase 2 reproduces that. Being quietly more exact than the baseline is a divergence, and a silent one — DL7 pins the boundary at 4,300 experience, where the source takes 302 and exact arithmetic takes 301 |

**What death now costs:** Base XP by that formula, the Base Level recomputed from what is left,
and the **whole Gold Pouch** unless the Character has Full Bless. Leaving and losing a connection
still cost nothing — punishing a lost connection would make the five-minute grace a trap.

**Carried-reward protection is BINARY.** Partial blessings reduce the XP loss exactly as the
baseline says and protect nothing carried. Six blessings forfeit the Pouch; seven keep it. Full
Bless is still not a free death: the XP loss applies, the Hunt ends, and blessings are consumed.

**Settled once**, and the run row is what makes it so: `endRun` returns immediately for a run that
already carries an ending, so no retry, replay or restart can charge the penalty twice.

### 0.3 The seam, and what is deliberately NOT built

`Character.blessings` and `Character.promoted` are the whole of it. Nothing in Phase 2 raises
either: there is no blessing shop, no NPC, no Oracle and no Promotion flow, and inventing any of
them would be exactly the shadow system this phase refuses everywhere else. What they buy is that
the policy **reads** protection from authoritative state instead of assuming "unblessed forever"
inside Hunt code — so the acquisition flow attaches in one place when its phase arrives.

**Skill loss is specified and deferred.** Canary loses Skill tries to death with the same
percentage and a different rounding (truncation, not `ceil`). Phase 2 has no durable Skill
representation, and creating one so that death could delete it would be a shadow system. The
rounding is in the import record with Phase 4 named as its owner, and BL3 asserts both that the
deferral is recorded and that no shadow Skill column or table has appeared in the meantime.

### 0.4 What this cost elsewhere

Widening the ledger's signature touched four call sites outside the Hunt — the economy invariant
suite, the Phase 0B append-only permission case, the observability case and the Redis
durable-state case. Each now names the scope it meant, which is the point: there is deliberately
no default, because a reward that forgot to say would land in the Bank, and that is the defect
this correction exists to remove.

**No Phase 0B or Phase 1 case was weakened.** The four that changed were changed because the row
shape changed, and each still asserts exactly what it asserted before.

---

### 0.5 What independent review found afterwards, and what it cost to fix

Two structural findings, both of the same shape: a guarantee that was **stated** rather than
**held**.

**POUCH ownership was a naming convention.** §0.1 claimed the database enforced that a pouch
belongs to a real Character owned by the account on the row. What the migration actually wrote was
`custody = 'POUCH' AND "subjectId" <> "accountId"` — which proves neither half. Measured rather
than argued: with the new foreign key dropped and that CHECK restored, PostgreSQL **accepts** a
ledger row naming a Character nobody ever created.

The fix is referential rather than textual. Every ledger and balance row carries an explicit
`characterId`; `Character` gains `UNIQUE (id, accountId)` purely as something to point at; and a
COMPOSITE foreign key `(characterId, accountId) -> Character(id, accountId)` makes the pair the
thing that is checked. A single-column key would have accepted Account A holding a pouch over
Account B's Character, which is the case GP13 exists to fail on. `ON DELETE RESTRICT` rather than
`SET NULL`, because nulling the carrier would silently produce a row the CHECK forbids. BANK rows
keep `characterId IS NULL` and skip the foreign key entirely under `MATCH SIMPLE`, so they need no
exemption. The migration moves no value: it fills the new column for POUCH rows and leaves every
BANK row exactly as it was.

**"Once only" was true of retries and not of concurrency.** `endRun` read `endedReason`, found
`null`, and settled. DL11 proved that a REPLAY does nothing twice, which is the easy half. Under
ReadCommitted — the isolation these transactions actually run at — two callers read `null` at the
same instant and both settle, and the penalty at stake burns experience and empties a Gold Pouch.
Measured: with the lock removed, DL12 fails with a second penalty of 501 experience on a run that
had already been settled.

The run row is now LOCKED and tested in one statement (`SELECT "endedReason" ... FOR UPDATE`),
with the Character locked first so §8.5's order is obeyed rather than reordered. `advance` takes
the same two locks before it simulates, which closes the second half of the same hole: without it a
Leave can commit mid-settlement and the checkpoint is applied — experience, Gold, and possibly a
death — to a run that is already over. DL14 fails without it, with `DIED` overwriting a committed
`LEFT`.

**Which terminal reason wins** therefore needs no ranking of reasons. The first transaction to take
the run's lock writes its only ending, and the other finds it there and applies nothing. Neither
ordering loses anything: a Leave that wins stops the settlement that would have produced the death,
so there is no unpaid death; a death that wins leaves the Leave nothing to do.

**Honest about which layer wins which race.** DL13 — two concurrent `advance` calls on a dying run
— passes with or without the lock, because the checkpoint claim gets there first and the loser is
already a no-op before it can reach the death branch. It is kept because the outcome it asserts is
worth asserting end to end; DL12 is the case that isolates the guard.

---

## 1. What exists now

A Level-1 pre-vocation Character can enter the Rookgaard Sewers from the Atlas and be watched
fighting. Rats spawn, the Character attacks on its own cadence, damage resolves through Canary's
reduction chain, creatures die, rooms clear, room 10 repeats forever. Base XP and Gold are
durable, and Gold is **carried in a Gold Pouch** that death can take. Stamina starts burning at
the first qualifying XP and not before. Supplies are consumed and run out. The Character can die,
and dying costs Base XP by Canary's own formula and the whole Pouch without Full Bless. A
**backgrounded or minimised tab keeps the Hunt advancing for as long as its heartbeat still
reaches the server**; a connection that actually goes away pauses the run for exactly five minutes
and then ends it.

| Layer | What Phase 2 added |
|---|---|
| `@global-idle/game-engine` | `simulateHunt`, `initialState`, `maxMeleeHit`, `minMeleeHit`, and `distributions.ts` (Canary's `normal_random` / `uniform_random`) |
| `@global-idle/game-data` | `creature`, `combat-profile`, hunt `rooms`; build-time validation of the room plan |
| `packages/domain` | the `hunt` context (`run`, `plan`, `rewards`, `progression`), durable Stamina settlement in the `character` context, `occupancyFor` in the `activity` context |
| database | `HuntRun`, `HuntEndReason`, `Character.baseXp` |
| `apps/api` | `GET /characters/:id/hunt`, `POST /characters/:id/hunt/heartbeat`, and sign-out now ends the Activity |
| `apps/web` | the first **Game Window**, showing the Pouch and what a death cost |
| economy | a `custody` dimension on the ledger and its projection (ADR-019), `transfer` as double entry, per-scope reconciliation |
| death | a pure transcription of `getLostPercent` and `Player::death`, and the protection seam on `Character` |

---

## 2. What the implementation found, and fixed

Six things were wrong or missing, and none of them were visible from the specification. Each was
found by writing the honest test and watching it fail.

### 2.1 An armed melee roll does not start at zero

`Weapons::getMaxWeaponDamage` is the maximum. The roll that consumes it,
`WeaponMelee::getWeaponDamage`, is `normal_random(level / 5, maxDamage)` — the MINIMUM is
`level / 5`, integer division. Only the unarmed path rolls from zero. The engine rolled from zero
for everything, which is right at Level 1 and silently wrong from Level 5 up. Fixed with
`minMeleeHit`, recorded in the source map, and pinned by SIM3 and SRC2.

### 2.2 Stamina recovery had machinery but no wiring

Phase 0B built `settleRecovery`, `deriveStaminaMode` and `settleConsumption` and deliberately
connected none of them to a row, because Phase 0B had no activity that could consume or recover.
Nothing since had connected them either — so ST14 to ST18 had nothing to test.

Phase 2 adds `character.settleStamina`: advance-on-read, segmented at every entitlement
transition, capped at 42:00, Premium 1:1 and Free 1:2. It is called from the character read path
and from the Hunt's own `advance`, so an account that was offline all night comes back with the
Stamina that night was worth and no scheduled worker had to be alive to grant it.

**It is idempotent by construction rather than by an operation id**: the marker IS the row's
`updatedAt`, so a replay settles a span of zero. There is nothing to forget to pass (ST21).

### 2.3 Active-use timers were settled at the wrong instant, and through a pause

The first implementation called `settleCheckpoint(now)` — the wall clock the request arrived on —
and left the timer qualifying while a run was paused. Both are wrong, and the second is the one a
player would notice: the marker sits through the pause and the whole span is collected by the
settlement on the far side of it, which reads as "reconnect grace consumed five minutes of my
Imbuement".

`advance` now burns the injected timers over exactly the span it simulated, and leaves them
non-qualifying whenever the run is not advancing — paused, expired, or dead. AU25 and AU26 fail
against either of the old behaviours.

### 2.4 A lost checkpoint race recursed until the transaction died

When `claimSettlement` refused — a concurrent settlement won, or this is a replay of one that
committed — `advance` re-entered itself "to read the fresh state". Inside the same transaction
that re-reads the same snapshot, so it looped until Prisma's 15-second interactive-transaction
timeout killed it. It now applies nothing and returns what is durable; the winner has already
advanced `checkpointSequence`, so the caller's next read moves on by itself. ST21 is the case
that found it.

### 2.5 Signing out left the Character occupied

§8 gives an explicit sign-out no grace, but `DELETE /api/session` only cleared the cookie. The
Activity stayed live and the occupancy claim stayed held by a session that no longer existed,
until the sweeper noticed five minutes later — for a player who told us they were going.
`hunt.endForSession` now ends it, and the route reads the cookie WITHOUT a guard so a sign-out
cannot fail with 401 and leave the browser holding the cookie it asked to drop (CX6).

### 2.6 Two numeric literals failed Phase 0B's own lint gate

`distributions.ts` carried coefficients written with more digits than a double holds, which
`no-loss-of-precision` refuses — and E3 runs the real ESLint, so a Phase 2 file broke a Phase 0B
case. The coefficients are now written in the shortest exponential form that round-trips to the
same double. The VALUES did not change: the golden fixture is byte-identical across the edit,
which is how that claim is checked rather than asserted.

### 2.7 "Current content" meant "whichever hash sorts highest"

Found by the browser suite, which entered a Hunt and got *"That content key is not a hunt"* — the
API was resolving a bundle with no rooms in it.

`currentVersion` orders by `publishedAt` and breaks a tie on the version string. `pnpm seed`
published every built bundle at ONE instant, so with more than one file in the output directory
the current content was whichever CONTENT HASH happened to sort highest — which is not a fact
about the game. A stale bundle left by an earlier build became the world, and every health check
stayed green while it did.

Publication is now ordered by when each bundle FILE was written, each at its own instant, so the
most recently built content is the current content and older bundles stay resolvable for the
Activities that pinned them. The developer bootstrap verifier now asserts it directly: the
version `/health/ready` reports must be the version this bootstrap just built. Readiness alone
only ever said that *some* bundle resolved.

CI never saw this — it builds and seeds into a fresh checkout with exactly one bundle — which is
precisely the shape of bug a developer machine finds and a pipeline does not.

---

## 3. Decisions the implementation had to make

### P2-D8 — the liveness window is ninety seconds, and the browser chose it

§8 requires a **backgrounded tab with a live connection** to keep advancing. Every current engine
clamps a hidden page's timers to roughly one firing per minute, so a window shorter than that
clamp treats a tab that is merely hidden as a connection that is gone — and an idle game whose
progress stops when you look away is not an idle game. Ninety seconds clears the clamp with
margin.

The cost is stated rather than hidden: the maximum unproven span is ninety seconds. A client that
genuinely dies is credited with up to that much time it did not connect for, once, after which
nothing advances at all.

### P2-D9 — the grace deadline is computed the same way by whoever asks

A sweep, a poll and the reconnect itself all derive `graceExpiresAt` from the last moment anyone
was PROVEN to be there: `lastSeenAt + LIVENESS_WINDOW + RECONNECT_GRACE`. An earlier version only
paused on a non-seen read, which meant a client could extend its own grace by staying away long
enough that the pause was never recorded. CX5 asserts the deadline by that formula.

A consequence worth naming: a browser client essentially never SEES
`RECONNECT_GRACE_PAUSED`, because its own read proves it is connected and resumes the run. The
paused state is for other observers — a sweep, a second session, the roster view. What the player
sees during a disconnect is the client's own reconnect banner, which is the client's honest
report of its own connection and says what the server is doing about it (GW5).

### P2-D10 — a Phase 2 golden fixture, frozen away from content

`tests/fixtures/engine/hunt-golden.json` pins the ENGINE against a profile and a room plan frozen
inside the fixture, not read from the bundle. A content retune must be free to change the first
fight without rewriting a golden file, and a change to the simulator must not be able to hide
behind one. The authored content is pinned separately, by SRC1 to SRC4, against the Canary import
record. Phase 0B's `golden.json` and `simulateActivity` are untouched.

### P2-D11 — the Canary import record is a transcription, not vendored source

`tests/fixtures/canary/import-record.json` holds 56 rows in the format `REFERENCES.md` requires:
source file, symbol, observed meaning, keep/simplify/adapt decision, the fixture that pins it,
and the exact literal that was read. No Canary code is copied into this repository. CI asserts
that the authored content matches the record; pointing `CANARY_SOURCE` at a real checkout
re-verifies every row against the files it cites, which is how the record itself is kept honest.

---

## 4. Corrections to the approved specification

Four numbers in the spec were wrong, and the implementation is the reason we know. Each was
corrected in the spec rather than worked around in the code.

| Was | Is | Why |
|---|---|---|
| `attackValue 8` | `attackValue 9.6` | The spec's own §3 says a weapon's Attack is compensated by 120% before it enters the formula, and that the profile authors the EFFECTIVE value. 8 × 120% = 9.6, which gives the maximum hit of 8 that the same document's fight table uses. The two statements contradicted each other; the table was right |
| `supply charges 10` | `charges 20` | Ten ends the run at about forty-five minutes, before the endless room has cycled more than once |
| room 10 = 5 rats | 4 rats | Five made the endless room a wall rather than a loop |
| "70 cases" | 74 | The ten group sizes printed beside it sum to 74. Every group size is fixed by something outside the document — ST and AU are `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §7's mandatory cases — so the total was the arithmetic error, not the groups |

**Measured, over 200 simulated runs of the shipped content:** every run reaches room 10 and every
run ends in death when the supplies run out. Median 95 minutes, 4 endless cycles, 40 kills,
200 Base XP, 101 Gold; the 10th and 90th percentiles are 91 and 101 minutes.

---

## 5. What two Phase 1 browser steps had to change, and what did not

Phase 1 shipped a placeholder surface that said "Combat arrives in Phase 2", and its E2E9 and
E2E10 steps asserted that text. Phase 2's approved spec §10 replaces that surface with the Game
Window, so those two steps now name the new surface.

**What they CLAIM is unchanged and is still Phase 1's**: ENTER creates a real Activity, the
Character is in it with Stamina NEUTRAL and untouched, RELOAD returns to the same Hunt from
durable state, and LEAVE releases it. The ids, the count and the contract are the same; only the
element they look at moved.

One unnumbered Phase 1 test guarded against Phase 2 vocabulary leaking into Phase 1. That guard
moves forward with the code rather than being deleted: it now refuses Phase 3's itemization —
inventory, equipment, loot, rarity, affixes — which Phase 2 §1.2 creates none of.

`stamina` stayed the Character panel's test id; the Game Window's readout is `run-stamina`. Two
elements answering to one test id is a test that passes by accident.

---

## 6. What Phase 2 deliberately did NOT do

- **No Phase 3 itemization.** No `BaseItem`, no `ItemInstance`, no inventory, no equipment, no
  loot table, no rarity, no affixes — and no shadow version of any of them. The tutorial combat
  profile is an immutable content-authored set of combat INPUTS and is explicitly temporary.
- **No coins.** The Gold Pouch is a currency CUSTODY SCOPE — a number in the ledger — not a stack
  of gold, platinum and crystal coins with weight and slots. Modelling three denominations as item
  stacks is Phase 3's, and doing it now would be the same shadow itemization. The name collision
  with Tibia's store container is recorded in the source map so a later phase does not import that
  item and find the name taken by a different idea.
- **No blessing shop, no Oracle, no Promotion flow.** Only the two columns the death policy reads.
- **No Bank UI, no deposit route, no NPC.** `transfer` exists and is balanced and tested, because
  the custody model would be unverifiable without it; nothing player-facing calls it yet.
- **No second vocation, spell, rune, condition or fight mode.** No creature but the Rat, no
  region but Rookgaard.
- **No party, no Shared XP.** ST12 and ST13 therefore prove the property a mixed party will rest
  on — that the Stamina predicate is per Character and XP cannot reach a co-participant — rather
  than pretending to test a container that does not exist. Both cases say so in their own bodies.
- **No production authentication.** The dev provider is still the only one, still behind
  `GLOBAL_IDLE_DEV_AUTH`.
- **No Imbuements.** Cases 29–38 of `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §7 are not in this matrix.
  The active-use timer settlement they will need is here, driven by AU25–AU28 through an injected
  timer id, because Phase 2 ships no timed effect to own one.
- **`simulateActivity` is untouched.** Phase 0B's E1 and E2 pin it against a committed golden
  file, and breaking a VERIFIED test to make a new phase pass is not a trade this project makes.

---

## 7. Instrumented browser walkthrough

An instrumented walkthrough, run against the real stack — `pnpm build`, migrate, build the bundle,
seed, the real API on 3001 and `next start` on 3000 — on **both** viewports. Instrumented rather
than watched so the evidence is checkable: the console, page errors and every response status were
recorded rather than glanced at.

**Called what it is.** This section used to be headed "manual browser validation", which reads as a
person at a screen and is not what happened. A script drove a real browser through the real flow
and recorded what came back. That is strong evidence about state, flow and error channels, and it
is no evidence at all about whether the scene looks right — so the name now says the first thing
and stops implying the second.

| Step | Desktop 1440×900 | Touch 390×844 |
|---|---|---|
| Sign in, create a Character | ok | ok |
| Atlas renders, and no Game Window on it | ok | ok |
| Marker → Enter → Game Window opens | ok | ok |
| Combat runs with nothing pressed | 8 log lines, e.g. *"You block the attack"* | same |
| Scene shows server state | Room 1, Rat 18/20, self 149/150 | same |
| Readouts | xp 0, pouch 0, stamina 42:00 NEUTRAL | same |
| Room and cycle come from the row | Room 10 · cycle 2 | same |
| Reload returns from durable state | Room 10 | same |
| Death is shown, with what it cost | *"Lost 101 experience \| Lost 1 gold from your pouch"* | same |
| Death is durable | xp 1005 → 904, level 5, pouch 1 → 0 | same |
| The Bank is untouched | **no row at all** | same |
| Back to the Atlas, then Leave | ok | ok |

```text
desktop: console errors 0, page errors 0, HTTP>=400 0
touch:   console errors 0, page errors 0, HTTP>=400 0
```

The death numbers are the formula, checkable by hand: an unblessed vocation-less Character at
1,005 experience loses `ceil(1005 × 0.10) = 101`, and 904 is still level 5, so it is not demoted.
The single gold coin is what one Rat happened to drop, and it is gone.

**What this is not:** a person's eyes on the layout. It exercises the flow, the state and the
error channels; it does not judge whether the scene looks good. A genuinely interactive visual pass
is still owed, and it is a reviewer's to do, not this script's to claim.

---

## 8. How to check this

```sh
pnpm install
pnpm build
node scripts/count-matrix.mjs          # 92/92, 87/87, 106/106
pnpm test:unit && pnpm test:fixtures   # includes SIM, SRC and the pure DL cases
pnpm test:integration                  # includes ST, AU, RW, SU, DE, CX, PS, DL, GP, BL
pnpm test:invariants
# The integration and invariant suites TRUNCATE every table between cases,
# including ContentBundle, so a local run leaves the database with no published
# content. Re-seed before the browser suite, or it will enter a Hunt and be
# told the content key is not a hunt. CI does not hit this: the browser job is
# a job of its own, with its own database and its own seed step.
pnpm --filter @global-idle/game-data run build:bundle && pnpm seed
pnpm test:e2e                          # includes GW1-GW8, desktop and touch

# Re-verify the Canary import record against a real checkout:
CANARY_SOURCE=/path/to/canary pnpm test:fixtures
```
