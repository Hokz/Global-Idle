# Phase 3.5 — Canary spatial source map

**Source repository:** `Hokz/canary`
**Pinned commit:** `f6b81a855aa8e7e34cb98821ceb39ff97e3afa4e` (`f6b81a8`)
**Read-only.** Nothing in this project modifies, vendors or links against that source.

Every spatial rule Phase 3.5 claims to take from the source engine is recorded here with the file
and the symbol it came from, so a reviewer can check the claim instead of believing it. Three
labels are used and they are not interchangeable:

| Label | Meaning |
|---|---|
| **SOURCE** | observed in the pinned source; the citation is the evidence |
| **PRODUCT** | a Global Idle product decision; the source has no opinion and is not being invoked |
| **ADAPTATION** | deliberately different from the source, with the reason |

> **The authored Rookgaard Sewers layout is PRODUCT, not SOURCE.** Its eleven rows, its ten
> chambers, its pillars and its one-tile doorways were written for this game. No claim is made
> that any of that geometry exists in Canary or in Tibia.

---

## 1. Direction model — eight directions

**SOURCE** · `src/game/movement/position.hpp:12-22`

```cpp
DIRECTION_NORTH, DIRECTION_EAST, DIRECTION_SOUTH, DIRECTION_WEST,
DIRECTION_DIAGONAL_MASK = 4,
DIRECTION_SOUTHWEST = DIRECTION_DIAGONAL_MASK | 0,
DIRECTION_SOUTHEAST = DIRECTION_DIAGONAL_MASK | 1,
DIRECTION_NORTHWEST = DIRECTION_DIAGONAL_MASK | 2,
DIRECTION_NORTHEAST = DIRECTION_DIAGONAL_MASK | 3,
```

The offsets are `getNextPosition` (`src/utils/tools.cpp:581-623`): N `y-1`, S `y+1`, W `x-1`,
E `x+1`, and the four diagonals combining one of each.

A diagonal is not a special move. It is a direction with a bit set, and the same `Position` it
produces.

---

## 2. The corner rule — there is none

**SOURCE** · `src/game/game.cpp:1897-1961`, `src/map/map.cpp:1107-1145`

This is the rule most tile games get wrong by inventing one, so it is stated precisely.

`Game::internalMoveCreature(creature, direction, flags)` computes `destPos` and hands the
**destination tile** to `internalMoveCreature(creature, toTile, flags)`, which validates with
`toTile->queryAdd(0, creature, 1, flags)`. Nothing anywhere in that path examines the two
orthogonal tiles flanking a diagonal step.

The pathfinder agrees. In `Map::getPathMatching` the neighbour loop evaluates each candidate by
that candidate's own tile only:

```cpp
const auto &tile = ... getPathfindingTile(*this, creature, creatureTile, pos, floorCursor);
if (!tile) { continue; }
extraCost = AStarNodes::getTileWalkCost(creature, tile);
```

**Therefore: a diagonal step is legal whenever its destination is legal, even when both flanking
orthogonal tiles are blocked.** Corner-cutting is allowed. Global Idle implements this rule as
observed, and tests it in both directions (`PTH9`, `PTH10`, `PTH11`).

One diagonal restriction does exist, and it is about floors rather than corners
(`src/game/game.cpp:1911-1912`): a player's automatic "step up onto a height" convenience is
skipped when `(direction & DIRECTION_DIAGONAL_MASK) != 0`. A diagonal step never changes floor.

---

## 3. Path cost — diagonals are not free

**SOURCE** · `src/map/utils/astarnodes.hpp:38-40`, `src/map/utils/astarnodes.cpp:274-277`

```cpp
static constexpr int32_t MAP_NORMALWALKCOST = 10;
static constexpr int32_t MAP_DIAGONALWALKCOST = 25;

int_fast32_t AStarNodes::getMapWalkCost(const AStarNode* node, const Position &neighborPos) {
    return (((std::abs(node->x - neighborPos.x) + std::abs(node->y - neighborPos.y)) - 1)
            * MAP_DIAGONALWALKCOST) + MAP_NORMALWALKCOST;
}
```

A cardinal step costs **10**; a diagonal step costs **35** (`(2-1) * 25 + 10`). Global Idle uses
these two integers unchanged, which keeps A* on integer arithmetic and keeps the tie-break exact.

Canary also adds situational costs a static map has no equivalent for — an occupied tile costs
`MAP_NORMALWALKCOST * 4` and a harmful field `* 18` (`astarnodes.cpp:279-295`). Global Idle
carries neither yet: it has no fields, and it treats an occupied tile as impassable rather than
expensive, because a deterministic single-settlement simulation has no tolerance for "walk through
the rat if it is cheaper".

### The heuristic is NOT source-backed — it is a Global Idle engine decision

The two EDGE COSTS above are the source's. The **heuristic** an A* uses to order its frontier is
not, and Global Idle does not claim Canary's: the source builds its own node table with
`((dX - sX) << 3) + ((dY - sY) << 3) + (max(dX, dY) << 3)` (`src/map/map.cpp:1136-1138`), which is
tuned to its own bounded node budget and its own expansion order.

Global Idle uses `manhattan × NORMAL_WALK_COST`, chosen for one property: it never overestimates
the cheapest remaining cost under edges of 10 and 35, so A* is guaranteed to return a cheapest
path. An earlier version used `35·min(dx,dy) + 10·(max−min)`, which **overestimates** — a (1,1)
displacement costs 20 by two cardinals and that heuristic says 35 — and it really did return an
80-cost route where a 70-cost one existed. What this project needs from the source is topology and
cost semantics; what it needs from itself is a correct search (`PTH13`–`PTH15`).

The **deterministic tie-break** (lowest `f`, then lowest `g`, then lowest tile index) and the
**occupancy/reservation policy** are likewise Global Idle engine decisions, not source rules.

---

## 4. Step duration — ground speed, step speed and the 50 ms beat

**SOURCE** · `src/creatures/creature.cpp:1690-1709`, `src/creatures/creature.hpp:1089-1097`,
`src/game/game.hpp:64`

```cpp
auto duration = std::floor(1000 * walk.groundSpeed / walk.calculatedStepSpeed);
walk.duration = static_cast<uint16_t>(std::ceil(duration / SERVER_BEAT) * SERVER_BEAT);
...
if ((dir & DIRECTION_DIAGONAL_MASK) != 0) { duration *= WALK_DIAGONAL_EXTRA_COST; }
```

with

| Symbol | Value | Where |
|---|---|---|
| `SERVER_BEAT` | `0x32` = **50** ms | `src/game/game.hpp:64` |
| `WALK_DIAGONAL_EXTRA_COST` | **3** | `src/creatures/creature.hpp:45` |
| `WALK_FLOOR_CHANGE_EXTRA_COST` | **2** | `src/creatures/creature.hpp:44` |
| `WALK_TARGET_NEARBY_EXTRA_COST` | **2** | `src/creatures/creature.hpp:43` |
| default ground speed | **150** | `src/creatures/creature.cpp:1817` |

`calculatedStepSpeed` is the logarithmic speed curve (`creature.hpp:1089-1096`):

```cpp
floor(speedA * log(stepSpeed + speedB) + speedC + 0.5)
// speedA = 857.36, speedB = 261.29, speedC = -4795.01   (creature.hpp:76-78)
```

and a player's `stepSpeed` is its clamped `getSpeed()` (`player.hpp:2045-2048`), whose base is
`vocation base speed + (level - 1)` (`player.cpp:7338-7345`).

**A diagonal step takes three times as long as a cardinal one.** That is the same factor the
pathfinder charges at planning time (35 ≈ 3.5 × 10), and Global Idle honours the duration factor
exactly: `3`.

`lastStepCost` (`creature.cpp:519-528`) applies the same multipliers to the *next* step event —
`3` after a diagonal, `2` after a floor change.

### Global Idle's step duration — ADAPTATION

Global Idle has no `Vocation`, no `speed` stat and no equipment speed bonus yet, so it cannot
evaluate the log curve honestly. It takes what it can defend:

- a **base cardinal step duration** in whole milliseconds, from the same shape
  `floor(1000 * groundSpeed / stepSpeed)` rounded up to the 50 ms beat;
- the **×3 diagonal factor**, unchanged and source-backed;
- the **50 ms beat**, unchanged and source-backed.

When Phase 4 introduces vocation speed, the curve above replaces one constant and nothing else.
That is the whole reason the duration is computed rather than authored.

---

## 5. Melee adjacency — Chebyshev 1, diagonals included

**SOURCE** · `src/game/movement/position.hpp:33-36` (`Position::areInRange`),
`src/items/weapons/weapons.cpp:225`, `:901`, `src/creatures/players/player.cpp:12531`

```cpp
template <int_fast32_t deltax, int_fast32_t deltay>
static bool areInRange(const Position &p1, const Position &p2) {
    return Position::getDistanceX(p1, p2) <= deltax && Position::getDistanceY(p1, p2) <= deltay;
}
```

Every melee path tests `areInRange<1, 1>` — for example `Weapon::useFist`
(`weapons.cpp:224-226`), which Phase 2 already sources its unarmed damage from.

`<1,1>` is **Chebyshev distance ≤ 1**: all eight neighbours, diagonals included.

**This is defined independently of movement topology and is asserted as such** (`SPC11`). It
happens to agree with 8-direction movement here, but the two are separate rules and Global Idle
keeps them separate functions.

---

## 6. Collision is three independent questions, not one

**SOURCE** · `src/items/items.hpp:347-351`, `src/items/items_definitions.hpp:463-468`,
`src/items/tile.cpp:39-66`

An item type carries three separate booleans:

```cpp
bool blockSolid = false;      // cannot be stood on
bool blockProjectile = false; // cannot be shot through
bool blockPathFind = false;   // cannot be routed through
```

which become independent tile states:

```cpp
TILESTATE_BLOCKSOLID          = 1 << 17,
TILESTATE_BLOCKPATH           = 1 << 18,
TILESTATE_IMMOVABLEBLOCKSOLID = 1 << 19,
TILESTATE_NOFIELDBLOCKPATH    = 1 << 22,
```

They are genuinely independent: a magic field blocks pathing without blocking occupancy; a
parcel blocks occupancy without blocking a projectile.

Global Idle's tile model therefore exposes **three queries**, not one `walkable` flag — even
though this phase ships no projectile. The point is that a Phase 4 Paladin must not require a map
schema migration. Phase 3.5 answers all three from the authored tile kind and asserts that they
can disagree (`COL1`–`COL4`).

---

## 7. Floors are a separate axis, and pathfinding does not cross them

**SOURCE** · `src/map/map.cpp` (`getPathMatching` keeps `pos.z` fixed for every neighbour),
`src/items/items_definitions.hpp:446-476`

```cpp
TILESTATE_FLOORCHANGE_DOWN  = 1 << 0,
TILESTATE_FLOORCHANGE_NORTH = 1 << 1,
... EAST/WEST/SOUTH/_ALT ...
TILESTATE_FLOORCHANGE = <all of the above>
```

A* runs on one floor. Changing floor is a property of a **tile you step onto**, not a path the
search plans through, and a diagonal step never triggers it (§2).

Global Idle adopts exactly that shape, and stops there honestly: `z` exists on every position from
the first map, a **connector** is a tile-to-tile link declared and validated in content, and the
pathfinder stays single-floor.

What Phase 3.5 does NOT do is execute the connector. A map compiles **one** floor of geometry —
`flags` and `kind` are indexed by `y · width + x` with no `z` term — so a second floor would be
reading this floor's walls under a different number. That is not a second floor. Until a map can
author per-floor rows, `isInside` admits exactly one `z` and an arrival never changes floor
(`FLR1`–`FLR4`). Phase 5 owns real multi-floor geometry; what is here is the shape the authoring
format will keep.

---

## 8. What is PRODUCT, and is not claimed from the source

| Rule | Why it is ours |
|---|---|
| **15 × 11 visible tiles**, 32 logical px, 480 × 352 logical canvas | a Global Idle Game Window contract; the source's client is a different product |
| **No manual steering** — no click-to-move, no WASD, no attack button | this is an idle game; the source is not |
| The authored Sewers geometry | written for this game, as stated above |
| Ten chambers as rooms 1–10, room 10 endless | Phase 2's room plan, given a body |
| Advance-on-read settlement | ADR-015; the source runs a real-time loop |
| Snapshot revision, pure GET, POST advance | an HTTP contract; the source has no HTTP |

---

## 9. What is ADAPTATION, and why

| Adaptation | From | Why |
|---|---|---|
| Occupied tiles are impassable, not `cost * 4` | `astarnodes.cpp:279-283` | one settlement resolves the whole encounter; "push through it" has no meaning without real-time repathing |
| No field costs | `astarnodes.cpp:284-295` | no fields exist yet |
| Step duration from a constant base rather than the log curve | `creature.hpp:1089-1096` | no vocation speed stat yet; the curve is the named successor |
| `WALK_TARGET_NEARBY_EXTRA_COST` not applied | `creature.cpp:1700-1705` | it slows a monster that is already next to its target; Global Idle's creatures stop when adjacent, so it would change nothing |
| A* frontier is a scanned set, not the source's node table | `astarnodes.cpp` | maps are small; a heap is a data structure to get wrong |
| A* heuristic is `manhattan × 10`, not the source's shifted estimate | `map.cpp:1136-1138` | the source's is tuned to its own node budget; ours is chosen to be provably admissible under these edge costs (§3) |
| A connector is authored but NOT executable | `items_definitions.hpp:446-476` | a map compiles one floor of geometry; moving an actor to an unauthored floor would hand it this floor's collision (§7) |
| A chasing actor re-derives its route every beat; the source CACHES one | `creature.hpp:900` (`listWalkDir`), `creature.cpp:1122-1192` (`hasFollowPath`, `getPathTo`) | re-deriving is correct per beat and simpler to persist, but two actors of the same cadence then circle a symmetric obstacle forever. Unreachable on the authored data — a Character steps in ≤ 550 ms and a Rat in 900 (`STP8`) — and the cached route is Phase 5's to add |
