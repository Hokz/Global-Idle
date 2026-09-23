# Phase 3.6 — Implementation notes

What this phase actually did, what it found while doing it, and what it refused to do. The
specification is the contract; this is the record.

---

## 1. Half of it already existed, and that was the point

The brief said so before the work started, and reading the code agreed: Phase 3.5 had already
imported the logarithmic curve, the 50 ms beat, the ×3 diagonal, the authoritative leg, the
persistence of a step in flight and a renderer that interpolates from server times. What it had
left as constants were the curve's other two inputs.

So this phase is four small changes and a lot of evidence:

| | |
|---|---|
| `playerBaseStepSpeed(level, base = 110)` | the domain's incidental expression became a pure engine function with the source's clamp |
| `MapTileDefinition` in the legend | a symbol can carry its ground's speed |
| `TileMap.groundSpeed: Uint16Array` | compiled, dense, O(1) |
| `durationFor` uses `groundSpeedAt(map, from)` | the departure tile, not the destination |

Nothing else in the movement engine moved. No new loop, no new clock, no new persisted shape, no
migration — ground speed rides in the content bundle, which the Activity already pins.

---

## 2. The one that is easy to get backwards

`Creature::setParent` caches `walk.groundSpeed` from the tile the creature is **placed on**, and
`getStepDuration` divides by that cache. The step out of mud is slow *because you are standing in
the mud*; arriving on stone does not make the arriving step fast.

Writing it the other way round is a one-character difference and produces a plausible-looking
game. `GRD3` is two mirror-image maps — `#fs..#` and `#sf..#` — where the Character departs the
same tile index in both and the answer must be 200 ms in one and 3,100 ms in the other. Changing
`from` to `to` in `durationFor` and rebuilding makes it fail with `expected 3100 to be 200`, which
is how the case was checked for teeth.

**A lesson recorded while doing that:** the unit project resolves the workspace package to its
BUILT output. A source edit with no rebuild changes nothing a test can see, and the first attempt
at that bite check passed against a stale `dist` and briefly looked like a toothless case. Rebuild
before believing a negative result.

---

## 3. Ground speed had to be findable, not invented

The obvious risk in a phase like this is authoring plausible numbers and calling them fidelity.
Following the source to where a ground's speed actually comes from answered it:

```cpp
iType.speed = object.flags().has_bank() ? bank().waypoints() : 0;   // src/items/items.cpp:230
```

It is the client appearance archive's `bank.waypoints`. Decoding the shipped
`data/items/appearances.dat` with the minimal protobuf reader Phase 3 already had — 42,107
appearance objects — gives the real distribution: 150 is the most common authored value (1,097 of
them, the same number as the hard-coded fallback), 100 is next (834), and the range runs from 50 at
the fast end to 850 at the slow. Those are the numbers the fixtures use.

Two consequences, both deliberate:

- the **production Rookgaard Sewers is untouched** and still at the fallback. Its tiles have no
  sourced metadata, and the archive is not in this repository yet;
- the **Phase 3.7 importer has an exact field to read**, and the tile definition it will fill
  already exists — kind, ground speed, and visual identity to come.

---

## 4. The staircase, and why it is not a feature flag

The Product Owner's informal "bugging speed" is `ceil(duration / 50) × 50` and nothing else.

Levels 1 to 10 all step in 550 ms on default ground; level 11 is the first to reach 500. The bands
begin at levels 1, 11, 26, 46, 72, 110, 169 and 271. On faster ground the same Character sits on a
different step — level 8 has not left 550 on ground 150 but is already at 350 on ground 100 — and
on ground 850 a level-200 Character is still spending 1,350 ms a step. At 50 ms the quantization
runs out of room and more speed buys nothing at all.

Every number in the spec's table was recomputed from the formula by hand in the test comments, not
by calling the function under test. A test that computes its expectation the same way the
implementation does agrees with any bug the implementation has.

---

## 5. Proving it is gameplay and not arithmetic

A formula nothing consumes proves nothing, so `THR1` and `THR2` run a real corridor through the
real domain and database: a lane with a Rat at each end, one endless room, two spawn tiles, so
every cycle costs a full crossing.

| twelve authoritative minutes | step | tiles walked | encounters finished |
|---|---|---|---|
| level 64, ground 150 | 400 ms | 1,277 | **28** |
| level 64, ground 50 | 150 ms | 2,047 | **56** |

Exactly double. The metric is a count of completed cycles rather than an XP total, because a
balance retune must not be able to break a determinism case.

The level axis needed care. A higher level both walks faster *and* kills faster, so "more tiles
walked" alone would not isolate movement. The case therefore asserts the **leg duration** directly
— 550 ms at level 1, 400 ms at level 64, on identical ground — and says in the test why that is
the isolated claim and the throughput is the consequence.

---

## 6. The counterintuitive one, asserted on purpose

`PTH16` builds a map with a slow direct route and a fast detour and asserts the pathfinder still
takes the slow one. That looks like a bug until you read `AStarNodes::getMapWalkCost`, which is
topology and nothing else.

> Ground speed decides how long a step takes. It is not a term in what a route costs.

Writing the case down is the point: a future contributor who "fixes" the pathfinder to prefer fast
ground will fail a test that explains, in its own comment, that the behaviour is the source's and
that a time-optimal route is a product feature nobody has asked for yet.

The id is `PTH16`, continuing Phase 3.5's `PTH1`–`PTH15`, because an id names one case across the
project rather than one case per phase.

---

## 7. What the browser had to be asked differently

`REN1` set out to watch the Character cross a fast tile and a slow one. Two problems, both real:

1. the production map has no authored speeds, and inventing some would be exactly the thing §10
   forbids;
2. the first version measured the **screen** centroid in the middle of a 61-wide map, where the
   camera follows the Character and a one-tile walk barely moves it on screen. The case failed with
   "the Character never started the injected step" — correctly.

The answer to both: write one authoritative leg of 3,000 ms into the run row — the shape slow
ground produces, without touching content — and measure it against the **left map edge**, where the
camera is clamped and screen position *is* world position.

It measures 3,000 ms. Shortening the injected leg to 700 ms makes the same measurement read
**685 ms**, which is how the case was checked for teeth: it tracks the authoritative duration to
within two percent, and a fixed local ease would read its own constant no matter what the server
said.

---

## 8. Open, and honest about it

- **One map with authored speeds, and it is a test fixture.** The compiler and the engine are
  general; the shipped content has no multi-speed map, and will not until the assets arrive.
- **No effect can change speed yet.** `varSpeed` — haste, paralyze, boots, mounts — is one term
  added before the clamp when a condition system exists. The seam is a parameter, not a framework.
- **Immobility is refusal, not slowness**, and nothing in the shipped content is immobile. The
  behaviour is asserted; it has no player-facing use yet.
- **A time-optimal route is deferred**, deliberately, and guarded by a case (§6).

---

## 9. Self-review, against this phase's stated questions

**Does the same Character move at different speeds on different authored ground?** Yes — `GRD2`,
`GRD4` and `THR1`: 400 ms a step on ground 150 and 150 ms on ground 50, and twice the encounters.

**Is the duration based on the FROM tile?** Yes — `GRD3`, with mirror-image maps; using `to`
instead makes it fail.

**Does level change movement through the source's progression?** Yes — `SPD2`, `SPD3` and `THR2`:
`110 + (level − 1)`, 550 ms at level 1 and 400 ms at level 64 on the same ground.

**Was the curve and the 50 ms quantization preserved exactly?** Yes — `SPD1` reproduces 550 and
900 ms from hand arithmetic, and `BRK1`–`BRK3` pin the plateaus and the bands.

**Does the diagonal preserve the source's operation order?** Yes — `GRD7` shows the alternative
ordering produces 1,100 ms where the source produces 1,200, and asserts the source's.

**Does an Activity stay pinned to its content version's ground?** Yes — `VER1` publishes a second
bundle with the same map key and faster ground; the running Activity keeps its 400 ms legs and a
run started afterwards gets 150 ms ones.

**Does a restart preserve an in-flight variable-duration leg?** Yes — `DET1` and `DET2` catch a leg
mid-flight on ground 850 and on ground 50, finish one run in-process and the other in a fresh
process, and compare the whole durable row.

**Is client rendering still purely presentational?** Yes — `REN1` and `REN2`: the window draws
whatever duration the server put on the leg, and neither the viewport nor the DPR changes the
world it sees or the timing it obeys.

**Did A\* stay independent of ground speed?** Yes — `PTH16`, deliberately.

**Can Hunt throughput now change from level and terrain?** Yes — §5, measured.

**Did we avoid fake production tile speeds?** Yes — the Sewers is untouched; every multi-speed case
is a fixture.

**Did we avoid Phase 4 scope?** Yes. No Party, no tactical AI, no automation, no conditions, no
asset importer.

**Are Phase 3.5's 95 cases still green?** Yes, along with every earlier matrix.

**Is the project ready for the real asset archive without another movement rewrite?** Yes — the
importer fills `groundSpeed` on a tile definition that already exists, from a protobuf field the
source map names.
