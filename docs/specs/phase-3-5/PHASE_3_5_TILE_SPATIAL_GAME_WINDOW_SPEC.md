# Phase 3.5 — Tile / Spatial Game Window: Implementation Specification

**Document status:** `IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`
**Phase:** 3.5 — the Hunt stops being an abstraction and becomes a place.
**Baseline:** Phase 0A `ARCHITECTURE_APPROVED` (ADR-001–ADR-019) · Phase 0B `VERIFIED` ·
Phase 1 `IMPLEMENTATION_SPEC_READY` · Phase 2 `VERIFIED` · Phase 3
`IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`
**Source baseline:** `Hokz/canary` at `f6b81a8`, read-only.

> This phase adds the **minimum authoritative spatial engine the next playable slice requires**.
> It is not a map editor, not a movement system for a player to drive, and not a second game
> clock. Where a value could have been invented, this document says where it came from; where
> Global Idle deliberately differs from the source engine, it is labelled a decision.

---

## 1. Goal and non-goals

### 1.1 What is true when Phase 3.5 is complete

The Rookgaard Sewers is a **real tile map**. The Character occupies a tile, the Rats occupy tiles,
walls are solid, and two actors cannot stand on the same square. A Character that is not standing
next to a Rat **cannot hit it** — it walks, around the pillar and through the doorway, on a path
the server computes and can recompute identically after a restart. Rooms 1 to 10 are **ten
physical chambers**, and clearing one means walking into the next. The browser draws all of this on
a Canvas and decides none of it.

### 1.2 What Phase 3.5 deliberately does not do

No player-driven movement: no click-to-move, no WASD, no attack button. The Character controls
itself, which is what an idle game is. No diagonal movement, no multi-floor maps in play, no
line of sight, no ranged attacks or area effects, no visual map editor, no pathfinding server,
no second simulation loop, no spatial state in Redis, and no static map tiles in PostgreSQL.

---

## 2. Where a map lives

A map is **content**: authored, validated at build time, hashed into the bundle, and immutable for
the life of a version. It joins `creature`, `hunt` and `item` as a content kind.

It is **not** in PostgreSQL. A static tile grid has no lifecycle, no ownership and no transaction;
putting it in a table would buy nothing and cost a migration every time a wall moves. It is also
not in Redis, because a bundle version is already the cache key that makes a compiled map safe to
keep forever.

The authored shape (`mapSchema`, `packages/game-data/src/schema.ts`):

| Field | Meaning |
|---|---|
| `key` | content key, e.g. `map.rookgaard.sewers` |
| `z` | the floor this map is on — present from the first map, not retrofitted |
| `rows` | one string per row; each character is a legend symbol |
| `legend` | symbol → `wall` \| `floor` \| `water` |
| `entry` | the tile a run starts on |
| `regions[]` | `{ id, room, rect: [x, y, w, h], spawns[] }` |

A `region` is what ties **space** to the Phase 2 room plan: room *n* of the hunt spawns inside
region *n*'s rectangle, on that region's authored spawn tiles. A room past the end of the plan
reuses the endless room's region, which is how room 10 cycles in one chamber.

**Validation is a compile step, not a walker's discovery** (`compileMap`). Ragged rows, a symbol
the legend does not define, an entry or a spawn on a wall, a region outside the map, a duplicate
region id and a spawn outside its own rectangle are each refused when the bundle is built. The
runtime therefore never has to ask whether a map is coherent.

`compileMap` produces flat `Uint8Array`s for walkability and kind, so a settlement does O(1)
lookups and never parses a row. Compiled maps are cached by `${bundle.version}:${key}` — a map is
immutable once published, so a compiled one is safe to keep.

---

## 3. Movement

### 3.1 Four directions — a decision

The source engine allows diagonals. Global Idle does not, in this phase.

The reason is corner-cutting: a diagonal step between two walls needs a rule about whether it is
legal, and every such rule is a place where the renderer and the simulator can disagree about what
the player just saw. Four directions make the legality of a step a single `isWalkable` question.
`STEPS` is ordered **N, W, E, S**, and that order is the deterministic tie-break, not an
accident of iteration.

### 3.2 A path to a GOAL SET, never to the target

An actor never paths *onto* the tile it is attacking; that tile is occupied by definition. It is
given the set of tiles it could attack from — `meleeGoals` — and asked for the next step toward
the nearest one. The same function will serve "get within range with line of sight" later without
the caller changing.

`stepToward` is a deterministic A*: lowest `f`, ties to lowest `g`, then to the lowest tile index.
The frontier is a scanned `Set` rather than a binary heap — the maps are small, and a heap is a
data structure to get wrong. `limit` (4096 expansions) bounds the work.

**No randomness is involved anywhere in a spatial decision** (§20 RND). A reload recomputes the
same path from the same durable state, which is what makes movement replayable rather than merely
repeatable.

### 3.3 Speed

One tile per tick, and `TICK_MS` is unchanged at 1000 ms. There is no second clock: movement is
something an actor does *with a tick*, in the same tick order Phase 2 fixed, not a system that
runs beside the fight.

---

## 4. Combat, gated on adjacency

### 4.1 The rule

An attack requires the attacker to be orthogonally adjacent to its target. An actor that is not
adjacent spends its tick walking. Approach and attack are therefore the same decision rather than
two systems taking turns.

### 4.2 Target selection — and the deadlock that forced it

Phase 2's rule was "the lowest-index living creature" (P2-D6), with no notion of reach. Applied
unchanged to a map it deadlocks, and the Sewers produce the deadlock reliably: the chambers are
joined by **one-tile doorways**, so a single Rat standing in a doorway makes every creature behind
it unreachable. The Character, fixated on the lowest index, then stands still — refusing to hit the
two Rats biting it — until the run runs out of clock.

Measured on the real map, before the fix: **269 kills in 14,400 ticks without space, 8 kills and a
permanent stall at tick 1,020 with it.** Twelve integration cases exceeded their four-hour budget.

The rule now:

1. If any living creature is orthogonally adjacent, attack the **lowest-index** one of those.
2. Otherwise walk toward the **first creature a step exists toward**, in index order. An
   unreachable creature is skipped rather than waited on — it is walking this way anyway, and
   standing still is not a decision a fight should make.

**Space decides the candidates; index order still decides between them.** P2-D6 is narrowed, not
replaced. After the fix: 266 kills in the same 14,400 ticks, room 10, cycle 61, no stall.

### 4.3 Arbitration between two actors that want one tile

**Index order, inside one deterministic simulation.** The array being stepped through is the array
the occupancy predicate reads, so the second creature to move sees the first already standing on
its new tile.

Database row locks are **not** used for this and must not be: the whole encounter is resolved
inside one pure function during one settlement, and a lock would be arbitration between
transactions for a conflict that never crosses one.

---

## 5. What is persisted

`HuntRun.position` — a JSONB column holding `{ tile, leg? }`. The tile is authoritative and is
always a real tile, never a fraction. The leg says which step started and when it completes, so a
browser can interpolate pixels between two server tiles.

Creature positions live in the existing `HuntRun.creatures` JSON, beside health and the attack
tick, because a creature in a run is not a row: it exists only inside that run.

Actor identity is **run-local and derived**: `${creatureKey}:${regionId}:c${cycle}:s${slot}`. It
survives persistence and reload because it is computed from *where* and *which*, never from a
counter a restart would lose. It is not a durable id and is never a foreign key.

Migration `20260922200000_hunt_spatial_position` adds the column, nullable. A run that predates it
simply has no space, which is the same state as a Hunt whose content names no map.

---

## 6. The API: one verb that advances

`GET /api/characters/:id/hunt` used to settle the simulation. A GET is the one verb the entire
stack is entitled to repeat — a retry, a prefetch, a React strict-mode double render, a proxy
revalidating — and every repetition was a settlement the player never asked for.

| Route | Verb | Effect |
|---|---|---|
| `/api/characters/:id/hunt` | `GET` | **pure.** Durable state, `Cache-Control: no-store`, literal `null` when there is no Activity. |
| `/api/characters/:id/hunt/advance` | `POST` | settles to now and records liveness. |
| `/api/characters/:id/hunt/heartbeat` | `POST` | the same settlement, under the name Phase 2 gave it. |
| `/api/maps/:key` | `GET` | the authored map. `public, max-age=31536000, immutable`. |

Advance-on-read (P2-D1) is unchanged as a *model*: the server still holds no loop and settles from
durable state plus the clock. What changed is which verb the client uses to ask.

### 6.1 The snapshot revision

`HuntRunView.revision` is `HuntRun.checkpointSequence`: monotonic per run, advanced once per
applied settlement, never backwards. **A client must discard any snapshot whose revision is lower
than the one already on screen.** Two polls can be in flight at once and nothing makes the network
deliver them in order; applying the older one rewinds the world in front of the player.

`advance` and `snapshot` both answer through one `project()` function. Two projections drift, and
the first symptom is a field the pure read forgets to fill.

### 6.2 What the snapshot carries

`space: { mapKey, tile, leg } | null`, and each creature gains `id`, `tile` and `leg`. The map
itself is **not** in the snapshot: 671 tiles that never change have no business in a two-second
poll.

---

## 7. The renderer

A **camera**, not a simulator (`apps/web/app/_components/TileScene.tsx`). Every position it draws
came from the server. It has no input, no prediction, and no local clock anything durable depends
on: pause the tab and the drawing stops; the hunt does not.

What it may do is ease. A tick is a second and a step is a tile, so a renderer that snapped would
look like a spreadsheet. It eases over 260 ms between two tiles the server stated, and any snapshot
that disagrees wins immediately.

Quality floor, and the reason for each:

- **Masonry is lighter than the floor**, lit from above with a shadow under the lip. A wall drawn
  darker than the ground reads as a hole, and the player cannot tell why the Character walked round
  it. (This was found by looking at a screenshot, not by reasoning about it.)
- **A lantern on the Character** and a gentle fall-off, so the frame has a centre — but not enough
  fall-off to hide the far wall, because a player who cannot see the room cannot read it.
- **A shadow under every actor**, or everything floats.
- **Clash marks between touching actors.** Adjacency is in the data — it is the server's own
  precondition for an attack — so this states something true rather than guessing at a fight.
- Tile size is taken from the **shorter** of the two viewport constraints, so a chamber is never
  cut in half: 17 × 9 tiles on desktop, 9 × 7 on a phone.

The **developer overlay** (grid, tile coordinates, actor ids, `rev · tick · room · you · alive`)
exists behind `NEXT_PUBLIC_DEBUG_OVERLAY=1` and is off even then until toggled. A diagnostic that
ships on is a different game.

---

## 8. Decisions

| Id | Decision | Why |
|---|---|---|
| P35-D1 | Four-direction movement | Corner-cutting needs a rule the renderer could disagree with |
| P35-D2 | Maps are content, compiled and cached by bundle version | No lifecycle, no ownership, no transaction |
| P35-D3 | Path to a goal set, never onto the target | The target's tile is occupied by definition |
| P35-D4 | Reach narrows the candidates; index order still picks | Keeps P2-D6 rather than replacing it |
| P35-D5 | Index-order arbitration inside one settlement | A row lock arbitrates between transactions; this conflict never crosses one |
| P35-D6 | `POST` advances, `GET` is pure | A GET is the one verb the stack may repeat |
| P35-D7 | `checkpointSequence` is the snapshot revision | It already exists, it is already monotonic, and it is already what a settlement advances |
| P35-D8 | Run-local derived actor ids | An actor inside a run is not a row |
| P35-D9 | No RNG in any spatial decision | A reload must recompute the same future |

---

## 20. Acceptance matrix — 39 cases

Counted by `scripts/count-matrix.mjs`; every case is exactly one test whose title begins with its
id and a colon.

| Group | Cases | What it fixes |
|---|---|---|
| **TIL** | 1–6 | the tile model: compilation, Z, ragged rows, unknown symbols, entry/spawn on a wall, decoration is not collision |
| **PTH** | 1–6 | pathing: never onto the target, around a real obstacle, same answer twice, blocked tiles are not routed through, unreachable is `null`, already-adjacent is nothing to do |
| **SPC** | 1–10 | the fight with a map: out of reach is out of the fight, reach beats index, index still breaks ties, a blocked fight still finishes, no two actors on one tile, same seed same positions, a reload resumes identically, no map means exactly Phase 2, a cleared room moves the fight into the next chamber, the endless room cycles in place with a new cycle of actors |
| **SNP** | 1–7 | the snapshot contract: the read is pure, the POST settles, neither is storable, the snapshot names the map and places every actor, the revision only rises, the map is cacheable content, absence is a literal `null` |
| **RND** | 1–3 | a different seed changes the fight and not one tile; a walking span consumes no draws; the same exchange costs the same draws with and without a map |
| **VIS** | 1–7 | the browser: the scene is the map the server named, the Character walks, the window advances with a POST, a stale snapshot is discarded, the map is fetched once, the scene fits the screen, the developer overlay is not in the shipped window |

---

## 21. Status

`IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`. This phase has **not** been independently
reviewed and is not `VERIFIED`. Nothing in this document should be read as approval.
