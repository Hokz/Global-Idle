# Phase 3.6 — Canary movement fidelity: source map

**Pinned commit:** `f6b81a855aa8e7e34cb98821ceb39ff97e3afa4e` (`f6b81a8`), `Hokz/canary`.

Every row below was read out of that checkout while writing this phase. Each is labelled:

| label | meaning |
|---|---|
| **KEEP** | Global Idle implements the source's behaviour as it stands |
| **ADAPT** | the source's *shape* is kept, the *mechanism* differs, and the difference is stated |
| **DEFER** | the source has it, Global Idle does not build it in this phase, and a later phase owns it |

Phase 3.5 already imported the topology, the step-duration curve and the 50 ms beat
(`PHASE_3_5_CANARY_SPATIAL_SOURCE_MAP.md`). This map covers only what Phase 3.6 adds: where a step's
duration actually comes from, and what a Character's speed is.

---

## 1. The speed curve — SOURCE, KEEP

`src/creatures/creature.hpp:76-78`

```cpp
static constexpr double speedA = 857.36;
static constexpr double speedB = 261.29;
static constexpr double speedC = -4795.01;
```

`src/creatures/creature.hpp:1089-1098` — `Creature::updateCalculatedStepSpeed()`

```cpp
const auto stepSpeed = getStepSpeed();
walk.calculatedStepSpeed = 1;
if (stepSpeed > -Creature::speedB) {
    const auto formula = std::floor((Creature::speedA * std::log(stepSpeed + Creature::speedB) + Creature::speedC) + .5);
    walk.calculatedStepSpeed = static_cast<uint16_t>(std::max(formula, 1.));
}
```

Two guards worth naming, because both are observable:

- `stepSpeed > -speedB` — a step speed at or below `-261.29` leaves `calculatedStepSpeed` at **1**,
  so the logarithm is never taken of a non-positive number;
- `max(formula, 1.)` — the DIVISOR is floored at **1**, so there is never a division by zero.

Global Idle's `calculatedStepSpeed` implements both. **KEEP.**

What the second guard does *not* say is that the resulting step is one the source can express. A
divisor of 1 makes the duration 1,000 × the ground speed, which passes `uint16_t walk.duration` at
ground 65 and fails at 66. The first pass read the floor as a statement about durations and
asserted `stepDurationMs(1) === 150_000`; §2.1 is the correction.

---

## 2. Step duration, and the order of its operations — SOURCE, KEEP

`src/creatures/creature.cpp:1690-1710` — `Creature::getStepDuration(Direction)`

```cpp
if (walk.needRecache()) {
    auto duration = std::floor(1000 * walk.groundSpeed / walk.calculatedStepSpeed);
    walk.duration = static_cast<uint16_t>(std::ceil(duration / SERVER_BEAT) * SERVER_BEAT);
}

auto duration = walk.duration;
if ((dir & DIRECTION_DIAGONAL_MASK) != 0) {
    duration *= WALK_DIAGONAL_EXTRA_COST;
}
```

Constants: `SERVER_BEAT = 0x32` = **50** (`src/game/game.hpp:64`),
`WALK_DIAGONAL_EXTRA_COST = 3` (`src/creatures/creature.hpp:45`).

The ORDER is the contract, and Phase 3.6 preserves it exactly:

1. the log curve gives `calculatedStepSpeed`;
2. `1000 × groundSpeed / calculatedStepSpeed`, floored;
3. rounded **up** to the next 50 ms;
4. and only then multiplied by 3 for a diagonal.

Rounding after the diagonal multiply, or multiplying before the floor, moves the breakpoints. The
staircase this produces is §8 of the spec. **KEEP.**

`WALK_TARGET_NEARBY_EXTRA_COST = 2` (`creature.hpp:43`, applied at `creature.cpp:1703-1707`) slows a
monster that is already beside its target. Global Idle's creatures stop when adjacent, so it would
change nothing. **DEFER** — recorded in Phase 3.5's map for the same reason.

### 2.1 What that arithmetic can REPRESENT — ADAPT

Added by the blocker correction, after re-reading the pinned source rather than assuming. Five
things are deliberately kept apart here, because the first pass ran them together:

| | |
|---|---|
| the mathematical curve | unbounded above; at a divisor of 1 the duration is 1,000 × ground speed |
| the source's storage | `uint16_t` — `walk.groundSpeed`, `walk.calculatedStepSpeed` and `walk.duration` are all `uint16_t` (`creature.hpp:1077-1079`), and `getStepDuration` **returns** `uint16_t` |
| the reachable source-content domain | ground speed 0–1,200 and monster speed 0 or 15–530, from the shipped data (§3.1 and below) |
| Global Idle's supported domain | every pair whose cardinal **and** cost-multiplied duration is ≤ 65,535 ms |
| the deliberate adaptation | outside it Global Idle **refuses**; and at the other end it floors at one beat |

The `uint16_t` binds in **two** places, which is the question a reviewer asked to have checked
rather than assumed:

1. the **cached cardinal** — `walk.duration = static_cast<uint16_t>(...)` converts a `double`. A
   `double` whose truncated value is outside the destination's range is **undefined behaviour** in
   C++ ([conv.fpint]); there is no defined result to reproduce;
2. the **returned** value — `auto duration = walk.duration` deduces `uint16_t`, so
   `duration *= WALK_DIAGONAL_EXTRA_COST` narrows the product back into 16 bits. For an unsigned
   type that is a defined, silent modular wrap. `getWalkDelay` (`creature.cpp:108-120`) multiplies
   by `lastStepCost` into a `uint16_t` the same way.

So a cardinal duration that fits perfectly can still have its diagonal wrap, and it is not a corner
of invented content:

| Pair (both from shipped data) | Cardinal | Diagonal, unnarrowed | What Canary returns |
|---|---|---|---|
| `monster.speed` 15 on ground 1200 | 48,000 ms | 144,000 ms | **12,928 ms** — faster than the cardinal it triples |
| `monster.speed` 25 on ground 1200 | 21,850 ms | 65,550 ms | **14 ms** |
| a player at `PLAYER_MIN_SPEED` 10 on ground 1200 | 133,350 ms | — | undefined |

**ADAPT.** Global Idle reproduces neither the undefined cast nor the wrap: `stepDurationMs` refuses
outside the domain and says which two numbers caused it. Copying a C++ narrowing would be copying a
defect and calling it fidelity. The engine's `MAX_STEP_DURATION_MS` is the single statement of the
ceiling, and spec §13 has the boundary numbers.

Because the first row of that table is two SHIPPED numbers rather than a pathological one, the
refusal cannot be left to the simulator: a Hunt is proved against its own map when its plan is
built, so content that cannot be simulated is refused before an Activity starts (spec §13.5). That
proof covers the CHARACTER as well as the creatures — `basespeed="110"` is what the source's
vocations happen to carry, not a rule the source states, and Global Idle's baseline schema accepts
any positive value.

---

## 3. Ground speed belongs to the tile the actor is STANDING ON — SOURCE, KEEP

`src/creatures/creature.cpp:1815-1835` — `Creature::setParent`

```cpp
const auto oldGroundSpeed = walk.groundSpeed;
walk.groundSpeed = 150;

if (const auto &lockedCylinder = cylinder.lock()) {
    const auto &newParent = lockedCylinder->getTile();
    position = newParent->getPosition();
    m_tile = newParent;

    if (newParent->getGround()) {
        const auto &it = Item::items[newParent->getGround()->getID()];
        if (it.speed > 0) {
            walk.groundSpeed = it.speed;
        }
    }
}
```

Three facts fall out of those twenty lines, and all three are behaviour:

1. **150 is the fallback**, hard-coded, applied before anything is looked up;
2. only a **positive** authored speed replaces it — `it.speed == 0` leaves the fallback standing;
3. the cached `walk.groundSpeed` is the speed of the tile the creature was just placed on, so the
   duration of its NEXT step is decided by the tile it is **departing from**, never the destination.

Point 3 is the one that is easy to get backwards, and Global Idle asserts it directly (`GRD3`).
**KEEP.**

### 3.1 Where a ground's speed actually comes from — SOURCE, informs Phase 3.7

`src/items/items.cpp:230`

```cpp
iType.speed = object.flags().has_bank() ? static_cast<uint16_t>(object.flags().bank().waypoints()) : 0;
```

`src/protobuf/appearances.proto:133, 198-200`

```proto
optional AppearanceFlagBank bank = 1;
message AppearanceFlagBank { optional uint32 waypoints = 1; }
```

A ground tile's speed is the client appearance's `bank.waypoints`, read from
`data/items/appearances.dat`. It is **client asset metadata**, not a server config value — which is
exactly why Phase 3.6 does not invent speeds for the prototype Rookgaard Sewers (spec §12) and why
the Phase 3.7 importer has a precise field to read.

Decoding the shipped `data/items/appearances.dat` at the pinned commit — 42,107 appearance objects,
with the same minimal protobuf reader Phase 3 already uses for `cumulative` — the real distribution
of authored ground speeds is:

| `bank.waypoints` | appearances | reading |
|---|---|---|
| 0 | 272 | "not set" — `it.speed > 0` fails, so the actor keeps 150 |
| 1 | 120 | |
| 50 | 5 | the fastest authored ground |
| 70 · 90 · 95 | 29 | fast |
| 100 | 834 | common fast ground |
| 110 · 115 · 120 · 121 · 125 · 130 · 140 | 392 | |
| **150** | **1097** | the most common value, and the same number as the fallback |
| 160 · 170 · 180 | 257 | |
| 200 | 105 | slow |
| 250 · 260 · 300 · 350 · 400 · 450 · 500 | 89 | very slow |
| 800 · 850 | 4 | very slow |
| 1000 · 1200 | 3 | the slowest authored ground |

**CORRECTED** by the blocker correction: the last row was missing. The first pass's table stopped at
`800 · 850` and called that "the slowest authored ground", dropping three appearances — two at
1,000 and one at 1,200. The omission mattered, because 1,200 is exactly where a slow creature's
diagonal step leaves the `uint16_t` the source returns (§2.1). The histogram was re-decoded from the
same file to produce this row.

Those are the numbers Phase 3.6's fixtures use where a representative value is needed — 50, 100,
150, 200 and 850 — rather than invented ones.

### 3.2 A literal zero — ADAPT

Canary says "this ground has no speed of its own" by the flag being absent or `waypoints == 0`, and
both land on the same branch. Global Idle already has one way to say that: leave `groundSpeed` off
the tile definition. Authoring a literal `0` would be a second spelling of the same thing and, far
more likely, a mistake — so content validation **refuses** it and says which symbol. One way to say
one thing. **ADAPT**, stated here because it is a deliberate divergence.

---

## 4. A player's base speed — SOURCE, KEEP

`src/creatures/players/player.cpp:7338-7346` — `Player::updateBaseSpeed`

```cpp
const uint32_t computedSpeed = vocation->getBaseSpeed() + (level - 1);
baseSpeed = static_cast<uint16_t>(std::min<uint32_t>(computedSpeed, maxSpeed));
```

`src/creatures/players/player.hpp:124-126, 2045-2048`

```cpp
static constexpr uint16_t PLAYER_MAX_SPEED = std::numeric_limits<uint16_t>::max();
static constexpr uint16_t PLAYER_MIN_SPEED = 10;

uint16_t getStepSpeed() const override {
    const uint16_t maxStepSpeed = hasFlag(PlayerFlags_t::SetMaxSpeed) ? PLAYER_MAX_STAFF_SPEED : PLAYER_MAX_SPEED;
    return std::max<uint16_t>(PLAYER_MIN_SPEED, std::min<uint16_t>(maxStepSpeed, getSpeed()));
}
```

`data/XML/vocations.xml` — every vocation Global Idle has, and the unvocationed one:

| id | vocation | `basespeed` |
|---|---|---|
| 0 | None | **110** |
| 1 / 5 | Sorcerer / Master Sorcerer | **110** |
| 2 / 6 | Druid / Elder Druid | **110** |
| 3 / 7 | Paladin / Royal Paladin | **110** |
| 4 / 8 | Knight / Elite Knight | **110** |
| 9 / 10 | Monk / Exalted Monk | **110** |

So `110 + (level − 1)` for every Character this game has, promoted or not. There is no
vocation-specific movement speed to import, and inventing one would be a product decision wearing a
source's clothes. **KEEP.**

`PlayerFlags_t::SetMaxSpeed` is a staff flag. **DEFER** — Global Idle has no staff flags.

`getSpeed()` is `baseSpeed + varSpeed`, and `varSpeed` is where haste, paralyze, boots and mounts
land. Phase 3.6 builds none of them and leaves the seam as one parameter. **DEFER.**

---

## 5. An actor that cannot walk — SOURCE, KEEP

`src/creatures/creature.cpp:342-347` — `Creature::addEventWalk`

```cpp
if (getStepSpeed() <= 0) {
    return;
}
```

A creature whose step speed is zero or below never schedules a walk. It does not crawl at the
curve's floor of 1 — it does not move at all. Note the asymmetry the source itself has: a *player*
cannot reach that branch, because `Player::getStepSpeed` clamps to `PLAYER_MIN_SPEED = 10` first
(§4); a *monster* can, because `Creature::getStepSpeed` (`creature.hpp:258-260`) returns `getSpeed()`
unclamped.

Global Idle mirrors both halves: a Character's step speed is clamped to a floor, and a creature
authored at speed 0 is **immobile** rather than very slow. **KEEP.**

### 5.1 The reachable monster-speed domain — SOURCE

Every `monster.speed` in `data-otservbr-global/monster/**` and `data-canary/monster/**` at the
pinned commit:

| value | count | reading |
|---|---|---|
| 0 | 113 | immobile — the branch above |
| 15 | 1 | the slowest thing that moves |
| 25 – 530 | the rest | ordinary creatures; a Rat is 67 |

Recorded here because it decides whether the representation problem in §2.1 is theoretical. It is
not: 15 with ground speed 1,200 is two shipped numbers, and their diagonal wraps.

A condition can drive a live creature below 15 — the source clamps players and leaves creatures
alone — so the reachable range is wider still in a running server. Global Idle has no such condition
(`varSpeed` is deferred, §7), so its creature speeds are the authored ones.

---

## 6. The pathfinder does NOT know about ground speed — SOURCE, KEEP

`src/map/utils/astarnodes.cpp:274-277`

```cpp
int_fast32_t AStarNodes::getMapWalkCost(const AStarNode* node, const Position &neighborPos) {
    return (((std::abs(node->x - neighborPos.x) + std::abs(node->y - neighborPos.y)) - 1) * MAP_DIAGONALWALKCOST) + MAP_NORMALWALKCOST;
}
```

`MAP_NORMALWALKCOST = 10`, `MAP_DIAGONALWALKCOST = 25` (`astarnodes.hpp:38-40`) — so 10 cardinal and
35 diagonal, which is Phase 3.5's imported cost model unchanged.

`getTileWalkCost` (`astarnodes.cpp:279-`) adds for a blocking creature and for damaging fields. It
does **not** read `ItemType::speed`. Nowhere in the search is ground speed a weight.

This is the counterintuitive one and it is deliberate:

> **Ground speed decides how long a step TAKES. It is not a term in what the route COSTS.**

A route over slow mud can therefore be chosen over a longer route on fast stone, and in the source
it is. A `FASTEST_TIME_PATH` option would be a Global Idle product adaptation, not fidelity.
**DEFER** — and `PTH1` asserts the source behaviour so the deferral cannot rot into a silent change.

---

## 7. What Phase 3.6 deliberately does not import

| source | why not now |
|---|---|
| `varSpeed` — haste, paralyze, equipment, mounts | a condition/effect system; the seam is one parameter on the speed function |
| `PlayerFlags_t::SetMaxSpeed`, `PLAYER_MAX_STAFF_SPEED` | staff tooling |
| `WALK_TARGET_NEARBY_EXTRA_COST` | Global Idle's creatures stop when adjacent, so it would change nothing |
| `getTileWalkCost` creature and field terms | fields are a combat system Global Idle has not built |
| `bank.waypoints` ingestion from a real client archive | Phase 3.7 — no assets are in the repository yet |
