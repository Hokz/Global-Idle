# Phase 3.5 — Implementation notes

**Status:** `IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`
**Spec:** [`PHASE_3_5_TILE_SPATIAL_GAME_WINDOW_SPEC.md`](./PHASE_3_5_TILE_SPATIAL_GAME_WINDOW_SPEC.md)

What the implementation DECIDED, what it FOUND, and what it COST. Not a summary
of the spec.

---

## 1. The one sentence this phase is built on

**A tile is the only position, and nothing derives a second one.**

The server persists a tile. The engine decides on tiles. The snapshot carries a
tile. The browser draws pixels *between* two tiles and reads none of them back.
Every "where is it" question in this phase has exactly one answer and exactly
one owner, which is why a reload, a second tab and a restart all agree.

---

## 2. What the fight turned out to be hiding

The spatial core landed first — tiles, a validated map, deterministic A*,
adjacency-gated attacks — and twelve integration cases immediately blew their
four-hour budget. The convenient reading was "walking lowers kills per second,
so the budgets need raising". That reading was wrong, and raising the budgets
would have buried a real deadlock under a passing suite.

What the measurement said, on the real Sewers map:

| | kills in 14,400 ticks | end state |
|---|---|---|
| without space | 269 | room 10, cycle 62 |
| with space | **8** | **stalled at tick 1,020** |

At the stall the Character stood at `(29,6)` with two Rats **adjacent** at
`(29,5)` and `(29,7)`, taking damage, and did not swing. The third Rat — index
0, `(31,5)` — was in the next chamber. The only route there is the doorway at
`(30,7)`, and the Rat at `(29,7)` was standing in front of it, so `stepToward`
correctly returned `null`. Phase 2's target rule, "the lowest-index living
creature", had no notion of reach, and a Character that cannot reach its target
does nothing at all.

**One rat in a one-tile doorway was enough to freeze the game.** The fix is in
the spec (§4.2): reach chooses the candidates, index order still chooses
between them. 266 kills afterwards, against 269 without space — space costs
about one percent of throughput, not ninety-seven.

The second half of the same mistake was in creature movement: it mapped into a
*fresh* array, so every creature decided against the same stale snapshot and two
of them could step onto one tile. The comment above it claimed index-order
arbitration; the code did not do it. The array being walked is now the array the
occupancy predicate reads. SPC5 caught this — it was written to assert something
believed true, and it failed.

---

## 3. What space cost the API

A GET that settles is fine until something repeats it, and everything repeats a
GET. The split (spec §6) was not a refactor for tidiness: it is the difference
between "advance-on-read" as a *model* and "advance-on-read" as *whatever the
browser felt like doing*.

Two things fell out of it that were worth having anyway:

- **One projection.** `advance` and `snapshot` now answer through one
  `project()`. Building the pure read as a second projection would have meant
  two places to add every future field, and the first symptom would have been a
  field the pure read silently omits.
- **A literal `null`.** Returning `null` through Nest sends an empty 200, which
  a client cannot tell from a truncated response. SNP7 was written expecting
  `null`, failed, and found a contract defect that pre-dated this phase.

---

## 4. What the browser found that no amount of reasoning would have

The first renderer drew walls **darker** than the floor. In a screenshot the map
was unreadable: the chambers, the pillars and the doorways all vanished into one
dark field, and the fight looked like two sprites in a void.

Nothing about that was visible in the code, which had a reasonable-sounding
comment about "a top face and a darker side". It took looking at a PNG.

Masonry is now lighter than the floor and lit from above, and the map reads at a
glance. The general lesson is the one this project keeps relearning in a new
costume: **a claim about what something looks like is a claim, and a screenshot
is the measurement.**

A second lesson, cheaper but sharper: two of the palette edits in this phase
were applied by a script whose `print('ok')` was unconditional. They silently did
nothing, and two rebuild-and-screenshot cycles were spent looking at unchanged
pixels before the source was read. Every subsequent patch asserted its anchor.

---

### 4.1 The evidence

[`evidence/`](./evidence/) holds five screenshots of the running stack, with
what each one shows and how the far-away states were reached. They are
`page.screenshot()` of a live Hunt against a real API and a real database — not
mockups, and not renders of a design.

## 5. What was deliberately not built

- **No pathfinding service, no spatial index, no quadtree.** A 61 × 11 map with
  at most six actors is scanned faster than a heap can be allocated.
- **No second clock.** Movement is what an actor does with a tick.
- **No spatial state in Redis.** The run row already holds it, transactionally,
  beside everything else a settlement writes.
- **No visual map editor.** The map is eleven strings in a JSON file and is
  validated at build time; an editor would be a product, not a tool.
- **No diagonals.** See P35-D1.

---

## 6. Costs

| | |
|---|---|
| New engine module | `packages/game-engine/src/space.ts`, 305 lines, pure |
| Engine change | target selection and creature stepping in `hunt.ts` |
| Schema change | one nullable JSONB column |
| New routes | `POST …/hunt/advance`, `GET /api/maps/:key` |
| New client component | `TileScene.tsx`, a camera |
| New cases | 39 (TIL, PTH, SPC, SNP, RND, VIS) |
| Phase 2's golden fixture | **byte-identical** — a Hunt with no map takes the same branches and the same draws |

---

## 7. Open, and honest about it

- **Creature idle behaviour.** A creature that cannot reach the Character stands
  still. That is correct and not interesting; real wandering is a behaviour
  system and belongs to whatever phase wants one.
- **One tile per second is slow** next to the source engine, where a Character's
  step duration comes from its speed. Speed is a stat this game does not have
  yet; when it does, `TICK_MS` is not the thing that should change.
- **The clash marks are a proxy.** They mark adjacency, which is true, rather
  than a specific swing, which the snapshot does not identify per actor.

---

## 8. Self-review, against this phase's stated constraints

Each answer names the thing that would have to change for the answer to be
wrong, so it can be checked rather than believed.

**Is anything in this phase client-authoritative?** No. `TileScene.tsx` reads
`RunView` and writes nothing back; the only requests the window makes are the
advance POST, the snapshot GET and one map fetch (VIS3 asserts the verbs, VIS5
asserts the map is fetched once). There is no input handler on the canvas —
`pointer-events: none` — and no code path that sends a position.

**Is any spatial decision random?** No. `stepToward` and `meleeGoals` take no
RNG and reference none. RND1 changes the seed and asserts every tile and every
move event is identical; RND2 asserts a walking span consumes zero draws.

**Is there a second game clock?** No. `TICK_MS` is unchanged, movement happens
inside the existing tick order, and the only new timer anywhere is
`requestAnimationFrame` in the browser, which draws and decides nothing.

**Are static map tiles in PostgreSQL?** No. The map is a content definition,
compiled at first use and cached by `${bundle.version}:${key}`. The only new
column is `HuntRun.position`, which is *state*, not terrain.

**Are database locks used for spatial arbitration?** No. The whole encounter
resolves inside one pure function during one settlement; arbitration is index
order over one array. §8.5's lock order is untouched.

**Was any existing case weakened, renamed or skipped?** No. The full matrix is
92 + 87 + 106 + 169 + 39, every id present, counted by
`scripts/count-matrix.mjs` in CI. Phase 2's golden fixture is byte-identical.
Two E2E route globs changed from `**/hunt` to `**/hunt/advance` because the
route they were aiming at moved; both cases assert exactly what they asserted
before.

**Is the acceptance evidence real?** Yes, and it is checked in:
[`evidence/`](./evidence/) holds five `page.screenshot()` captures of the
running stack. None is a mockup, a design render or generated art.

**Is anything in this phase claimed as reviewed or verified?** No. The status
is `IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`, in this document, in
the spec and in `docs/PROJECT_STATE.json`. Nothing here has been independently
reviewed, nothing has been merged, and the word `VERIFIED` is not applied to
this phase anywhere.

**What would a reviewer be right to push back on?**

1. *Adjacency without facing.* A Character can be hit from behind exactly as
   easily as from the front. That is Phase 2's combat model unchanged, but on a
   map it is now a visible simplification rather than an invisible one.
2. *The renderer knows the legend.* `TileScene` maps `wall`/`floor`/`water` to
   three drawing routines, so adding a tile kind means touching the client. The
   alternative — shipping colours as content — is a theming system, and this
   phase deliberately did not build one.
3. *One map.* The compiler, the region model and the spatial plan are general;
   the content has exactly one map in it. Nothing here is proven against a
   second map with a different shape.
