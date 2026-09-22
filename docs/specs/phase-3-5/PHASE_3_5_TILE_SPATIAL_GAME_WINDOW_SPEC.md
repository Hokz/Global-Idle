# Phase 3.5 — Tile / Spatial Game Window: Implementation Specification

**Document status:** `IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`
**Phase:** 3.5 — the Hunt stops being an abstraction and becomes a place.
**Baseline:** Phase 0A `ARCHITECTURE_APPROVED` (ADR-001–ADR-019) · Phase 0B `VERIFIED` ·
Phase 1 `VERIFIED` · Phase 2 `VERIFIED` · Phase 3 **`VERIFIED`** at `d46f78b`
**Source evidence:** [`PHASE_3_5_CANARY_SPATIAL_SOURCE_MAP.md`](./PHASE_3_5_CANARY_SPATIAL_SOURCE_MAP.md)
— every spatial rule below that claims the source engine cites the file and the symbol it came
from, at `Hokz/canary` `f6b81a8`.

> This phase adds the **minimum authoritative spatial engine the next playable slice requires**.
> It is not a map editor, not a movement system for a player to drive, and not a second game
> clock. Where a value could have been invented, the source map says where it came from; where
> Global Idle deliberately differs, it is labelled an adaptation.

---

## 1. Goal and non-goals

### 1.1 What is true when Phase 3.5 is complete

The Rookgaard Sewers is a **real tile map**. The Character occupies a tile, the Rats occupy tiles,
walls are solid, and two actors can neither stand on the same square nor commit to it. A Character
that is not standing next to a Rat **cannot hit it** — it walks, in eight directions, around the
pillar and through the doorway, on a path the server computes and can recompute identically after
a restart. Rooms 1 to 10 are **ten physical chambers**, and clearing one means walking into the
next. The browser draws all of it on a fixed **15 × 11 tile** Canvas, from the map version the
simulation is actually using, at the timings the server actually set, and decides none of it.

### 1.2 What Phase 3.5 deliberately does not do

No player-driven movement: no click-to-move, no WASD, no attack button. The Character controls
itself, which is what an idle game is. No line of sight, no ranged attacks or area effects, no
multi-floor Hunt, no dungeon framework, no visual map editor, no pathfinding service, no second
simulation loop, and no spatial state in Redis or static map tiles in PostgreSQL.

---

## 2. Where a map lives, and what a tile blocks

A map is **content**: authored, validated at build time, hashed into the bundle, and immutable for
the life of a version. It joins `creature`, `hunt` and `item` as a content kind.

It is **not** in PostgreSQL. A static tile grid has no lifecycle, no ownership and no transaction;
putting it in a table would buy nothing and cost a migration every time a wall moves.

| Field | Meaning |
|---|---|
| `key` | content key, e.g. `map.rookgaard.sewers` |
| `z` | the floor the rows describe |
| `rows` | one string per row; each character is a legend symbol |
| `legend` | symbol → `wall` \| `floor` \| `water` \| `sludge` |
| `entry` | the tile a run starts on |
| `regions[]` | `{ id, room, rect, spawns[] }` — room *n* of the hunt IS region *n* |
| `connectors[]` | optional floor links; see §6 |

### 2.1 Collision is three questions

The source keeps `blockSolid`, `blockPathFind` and `blockProjectile` apart as three independent
item properties mapping to three independent tile states (source map §6). Global Idle does too:

| Kind | may be stood on | may be routed through | stops a projectile |
|---|---|---|---|
| `floor` | yes | yes | no |
| `wall` | no | no | **yes** |
| `water` | no | no | **no** |
| `sludge` | **yes** | **no** | no |

Phase 3.5 fires no projectile. What it refuses to do is collapse three bits into one `walkable`
flag, because un-collapsing it later is a content schema migration and a Paladin is one phase
away. `water` and `sludge` are the two cases that prove the bits genuinely disagree (`COL1`–`COL4`).

### 2.2 Validation is a compile step

Ragged rows, an undefined legend symbol, an entry or spawn on a wall, a region outside the map, a
duplicate region id, a spawn outside its own rectangle and a connector that changes nothing are
each refused when the bundle is built (`TIL3`–`TIL5`, `FLR2`).

So is an **unplayable progression**. Now that the map is a gameplay asset, `compileMap` proves the
whole room graph statically, ignoring dynamic actors: the entry reaches room 1, room *n* reaches
room *n+1*, and every spawn tile is reachable. A content edit that walls off room 7 fails the
build instead of softlocking a player halfway through a hunt (`RCH1`, `RCH2`).

`compileMap` produces flat `Uint8Array`s, so a settlement does O(1) lookups and never parses a
row. Compiled maps are cached by `${bundle.version}:${key}`.

---

## 3. Movement

### 3.1 Eight directions, and no corner rule

The source has eight directions (`position.hpp:12-22`) and **no corner-cutting restriction**:
`Game::internalMoveCreature` validates the destination tile and nothing else, and its A* evaluates
a diagonal neighbour by that neighbour alone (source map §2). Global Idle implements the rule as
observed — a diagonal step is legal whenever its destination is — and tests it from both sides
(`PTH9`, `PTH10`).

### 3.2 Path cost: a diagonal is a way THROUGH, not a shortcut

`MAP_NORMALWALKCOST = 10`, and `((|dx|+|dy|) - 1) * 25 + 10` makes a diagonal **35** (source map
§3). Global Idle uses both integers unchanged.

A consequence worth stating, because it surprises: **35 > 10 + 10**, so the pathfinder prefers two
cardinal steps to one diagonal *everywhere it can*. Diagonals are what get an actor through
geometry that cardinals cannot — a corner, a doorway's shoulder — not a fast lane across open
floor. The duration model agrees: a diagonal takes 3× a cardinal against the cardinal pair's 2×.

Ties break on lowest `f`, then lowest `g`, then lowest tile index. The heuristic is the exact
optimal-on-empty-floor cost, `10 · max(dx,dy) + 25 · min(dx,dy)`, which is admissible and
consistent for these two costs.

**No randomness is involved in any spatial decision** (§20 RND). A reload recomputes the same path
from the same durable state.

### 3.3 Step duration, from the source's own arithmetic

```
calculated = floor(857.36 · ln(speed + 261.29) − 4795.01 + 0.5)
duration   = floor(1000 · groundSpeed / calculated), rounded UP to SERVER_BEAT (50 ms)
diagonal   = duration × 3
```

with `groundSpeed = 150` and `speed = vocation base (110) + level − 1` for a Character
(`Player::updateBaseSpeed`), or `monster.speed` for a creature. A level-1 Character steps in
**550 ms**; a Rat steps in **900 ms**. The Character is faster than what chases it, which is what
makes an approach a chase rather than a queue (`STP1`).

Speed is therefore already level-responsive, and a Phase 4 vocation speed stat replaces one input
rather than the model.

---

## 4. Combat, gated on reach

### 4.1 Melee range is Chebyshev one

Every melee path in the source tests `Position::areInRange<1, 1>` — all eight neighbours,
diagonals included (source map §5). Global Idle uses the same rule and keeps it in **its own
function**, defined independently of how anything moves, because the day movement topology and
attack range disagree, one of them has to be able to change (`PTH11`).

Reach is measured from the tile an actor **is on**. An actor with a step in flight has not
arrived, so it can neither swing from its destination nor be struck there (§5, `STP2`).

### 4.2 Target selection — and the deadlock that forced it

Phase 2's rule was "the lowest-index living creature", with no notion of reach. Applied unchanged
to a map it deadlocks, and the Sewers produce the deadlock reliably: chambers are joined by
one-tile doorways, so a single Rat standing in a doorway makes everything behind it unreachable.
The Character, fixated on the lowest index, then stands still — refusing to hit the two Rats
biting it — until the run runs out of clock.

Measured before the fix: **269 kills in 14,400 ticks without space, 8 kills and a permanent stall
at tick 1,020 with it.** Twelve integration cases exceeded their four-hour budget.

The rule now:

1. If any living creature is within reach, attack the **lowest-index** one of those.
2. Otherwise walk toward the **first creature a step exists toward**, in index order. An
   unreachable creature is skipped rather than waited on.

**Space decides the candidates; index order still decides between them.** P2-D6 is narrowed, not
replaced.

### 4.3 Arbitration

**Index order, inside one deterministic simulation**: the Character, then creatures by index,
arrivals before departures. The array being stepped through is the array the occupancy predicate
reads, so the second actor to decide sees the first one's claim already standing.

Database row locks are **not** used for this and must not be: the whole encounter resolves inside
one pure function during one settlement, and a lock would arbitrate between transactions for a
conflict that never crosses one.

---

## 5. One authoritative movement timeline

This is the part the first implementation got wrong, and the correction is the spine of the phase.

The simulation advances in **beats of 50 ms** (`SERVER_BEAT`). Combat still resolves only on whole
**1000 ms ticks**, exactly as Phase 2 fixed it — a Hunt with no map iterates whole ticks and takes
the same branches, the same draws and the same golden file. Movement is decided on the beat, which
is how a 550 ms step exists at all without a second clock.

An actor is described by:

```
position: Tile                     // the tile it IS on
activeMovement?: {                 // the step in flight, or nothing
  from, to,
  startsAtMs, arrivesAtMs          // absolute simulation milliseconds
}
```

and the rules that make it one state rather than two opinions:

- an actor with an `activeMovement` **is still on `from`** — it cannot attack from `to`, cannot be
  attacked at `to`, and does not occupy `to`;
- `to` is **reserved**: nothing else may stand on it or commit to it, so two actors can never
  claim one tile (`STP3`);
- on `arrivesAtMs` the actor commits to `to`, the reservation ends, and a connector under that
  tile (§6) takes effect;
- the decision to step is taken only when an actor is free — there is no repathing mid-step.

A settlement boundary may fall inside a step. The persisted state carries the movement with
absolute instants, so a reload resumes the identical future (`STP5`, `SPC7`).

### 5.1 What the renderer is given, and what it may do

The snapshot carries `space.nowMs`, the simulation instant it describes, in the same milliseconds
as `startsAtMs` and `arrivesAtMs`. The browser advances that anchor with its own wall clock — the
simulation runs at one second per second — and draws each actor at

```
progress = clamp((simNow − startsAtMs) / (arrivesAtMs − startsAtMs), 0, 1)
```

between `from` and `to`. It invents no duration. The previous implementation eased over a local
260 ms triggered by a snapshot's *arrival*, which meant the server's timing and the picture were
two different stories; they are now one.

---

## 6. Floors — a seam, not a feature

A `connector` is a content declaration: `{ from, to, kind }` where `from` and `to` are on
different floors. The compiler records which floors a map touches and refuses a connector that
changes nothing or stands on a wall.

Pathfinding stays **single-floor**, as the source's does: changing floor is a property of a tile
you arrive on, not a path the search plans through, and a diagonal step never triggers it (source
map §7). An actor arriving on a connector transitions deterministically.

The live Sewers declare **no connectors**. The seam exists so a later phase adds a floor without
migrating every published map, and it is proved by fixtures (`FLR1`–`FLR3`), not by fake stairs in
a shipped map.

---

## 7. What is persisted

`HuntRun.position` — a JSONB column holding `{ tile, movement? }`. Creature positions and steps
live in the existing `HuntRun.creatures` JSON, because a creature in a run is not a row.

Actor identity is **run-local and derived**: `${creatureKey}:${regionId}:c${cycle}:s${slot}`. It
survives persistence and reload because it is computed from *where* and *which*, never from a
counter a restart would lose.

Migration `20260922200000_hunt_spatial_position` adds the column, nullable.

---

## 8. The API

| Route | Verb | Effect |
|---|---|---|
| `/api/characters/:id/hunt` | `GET` | **pure.** Durable state, `Cache-Control: no-store`, literal `null` when there is no Activity. |
| `/api/characters/:id/hunt/advance` | `POST` | settles to now and records liveness. |
| `/api/characters/:id/hunt/heartbeat` | `POST` | the same settlement, under the name Phase 2 gave it. |
| `/api/content/:contentVersion/maps/:key` | `GET` | the map **at a named version**. `public, max-age=31536000, immutable`. |

A GET is the one verb the whole stack is entitled to repeat — a retry, a prefetch, a strict-mode
double render, a proxy revalidating — and under the old contract every repetition was a
settlement. Advance-on-read (P2-D1) is unchanged as a *model*; what changed is the verb.

### 8.1 The map resource is identified by version AND key

An Activity pins the bundle it started under and keeps simulating against it after a publish. A
map endpoint answering with "whatever is current" therefore had two defects at once: the browser
could draw geometry the server was not colliding against, and a URL that omitted the version was
declared `immutable` for a year while its bytes could change. Both are fixed by putting the
version in the path, so the resource genuinely cannot change and the cache header is genuinely
true (`MPV1`–`MPV5`).

The snapshot carries `space.contentVersion`; the client's map cache key is
`${contentVersion}:${mapKey}`.

### 8.2 The snapshot revision

`HuntRunView.revision` is `HuntRun.checkpointSequence`: monotonic per run, advanced once per
applied settlement, never backwards. A client must **discard** any snapshot whose revision is
lower than the one already on screen; two polls in flight arrive in whatever order the network
likes, and applying the older one rewinds the world in front of the player.

`advance` and `snapshot` answer through one `project()` function, because two projections drift.

---

## 9. The Game Window

A **camera**, not a simulator. Every position it draws came from the server. It has no input, no
prediction, and no local clock anything durable depends on.

### 9.1 The logical viewport is LOCKED

| | |
|---|---|
| visible tiles | **15 × 11** |
| logical tile | **32 × 32** logical pixels |
| logical surface | **480 × 352** logical pixels |
| centre tile (zero-based) | **(7, 5)** |

The same logical world is visible on a desktop monitor, on a phone, and at any device pixel ratio.
The backing buffer is a whole multiple of the logical surface and the CSS box is whatever the
layout gives it, so a bigger screen shows the same corridor **bigger** — never more of it.

This is gameplay, not decoration: how many enemies, corridors, and one day projectiles and Party
members a player can see must not depend on their hardware (`VIS8`–`VIS10`).

The camera centres the Character on the centre tile whenever the map allows and clamps at the map
edges, identically on desktop and touch.

### 9.2 Quality floor, and the reason for each

- **Masonry is lighter than the floor**, lit from above with a shadow under the lip. A wall drawn
  darker than the ground reads as a hole, and the player cannot tell why the Character walked round
  it. (Found by looking at a screenshot, not by reasoning about it.)
- **A lantern on the Character** and a gentle fall-off, so the frame has a centre — but not enough
  to hide the far wall, because a player who cannot see the room cannot read it.
- **A shadow under every actor**, or everything floats.
- **Clash marks between actors within reach.** Reach is in the data — it is the server's own
  precondition for an attack — so this states something true rather than guessing.
- `image-rendering: pixelated` and integer scaling, because the surface is a fixed logical grid.

The **developer overlay** (grid, tile coordinates, actor ids, `rev · tick · room · you · alive`)
exists behind `NEXT_PUBLIC_DEBUG_OVERLAY=1` and is off even then until toggled (`VIS7`).

---

## 10. Decisions

| Id | Decision | Why |
|---|---|---|
| P35-D1 | **Eight-direction movement**, no corner rule | the source has both; the first implementation's four directions were a simplification the product did not accept |
| P35-D2 | Maps are content, compiled and cached by bundle version | no lifecycle, no ownership, no transaction |
| P35-D3 | Path to a goal set, never onto the target | the target's tile is occupied by definition |
| P35-D4 | Reach narrows the candidates; index order still picks | keeps P2-D6 rather than replacing it |
| P35-D5 | Index-order arbitration inside one settlement | a row lock arbitrates between transactions; this conflict never crosses one |
| P35-D6 | `POST` advances, `GET` is pure | a GET is the one verb the stack may repeat |
| P35-D7 | `checkpointSequence` is the snapshot revision | already exists, already monotonic, already what a settlement advances |
| P35-D8 | Run-local derived actor ids | an actor inside a run is not a row |
| P35-D9 | No RNG in any spatial decision | a reload must recompute the same future |
| P35-D10 | **50 ms beat for movement, 1000 ms tick for combat** | movement needs sub-second timing; Phase 2's combat cadence is VERIFIED and must not move |
| P35-D11 | **Destination reservation** rather than instant occupancy | it is what makes "cannot attack from where it is going" and "two actors cannot claim one tile" the same rule |
| P35-D12 | **Map URL carries the content version** | otherwise the browser can draw a map the server is not simulating, and `immutable` is a lie |
| P35-D13 | **Fixed 15 × 11 logical viewport** | visible world is gameplay; hardware must not change it |
| P35-D14 | Three collision bits from the first map | un-collapsing them later is a content migration |
| P35-D15 | Connectors declared, not used | a seam costs a schema field; retrofitting floors costs every published map |

---

## 20. Acceptance matrix — 70 cases

Counted by `scripts/count-matrix.mjs`; every case is exactly one test whose title begins with its
id and a colon.

| Group | Cases | What it fixes |
|---|---|---|
| **TIL** | 1–6 | the tile model: compilation, Z, ragged rows, unknown symbols, entry/spawn on a wall, kind is not collision |
| **PTH** | 1–12 | pathing: never onto the target, around an obstacle, repeatable, blocked tiles, unreachable, already adjacent — then eight directions, the source's costs, corner cutting, a dynamic blocker on the diagonal, Chebyshev reach, and `blockPathFind` as its own bit |
| **SPC** | 1–10 | the fight with a map: reach beats index, index breaks ties, a blocked fight finishes, no overlap, determinism, reload, no map means exactly Phase 2, room transition, endless cycle |
| **STP** | 1–7 | the movement timeline: source-backed durations, no pre-arrival attack, reservation, a coherent leg, a settlement boundary mid-step, sub-tick resolution, the diagonal factor |
| **SNP** | 1–7 | the snapshot contract: the read is pure, the POST settles, neither is storable, identity and placement, monotonic revision, versioned map resource, literal `null` |
| **MPV** | 1–5 | one spatial truth across a publish: a running Activity keeps its bundle, its version fetches its geometry, a new Activity gets the new one, two versions are two URLs, the map is never in the snapshot |
| **COL** | 1–4 | three collision questions that genuinely disagree |
| **FLR** | 1–3 | the floor seam: connectors are content, invalid ones are refused, pathing stays on one floor |
| **RCH** | 1–2 | a map whose progression is broken fails the build |
| **RND** | 1–3 | a different seed changes the fight and not one tile; walking consumes no draws; the same exchange costs the same draws with and without a map |
| **VIS** | 1–11 | the browser: the scene is the map the server named, the Character walks, POST advances, a stale snapshot is discarded, the map is fetched once at its pinned version, the scene fits, no overlay in a shipped build, a locked 15 × 11 logical viewport, resize reveals nothing, the camera centres and clamps |

Inherited and unchanged: Phase 0B **92**, Phase 1 **87**, Phase 2 **106**, Phase 3 **169**.

---

## 21. Status

`IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`. This phase has **not** been independently
reviewed and is not `VERIFIED`. Nothing in this document should be read as approval.
