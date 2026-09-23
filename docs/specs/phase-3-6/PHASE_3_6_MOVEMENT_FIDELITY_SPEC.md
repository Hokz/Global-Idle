# Phase 3.6 — Movement fidelity: Character speed and tile ground speed

Stacked on Phase 3.5, which is `VERIFIED` at `2e67f4b`. Status: see
[`docs/PROJECT_STATE.json`](../../PROJECT_STATE.json).

---

## 1. Goal, and what this is not

**A step's duration must depend on who is walking and on what they are standing on.**

Phase 3.5 imported the source's step-duration curve, the 50 ms beat, the ×3 diagonal and an
authoritative movement leg. It left two of the curve's three inputs as constants: every Character
walked at the level-1 speed the plan happened to compute, and every tile was the 150 fallback.
Phase 3.6 finishes the inputs. The engine, the beat, the timeline and the renderer are not rebuilt.

That matters because travel time is **economy**, not animation:

```
travel time -> combat uptime -> kills/hour -> XP, Gold and loot per hour
```

A level-64 Character on fast ground finishes **twice** the encounters of the same Character on
default ground in the same authoritative twelve minutes (§9). That is the whole product point.

**Not in this phase:** haste, paralyze, equipment speed, Boots of Haste, mounts, prey, charms,
Party, tactical AI, spell or healing automation, skill progression, multi-floor maps,
travel-time-optimised pathfinding, a WebSocket loop, and any ingestion of real client assets.
Seams are left; frameworks are not speculated.

---

## 2. Where the numbers come from

[`PHASE_3_6_CANARY_MOVEMENT_FIDELITY_SOURCE_MAP.md`](./PHASE_3_6_CANARY_MOVEMENT_FIDELITY_SOURCE_MAP.md)
records every claim against `Hokz/canary@f6b81a8`, each labelled KEEP, ADAPT or DEFER. The four
that this specification rests on:

| | source | |
|---|---|---|
| the curve | `Creature::updateCalculatedStepSpeed` | `floor(857.36·ln(speed + 261.29) − 4795.01 + 0.5)`, floored at 1 |
| the duration | `Creature::getStepDuration` | `floor(1000 × groundSpeed / calculated)`, rounded UP to 50 ms, ×3 for a diagonal — **in that order** |
| the ground | `Creature::setParent` | 150 unless the tile's ground authors a positive speed |
| the Character | `Player::updateBaseSpeed` | `vocation base + (level − 1)`, and every vocation's base is 110 |

---

## 3. A Character's own speed

```ts
playerBaseStepSpeed(level, vocationBaseSpeed = 110)  //  110 + (level - 1), clamped
```

One pure function in the engine, so a test has a stable target and the clamp lives beside the
curve. The vocation base is a **parameter** rather than a table because the source has nothing for
a table to say: None, Sorcerer, Druid, Paladin, Knight, Monk and every promotion all carry
`basespeed="110"`. Inventing a spread would be a product decision wearing a source's clothes, and
Phase 4 can pass a different base without this function changing shape.

It is clamped to `PLAYER_MIN_STEP_SPEED = 10` and to the source's uint16 ceiling, which is why a
Character can never reach the "step speed ≤ 0, do not walk" branch that a creature can (§7).

**No database column.** Speed is a pure derivation from level; caching it would be a second truth
to keep in step with the first.

---

## 4. Ground speed is content

A legend symbol may now carry the ground's own speed:

```jsonc
"legend": {
  "#": "wall",                                  // a kind on its own
  ".": { "kind": "floor", "groundSpeed": 100 }  // a kind, and its ground
}
```

- absent means the source's **150** fallback;
- a positive integer from 1 to 65535 (the source's `uint16_t`) overrides it;
- **a literal `0` is refused**, with the symbol named. Canary spells "no ground speed of its own"
  as an absent flag; this format spells it as an absent field, and one meaning does not need two
  spellings;
- negative, fractional, `NaN` and out-of-range values are refused the same way, at content build.

Both spellings are normalised in **one function**, `readLegendEntry`, so two ways of writing a tile
never become two ways of meaning one.

> **LOWER `groundSpeed` is a FASTER step.** The duration is proportional to it —
> `floor(1000 × groundSpeed / calculatedStepSpeed)`. This reads backwards the first time and it is
> the source's own arithmetic, kept rather than inverted so that an imported value needs no
> translation.

There is no float "friction" multiplier. Ground speed is integer source data, and the real values
in the client appearance archive are integers like 50, 100, 150, 200 and 850.

### 4.1 The compiled map

`TileMap` gains `groundSpeed: Uint16Array`, one entry per tile, filled by the compiler beside
`flags` and `kind`, and read through `groundSpeedAt(map, position)`.

- **O(1)**, an index rather than a branch: a movement beat runs twenty times per simulated second
  and must never touch the content bundle to do it;
- non-walkable tiles carry the fallback, because nothing ever departs from one;
- off the map, and on another floor, answers the fallback rather than throwing — the same choice
  `canOccupy` makes;
- **no database row per tile.** A static grid has no lifecycle, no ownership and no transaction.

Because the map is compiled from the bundle, a published version pins its ground speeds exactly as
it pins its walls (`VER1`).

---

## 5. The leg is timed by the tile it LEAVES

```ts
const ground = groundSpeedAt(space.map, from);
const base = stepDurationMs(speed, ground);
const duration = diagonal ? base * DIAGONAL_STEP_FACTOR : base;
```

The source caches `walk.groundSpeed` in `setParent` — when the creature is placed on a tile — and
`getStepDuration` divides by that cache. So the mud you are standing in is what slows the step out
of it, and stepping **onto** stone does not make that step fast. `GRD3` asserts this directly with
two mirror-image maps, and it fails if the destination tile is used instead.

A duration belongs to the leg **when the leg is created**. `startsAtMs` and `arrivesAtMs` are
absolute simulation milliseconds already persisted by Phase 3.5, so an in-flight leg is never
recomputed — not at a settlement boundary, not after a restart, not against a newer bundle
(`DET1`, `DET2`, `VER1`).

---

## 6. Breakpoints — what "bugging speed" actually is

Nothing sets a state. The staircase is the 50 ms rounding, and it is the whole phenomenon.

Derived from the source formula (`calculated = floor(857.36·ln(speed + 261.29) − 4795.01 + 0.5)`,
then `ceil(floor(1000·ground/calculated) / 50) × 50`):

| level | raw speed | calculated | ground 50 | 100 | **150** | 200 | 850 |
|---|---|---|---|---|---|---|---|
| 1 | 110 | 278 | 200 | 400 | **550** | 750 | 3100 |
| 8 | 117 | 294 | 200 | 350 | **550** | 700 | 2900 |
| 11 | 120 | 301 | 200 | 350 | **500** | 700 | 2850 |
| 20 | 129 | 321 | 200 | 350 | **500** | 650 | 2650 |
| 50 | 159 | 384 | 150 | 300 | **400** | 550 | 2250 |
| 64 | 173 | 412 | 150 | 250 | **400** | 500 | 2100 |
| 100 | 209 | 481 | 150 | 250 | **350** | 450 | 1800 |
| 200 | 309 | 646 | 100 | 200 | **250** | 350 | 1350 |
| 500 | 609 | 1008 | 50 | 100 | **150** | 200 | 850 |
| 1000 | 1109 | 1398 | 50 | 100 | **150** | 150 | 650 |

Three things a reader should take from that table, and each is a case:

- **plateaus.** Levels 1 to 10 all step in 550 ms on default ground. The bands begin at levels
  1, 11, 26, 46, 72, 110, 169 and 271 (`BRK1`, `BRK2`).
- **ground moves the plateau.** Level 8 has not left 550 on default ground but has *already*
  crossed a band on ground 100 — 400 at level 1, 350 at level 8. A slower ground keeps limiting a
  high-level Character: level 200 is still 1350 ms a step on ground 850 (`BRK3`).
- **a floor of one beat.** At 50 ms the quantization runs out of room, and more speed buys nothing.
  That is where "bugging speed" bottoms out — level 500 on ground 50 reaches it, and level 5000
  gets no further.

---

## 7. An actor that cannot walk

`Creature::addEventWalk` refuses to schedule a walk when `getStepSpeed() <= 0`. The engine mirrors
it: a creature authored at speed 0 is **immobile**, not a crawler moving at the curve's floor. The
content schema already permits `speed: 0` and now documents what it means (`SPD6`, and the engine
guard in `departFor`).

The asymmetry is the source's own: a Character is clamped to 10 first and cannot reach that branch;
a creature is taken at its word. Roots and paralyze are conditions, and this phase builds none.

---

## 8. The pathfinder does not know about ground speed

Deliberately, and this is the counterintuitive part:

> **Ground speed decides how long a step TAKES. It is not a term in what a route COSTS.**

`AStarNodes::getMapWalkCost` is topology only — 10 cardinal, 35 diagonal — and `getTileWalkCost`
adds creature and field terms, neither of which reads `ItemType::speed`. So a route across slow mud
can be chosen over a longer route on fast stone, and in the source it is. `PTH16` builds exactly
that temptation and asserts the source's answer.

A `FASTEST_TIME_PATH` tactical option would be a Global Idle **product adaptation**, not fidelity.
It is deferred, and the case exists so the deferral cannot rot into a silent change.

Nothing else about Phase 3.5's pathfinding moves: eight directions, the 10/35 costs, the admissible
`manhattan × 10` heuristic, no corner rule, and the deterministic tie-break.

---

## 9. Throughput — the reason this is not a formula change

`THR1` and `THR2` run a corridor with a Rat at each end, published beside the real content, and
change exactly one thing. Twelve minutes of authoritative time, same seed, same creatures, same
geometry:

| | step on this ground | tiles walked | **encounters finished** |
|---|---|---|---|
| level 64, ground 150 | 400 ms | 1,277 | **28** |
| level 64, ground 50 | 150 ms | 2,047 | **56** |

Faster ground, twice the work done. The metric is an integer count of completed cycles rather than
an XP number a retune would move.

The level axis is asserted where it is isolated — the **leg duration**, which is player speed and
nothing else (550 ms at level 1, 400 ms at level 64 on the same ground) — and then as throughput,
with the honest note that a higher level also kills faster.

---

## 10. The production map is deliberately unchanged

The prototype Rookgaard Sewers stays at the 150 fallback. Its tiles have no sourced metadata:
Canary reads a ground's speed from the client appearance archive's `bank.waypoints`, and that
archive is not in this repository yet. Authoring plausible-looking numbers would be inventing
source data, which is the one thing a fidelity phase must not do.

Every multi-speed case therefore runs on a **dedicated test fixture** — a corridor published beside
the real content, never on it.

The data shape is ready for the importer that Phase 3.7 will bring: a tile definition already
carries a kind and a ground speed, and visual identity is the only field it still lacks. The
movement engine will not need to change again to consume it.

---

## 11. Guardrails kept

- integer movement times, and a 50 ms authoritative beat;
- no second game loop, no per-frame server simulation, no per-step content parsing, no database
  tile reads;
- deterministic actor ordering, persisted in-flight legs, RNG checkpoint continuity (`DET3`
  re-asserts Phase 3.5's partition invariance with ground speeds in play);
- a pure `GET` snapshot and an explicit `POST` advance;
- the client renders the authoritative leg and chooses nothing: `REN1` measures a 3,000 ms leg
  taking 3,000 ms of wall clock on screen, and the same measurement reads 685 ms for a 700 ms leg.

---

## 12. Decisions

| Id | Decision | Why |
|---|---|---|
| P36-D1 | Ground speed is authored **content**, per legend symbol, as an integer | it is client asset metadata in the source, not a server config value |
| P36-D2 | A legend symbol may be a kind **or** a kind with metadata, normalised in one function | most tiles have nothing extra to say; two spellings must not become two meanings |
| P36-D3 | A literal `groundSpeed: 0` is **refused** | absence already means "no speed of its own" |
| P36-D4 | The compiled map carries a dense `Uint16Array` | O(1) per step; a movement beat may not parse content |
| P36-D5 | A leg is timed by the tile it **departs** from | `Creature::setParent` caches the ground of the tile the actor is placed on |
| P36-D6 | A duration is fixed when the leg is **created** | the leg is already durable; recomputing it would let content changes retime a step in flight |
| P36-D7 | `playerBaseStepSpeed` is a pure engine function, with the vocation base as a parameter | every vocation is 110 today; Phase 4 must not have to rewrite movement |
| P36-D8 | Speed is derived, never a database column | caching a pure derivation creates a second truth |
| P36-D9 | A creature at speed 0 is **immobile** | `Creature::addEventWalk` refuses, rather than letting the curve's floor make it crawl |
| P36-D10 | The pathfinder stays **independent** of ground speed | the source's A\* is topology; a time-optimal route is a product feature and is deferred |
| P36-D11 | The production Sewers keeps the 150 fallback | no sourced tile metadata exists yet; invented values would be fake fidelity |
| P36-D12 | A step duration above **65,535 ms** is **refused**, not clamped and not wrapped | `Creature::getStepDuration` caches into `uint16_t walk.duration` and returns `uint16_t`; beyond that the source is undefined on one path and silently wrong on the other, and neither is behaviour worth reproducing |
| P36-D13 | The ceiling binds the **cardinal** duration *and* the cost-multiplied one | verified at the pinned commit: the cast narrows the cache, and `duration *= WALK_DIAGONAL_EXTRA_COST` narrows the product back into the same 16 bits |
| P36-D14 | The step cost (1 or 3) is an **argument to** `stepDurationMs`, not a multiplier applied to its result | only the function that owns both limits can say whether a step is representable |
| P36-D15 | `MAX_GROUND_SPEED` stays **65,535** and means *representation*, not walkability | it is `uint16_t iType.speed`; whether a stored ground can be walked is a question about the resulting duration, and a different check answers it |
| P36-D16 | `compileMap` refuses ground the **slowest Character** could not walk diagonally | ground no Character can use is a map that should never have compiled, and a map is the cheapest place to say so |
| P36-D17 | The engine still refuses at **step time** for a creature slower than that yardstick | a creature and a map meet only in a plan; the guard has to live where the pair is actually known |
| P36-D18 | The one-beat **floor** stays, as a documented ADAPT | where the source's cardinal rounds to 0 it stores 0, permanently fails `needRecache()` and stops walking for good; a frozen creature is not a speed |

---

## 13. The supported movement domain

Added by the blocker correction. Everything above says what a step costs; this section says where
that answer is still the SOURCE'S answer, because the first pass shipped durations the source
cannot express and tests that asserted them.

### 13.1 What Canary can represent

`Creature::getStepDuration` narrows to `uint16_t` in **two** places, and the difference matters:

```cpp
if (walk.needRecache()) {
    auto duration = std::floor(1000 * walk.groundSpeed / walk.calculatedStepSpeed);
    walk.duration = static_cast<uint16_t>(std::ceil(duration / SERVER_BEAT) * SERVER_BEAT);
}                                        //  (1) double -> uint16_t

auto duration = walk.duration;           //  uint16_t
if ((dir & DIRECTION_DIAGONAL_MASK) != 0) {
    duration *= WALK_DIAGONAL_EXTRA_COST; //  (2) product narrowed back to 16 bits
}
return duration;                          //  uint16_t
```

1. the cached **cardinal** duration. The operand is a `double`; a `double` outside the destination
   integer's range is **undefined behaviour** in C++, not a wrap with a value;
2. the **returned** duration. `auto` deduces `uint16_t`, so the diagonal product — and the
   `WALK_TARGET_NEARBY_EXTRA_COST` one beside it — is narrowed modulo 65,536, which for an unsigned
   type is defined and silent. `getWalkDelay` multiplies by `lastStepCost` into a `uint16_t` the
   same way.

So the tempting reading — "the limit is on the cached value" — is wrong on its own. A cardinal
duration can fit perfectly and still have its diagonal wrap.

### 13.2 Both regions are reachable from real content

| Case | Cardinal | Diagonal | What Canary does |
|---|---|---|---|
| monster speed 15 on ground 1200 | 48,000 ms, fits | 144,000 ms | returns **12,928 ms** — a diagonal faster than the cardinal it triples |
| monster speed 25 on ground 1200 | 21,850 ms, fits | 65,550 ms | returns **14 ms** |
| a player at `PLAYER_MIN_SPEED` (10) on ground 1200 | 133,350 ms | — | `static_cast<uint16_t>(133350.0)` — undefined |

1,200 is the largest `bank.waypoints` in the pinned `appearances.dat` and 15 the slowest non-zero
`monster.speed` in the shipped data, so none of those rows needs a debuff or invented content.

### 13.3 What Global Idle does instead

**Refuses.** Reproducing undefined behaviour is not fidelity; reproducing a silent modular wrap is
not fidelity either; clamping to 65,535 would be a number the source never produced. Outside the
domain `stepDurationMs` throws `StepDurationError` naming both inputs and the duration it would
have taken, and `supportedStepDurationMs` answers `null` for callers that want the question without
the exception. There is exactly one ceiling constant, `MAX_STEP_DURATION_MS`, and one function that
applies it.

The boundary in numbers, at the level-1 Character's divisor of 278:

| | Largest supported | First refused |
|---|---|---|
| cardinal | 65,500 ms (ground 18,209) | 65,550 ms (ground 18,210) |
| diagonal | 65,400 ms (ground 6,060) | 65,550 ms (ground 6,061) |

### 13.4 Where the refusal is enforced

- `compileMap` refuses an authored ground speed the **slowest Character the game can produce** could
  not walk diagonally — level 1 at the vocation base, speed 110. That is what reconciles content
  with the engine: `MAX_GROUND_SPEED` stays 65,535 because that is what `uint16_t iType.speed` can
  hold, and walkability is asked separately, of the same authority, at compile time;
- `stepDurationMs` refuses at step time, which is the only place a CREATURE's speed and a map's
  ground actually meet.

### 13.5 The one-beat floor is an ADAPT, and it is the other end

Where `floor(1000 × groundSpeed / calculatedStepSpeed)` rounds to zero — a fast actor on ground
speed 1, of which the client data has 120 — the source stores `walk.duration = 0`. `needRecache()`
is `duration == 0`, so it never clears, `getStepDuration` keeps returning 0, `getEventStepTicks`
returns 0 and `addEventWalk` declines to schedule anything: that creature stops walking for good.
Global Idle issues one beat. A deliberate divergence, recorded as **ADAPT**, and a floor rather than
a ceiling so it can never hide an unrepresentable number.

---

## 16. Acceptance matrix — 33 cases

Counted by `scripts/count-matrix.mjs`; every case is exactly one test whose title begins with its
id and a colon.

| Group | Cases | What it fixes |
|---|---|---|
| **SPD** | 1–6 | the actor's own speed: the source constants reproduce known durations, level 1 is 110, +1 per level, every vocation is 110, the player floor and uint16 ceiling, and the curve's **divisor** floors at 1 |
| **GRD** | 1–7 | the ground: the 150 fallback, an authored value per tile, **the leg is timed by the tile it leaves**, lower means faster, an O(1) compiled array, unrepresentable values refused by symbol, and the diagonal factor applied after the beat rounding |
| **BRK** | 1–3 | the staircase: a plateau absorbs added speed, a breakpoint changes the duration by a whole beat, and the same Character sits on different steps on different ground — down to the one-beat floor |
| **THR** | 1–2 | the point: faster ground finishes more encounters in the same authoritative time, and a higher level shortens the legs and covers more ground |
| **PTH** | 16 | ground speed is not a term in the A\* cost — **continues Phase 3.5's numbering**, which owns PTH1–PTH15 |
| **REN** | 1–2 | the browser draws a leg over its own duration rather than a fixed ease, and the client changes neither the 15 × 11 world nor the server's timing |
| **VER** | 1 | a running Activity keeps the ground speeds of the bundle it pinned; a run started after the publish gets the new ones |
| **DET** | 1–3 | a variable-duration leg survives a fresh process on slow ground and on fast, and settlement partitioning still cannot change a mixed-ground run |
| **DOM** | 1–8 | the supported domain: the ceiling is the source's `uint16_t` and binds in **two** places, the exact cardinal boundary, the **tighter** diagonal boundary, refusal rather than a clamp or a wrap, the asking face and the refusing face agreeing, a representable-but-unwalkable ground refused when the map compiles, the one-beat floor named as an ADAPT, and every ground the real client data authors proven inside the domain |

Inherited and unchanged: Phase 0B **92**, Phase 1 **87**, Phase 2 **106**, Phase 3 **169**,
Phase 3.5 **95**.

---

## 17. Status

`IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`. This phase has **not** been independently
reviewed and is not `VERIFIED`. Nothing in this document should be read as approval.
