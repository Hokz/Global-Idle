# Phase 2 — Implementation notes

**Status:** `IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`
**Spec:** [`PHASE_2_HUNT_SIMULATOR_SPEC.md`](./PHASE_2_HUNT_SIMULATOR_SPEC.md) ·
**Evidence:** [`PHASE_2_CANARY_SOURCE_MAP.md`](./PHASE_2_CANARY_SOURCE_MAP.md)
**Matrix:** Phase 2 74/74, with Phase 0B 92/92 and Phase 1 87/87 still passing.

This document records what the implementation DECIDED, what it FOUND, and what it COST — the
things a specification cannot know in advance. It is not a summary of the spec.

---

## 1. What exists now

A Level-1 pre-vocation Character can enter the Rookgaard Sewers from the Atlas and be watched
fighting. Rats spawn, the Character attacks on its own cadence, damage resolves through Canary's
reduction chain, creatures die, rooms clear, room 10 repeats forever. Base XP and Gold are
durable and ledger-backed. Stamina starts burning at the first qualifying XP and not before.
Supplies are consumed and run out. The Character can die. Closing the lid keeps it running;
losing the connection pauses it for exactly five minutes and then ends it.

| Layer | What Phase 2 added |
|---|---|
| `@global-idle/game-engine` | `simulateHunt`, `initialState`, `maxMeleeHit`, `minMeleeHit`, and `distributions.ts` (Canary's `normal_random` / `uniform_random`) |
| `@global-idle/game-data` | `creature`, `combat-profile`, hunt `rooms`; build-time validation of the room plan |
| `packages/domain` | the `hunt` context (`run`, `plan`, `rewards`, `progression`), durable Stamina settlement in the `character` context, `occupancyFor` in the `activity` context |
| database | `HuntRun`, `HuntEndReason`, `Character.baseXp` |
| `apps/api` | `GET /characters/:id/hunt`, `POST /characters/:id/hunt/heartbeat`, and sign-out now ends the Activity |
| `apps/web` | the first **Game Window** |

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

`tests/fixtures/canary/import-record.json` holds 39 rows in the format `REFERENCES.md` requires:
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

## 7. How to check this

```sh
pnpm install
pnpm build
node scripts/count-matrix.mjs          # 92/92, 87/87, 74/74
pnpm test:unit && pnpm test:fixtures   # includes SIM1-SIM10 and SRC1-SRC4
pnpm test:integration                  # includes ST, AU, RW, SU, DE, CX, PS
pnpm test:invariants
pnpm test:e2e                          # includes GW1-GW8, desktop and touch

# Re-verify the Canary import record against a real checkout:
CANARY_SOURCE=/path/to/canary pnpm test:fixtures
```
