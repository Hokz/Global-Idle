# Phase 3.7 — First real asset visual slice

> **Status lives in [`PROJECT_STATE.json`](../../PROJECT_STATE.json), not here.**
> This document is a SPECIFICATION. Nothing in it is implemented, and nothing in it is verified.

---

## 1. Goal, and what this is not

Make the owner **see the intended game** before Party and AI widen the scope. Three surfaces, one
navigation path, no new authority:

```
World Atlas  ──▶  Rookgaard city mini-atlas  ──▶  Rat hunt in the 15 × 11 Game Window
  (macro pins)        (POIs and hunt entries)        (the server's own tiles, with sprites)
```

**This is not** an asset importer for the whole client, a reconstruction of Tibia's maps, a native
client, or any change to how the game decides anything. Every pixel this phase adds is cosmetic.
The server remains the sole authority over combat, randomness, movement timing, persistence, the
economy and content pinning (ADR-010, Phase 3.5 §2, Phase 3.6 §13).

### 1.1 The three-way distinction, which is the product decision

| | What it is | What it is NOT |
|---|---|---|
| **World Atlas** | macro navigation over a Rookgaard raster, with typed pins | not playable geometry, not a coordinate-accurate GIS layer |
| **City mini-atlas** | Rookgaard's own overlay: Temple, shops, NPCs, hunt entries | not a source of truth for where anything really is, until calibrated |
| **Hunt map** | a compact authored tactical arena, drawn tile by tile | not a reproduction of Tibia's sewers, corridors, rooms or sublevels |

Rookgaard's **world and city geography** should match the real Rookgaard as far as the source data
supports. **Hunt arenas are deliberately ORIGINAL** Global Idle content — purpose-designed for
deterministic room combat — while preserving the pixel-art grammar and, where it is known, the
source's ground metadata.

---

## 2. What the private reference actually contains

The Product Owner supplied `Global_Idle_Phase_3_7_Private_Reference.zip` (0.66 MB) out of band. It
was parsed; both declared source hashes match:

| source | SHA-256 | matches brief |
|---|---|---|
| `assets.rar` | `783a07cb6a99a296d1a9bb97d2eeb5a130f330050f231b238d5e92984fac4cc3` | yes |
| `graphics_resources.rcc` | `7586a61662530ffa70568b80d0db2979d834e6d61b06126f3dd354d27b69173d` | yes |

100 files: 62 sprite PNGs, 30 Qt HUD PNGs, 2 map rasters, 2 previews, 3 manifests. Client stats
from the manifest: 39,221 objects, 1,375 outfits, 179 effects, 60 missiles. RCC format version 3,
1,063 files.

**None of it may enter this repository.** See §9.

---

## 3. Asset provenance chain — the contract

Every drawn pixel must be traceable, and the chain has five links, not two:

```
appearanceId          21 (outfit)  ·  44092 (object)
  └─ frameGroup       0 = idle, 1 = moving, 2 = objects
      └─ pattern      patternWidth × patternHeight × patternDepth, and `layers`
          └─ spriteId 3819..3822 (idle), 3823..3854 (moving)
              └─ sheet sprites-<sha>.bmp.lzma + sourceFirstSpriteId + sheetType
                  └─ PNG
```

**This chain describes PRIVATE, CLIENT-DERIVED sprites only.** A public placeholder is
independently authored, so it has its own provenance and its own licence, and it is addressed by a
**semantic asset key** (`tile.cave.floor`, `actor.rat.idle.south`). Giving a placeholder a fabricated
`appearanceId` or `spriteId` would be inventing a source record for art that has no source —
see §3.1.

**Rules.**

1. an asset record stores `appearanceId`, `frameGroup`, `spriteId`, `sourceSheet`,
   `sourceFirstSpriteId`, `cellPx` and `sheetType`. A filename is never an identifier;
2. **sprite cells are 32px OR 64px**, per sheet and appearance. Rat, citizen, cave chest and cave
   wall panel are 64px cells; katana, backpack, doublet, cave floor, gathered earth and stone are
   32px. A 64px cell is anchored bottom-right over its tile and must be drawn into a clipped
   viewport. Nothing may assume 32px universally;
3. `boundingSquare` is an appearance property and is **not** the cell size — the rat is a 32
   bounding square inside a 64px cell;
4. **`bank.waypoints` becomes gameplay `groundSpeed` only for an appearance verified as ground.**
   A decorative item's id must never reach `groundSpeed`. Phase 3.6 already refuses an
   unsimulatable pairing (§13.5 there), but refusing a wrong number late is not the same as never
   authoring it;
5. an appearance's **name is not its role.** See §10 — the spike disproved a name-based guess.

### 3.1 Two kinds of asset, two kinds of record

| | public placeholder | private client-derived |
|---|---|---|
| addressed by | semantic key — `tile.cave.floor` | `appearanceId` + `frameGroup` + `spriteId` |
| provenance | its own author and licence, recorded in the public manifest | the five-link chain above |
| ships in | every build | **no** build — dev-only (§9.2) |
| may claim a source id | **never** | yes, the real one |

The renderer asks for a **semantic key**. Resolution picks the private sprite in development when
one is present, and the public placeholder otherwise. The key is the contract; the source id is a
property of one possible answer to it.

---

## 4. Pixel atlas — zoom, pan, pins

- the Rookgaard raster is displayed with **nearest-neighbour** scaling and a stated honest label:
  a pixel preview of a single raster, not a multi-resolution tile pyramid. A pyramid is a later
  option **only if source data at that resolution exists**;
- a **coordinate transform** converts source tile/world position ⇄ atlas screen position. It is a
  pure function of (origin, pixelsPerTile, zoom, pan) and is round-trip tested **with SYNTHETIC
  calibration parameters**. The maths is testable; the calibration is not supplied. A passing
  transform test proves the function is correct, and proves **nothing** about where anything really
  is in Rookgaard;
- **pins carry typed metadata** — `CITY | HUNT | NPC | SHOP | QUEST` — and may reference an existing
  content key. The renderer holds no persistent state and invents none; a pin without a verified
  coordinate renders with a visible `demo` marking;
- zoom, pan, resize and DPR changes never alter world coordinates.

---

## 5. City mini-atlas

Clicking Rookgaard opens its own overlay: Temple, shops, NPCs and hunt-entry pins, with navigation
back to the world atlas and forward into one hunt. Keyboard and touch both work.

**Every position is `demo` until calibrated.** The supplied rasters carry no world-coordinate origin
and no pixels-per-tile scale (§10), so no NPC or Temple coordinate in this phase may be presented as
exact. Nor does a 512 × 512 crop demonstrate that the island is completely covered — that is an
unproven claim about the raster, and the UI must not imply it. Real geographic precision arrives
with calibration data or not at all.

---

## 6. The visual slice itself

The existing 15 × 11 server-authoritative Game Window renders: a rat, an origin/citizen character
(or a distributable fallback), a cave floor/wall/corner palette, one decorative prop, real
authoritative movement and a basic encounter.

**The wall palette is an independently authored placeholder, and stays one.** The private subset
contains no verified cave wall or corner: 44110 was tested and is not a wall (§11). Until an
appearance *and its gameplay role* are both verified from the source, walls are public art.

**A CANDIDATE id is COSMETIC, always.** 44092, 44091, 1780 and 44078 may be drawn; none of them may
become a collision flag or a `groundSpeed`, because the manifest carries no `unpass`,
no `blockPathFind` and no `bank.waypoints` for any of them. Walkability keeps coming from the
authored tile KIND, and ground speed keeps Phase 3.6's sourced 150 fallback wherever a real
`bank.waypoints` is not known. Sprites decorate the tile; they never define it.

The renderer keeps every Phase 3.5/3.6 guarantee: it draws the leg the server put on the run over
that leg's own duration, it does not choose tiles, it does not advance anything, and the sprite
chosen for an actor is cosmetic.

---

## 7. HUD grammar — new web components

Centred Game Window; Skills, Equipment, Backpack and Battle List at the sides; minimap/Atlas
launcher; action/automation-slot **visual placeholders**; Chat and Server Log below.

The Qt RCC images are **inspection references only**. Every component is HTML and CSS and must look
right in a public build with no private asset present. Correspondence, for the reviewer:

| component | Qt reference it mirrors |
|---|---|
| Skills | `/images/skin/classic/icon-skills-widget.png` |
| Equipment | `/images/inventory-{head,neck,torso,legs,feet,left-hand,right-hand,back,finger}.png` |
| Backpack | `/images/containerslot.png`, `containerslot-border-large.png` |
| Battle List | `/images/skin/classic/icon-battlelist{,-monster,-party,-knight}.png` |
| Health / mana bars | `/images/hitpoints-manapoints-bar-border.png`, `mana-bar-filled.png` |
| Atlas pins | `/images/minimap/markers.png`, `background-for-highlighting-markers.png` |
| Panel chrome | `/images/skin/classic/widget-borderimage.png`, `4pixel-up-frame.png` |

**Out of scope here:** tactical AI, automation rules, premium, vocation and Party systems. The
action slots are empty boxes.

---

## 8. Authority is unchanged

Atlas → Rookgaard → hunt navigation must not mutate combat, RNG, movement timing, persistence,
XP/loot economy or content pinning. Screens reflect server state. There is no second source of
truth in React: no client-side simulation, no optimistic combat, no locally invented position.

---

## 9. Legal and source boundary — DISTRIBUTION, not just Git history

> **Amended after independent review of this spec (condition A1).** The first version relied on
> `.gitignore`, which protects *commits* and protects nothing else. A file under
> `apps/web/public/assets/private/` is gitignored and **still** copied into `.next`, into a Docker
> image, into a static export and onto a CDN. Ignoring a path is not a distribution guarantee.

### 9.1 Where private assets may live — and where they may not

- **`apps/web/public/assets/private/` is FORBIDDEN.** Not "discouraged", not "gitignored" —
  forbidden, and its presence **fails the build**. Everything under `public/` is a distributable
  input by definition; a private file there is a published file waiting for a deploy;
- the private override lives at **`private/assets/`** in the repository root: outside `public/`,
  outside every bundler input, outside every static-copy root. Nothing in the production build
  graph reads that directory;
- `.gitignore` still covers both paths. It is **defence in depth**, not the guarantee.

### 9.2 The dev-only loader

A private preview is served by a **development-only** route that:

- keys on `process.env.NODE_ENV !== 'production'`, which the bundler substitutes at build time so
  the branch is eliminated from a release build;
- refuses in production **regardless of any environment variable**. There is no opt-in flag, because
  a flag is a way to ship it by accident;
- resolves only inside `private/assets/`, with traversal rejected;
- returns 404 when the file is absent, and the caller falls back to the public placeholder silently.

### 9.3 The fail-closed release guard

`scripts/check-release-isolation.mjs` runs in CI and in the release path, and **fails closed**:

1. the forbidden `apps/web/public/assets/private/` path does not exist;
2. no file under any distributable static root carries a private-asset signature;
3. the built output (`.next`, and any export or image layer) contains **no** private asset path and
   **no** private marker string;
4. the dev-only loader is not reachable in a production build.

The marker is a reproducible, non-proprietary sentinel — `GLOBAL_IDLE_PRIVATE_ASSET_MARKER` —
written into the *fake* bytes a test places at the override location. It is a tracer, so the scan
can prove a negative about bytes it has never seen.

### 9.4 What the tests must prove

Both states, not one:

| state | must hold |
|---|---|
| **no private file present** (a clean checkout) | install, build and test succeed; the public placeholder resolves; no request 404s |
| **fake private bytes at `private/assets/`** | a dev build may show them; the **release artefact contains neither the bytes, the path, nor the marker** |
| **anything at `apps/web/public/assets/private/`** | the guard **fails the build** |

- public CI and E2E **never** require the private ZIP or any original client image;
- **no proprietary screenshot** is uploaded as a CI artefact or added to a public PR. Public E2E
  screenshots show public placeholders only;
- **no real private PNG is copied into a committed fixture or snapshot.** Test fixtures are
  synthetic bytes carrying the marker.

### 9.5 Unchanged from the reviewed version

- **public build:** deterministic, legally distributable placeholder art. CI, tests and every public
  artefact use it and must pass with no private file present;
- **never committed:** Tibia sprite sheets, extracted PNGs, satellite/minimap originals, RCC images,
  reconstructed proprietary UI textures, the ZIP, or screenshots containing any of them;
- **no remote asset loading** from unsanctioned endpoints. Assets are local or they do not exist.

This is a private technical prototype. It is not permission to redistribute CipSoft graphics.

---

## 10. Source gap list — VERIFIED / CANDIDATE / MISSING

### VERIFIED (ids and pixels both resolve)

| what | ids |
|---|---|
| Rat | outfit **21**; frameGroup 0 = 4 idle sprites **3819–3822**; frameGroup 1 = 32 moving sprites **3823–3854**; 4×1×1 patterns, 1 layer, boundingSquare 32, 64px cells, 300 ms phases |
| Katana | object **3300** → sprite 175308, 32px |
| Backpack | object **2854** → sprite 174664, 32px |
| Doublet | object **3379** → sprite 175392, 32px |
| Qt HUD | RCC v3, 1,063 files; 30 selected PNGs with exact `rccPath` and dimensions |

### CANDIDATE (id proven, gameplay role unproven)

| what | id | why only a candidate |
|---|---|---|
| cave floor earth | **44092** → sprite 209404 | named "cave floor"; no collision flag and no `bank.waypoints` in the manifest |
| gathered cave floor earth | **44091** → sprite 209403 | same |
| stone | **1780** → sprite 174063 | plausibly decorative, plausibly blocking; nothing says which |
| cave chest | **44078** → sprite 259492 | 64px, boundingSquare 41; container or scenery is unstated |

### MISSING

1. **A source-verified cave WALL palette.** Appearance **44110 "cave wall panel"** was tested and
   **is not a wall**: three diagonal beam pieces (3×1 pattern, boundingSquare 37) that bleed outside
   a tile when tiled. Recorded in §11. No wall/corner set is in this subset;
2. **Collision and ground-speed metadata for every candidate.** The manifest carries no `unpass`,
   no `blockPathFind` and no `bank.waypoints`. Until those are read from the source, no candidate
   may be authored as a gameplay ground or wall — only as decoration over an authored tile kind;
3. **Complete citizen outfit mapping.** Outfit **128** is 4×3×2 patterns with **2 layers** and
   boundingSquare 46 — direction × addon × depth, plus a colour mask layer. The ZIP carries 16
   partial base-layer frames. Directions, addons and the four-colour template are unmapped;
4. **Atlas coordinate calibration.** Satellite 512 × 512 and minimap 245 × 265, with no world origin
   and no pixels-per-tile scale. The full island is therefore **not** verifiably covered, and no pin
   can be exact. Every Rookgaard pin in this phase is `demo`.

---

## 11. What the feasibility spike already established

Run privately, outside the repository, against the attached ZIP.

1. **the arena composes.** A 15 × 11 room drew from real source sprites — cave floor, gathered
   earth, stones, chest, two rats and a citizen — at 32px tiles with 64px cells anchored correctly;
2. **appearance 44110 is not a wall.** Tiling it produced diagonal beams overhanging the arena. The
   name was the only evidence for it, and the name was wrong. The spike's walls became a marked CSS
   placeholder, which is also the public-build path;
3. **the satellite zooms and pans** with nearest-neighbour ×2 and carries three pins, all visibly
   `demo`;
4. **the HUD grammar works with no Qt texture at all** — every panel is CSS.

The spike is disposable and private. Its screenshot is not in this repository.

---

## 12. Decisions

| Id | Decision | Why |
|---|---|---|
| P37-D1 | Atlas, city mini-atlas and hunt map are three separate surfaces | they answer three different questions, and conflating them is how a raster becomes fake geometry |
| P37-D2 | Hunt arenas are ORIGINAL authored content | deterministic room combat needs a bounded arena, not a dungeon |
| P37-D3 | Atlas zoom is nearest-neighbour over one raster, labelled as a preview | claiming a tile pyramid without source data at that resolution would be a lie in the UI |
| P37-D4 | Pins are typed and separate from image pixels | a pin is content; a raster is a backdrop |
| P37-D5 | Unverified pin positions are rendered `demo` | an invented Temple coordinate presented as exact is worse than no Temple pin |
| P37-D6 | Public build uses distributable placeholders; private assets are a gitignored override | CI, tests and any public artefact must work with no private file present |
| P37-D7 | `bank.waypoints` reaches `groundSpeed` only for a verified ground appearance | Phase 3.6's domain refuses bad pairs late; never authoring them is better |
| P37-D8 | The asset record keys on `appearanceId` + `frameGroup` + `spriteId`, never a filename | filenames are not source identity |
| P37-D9 | Sprite cells may be 32px or 64px, per sheet | both exist in the supplied subset; assuming 32 would misplace every creature |
| P37-D10 | An appearance's name is never evidence of its role | 44110 "cave wall panel" is not a wall |
| P37-D11 | `apps/web/public/assets/private/` is FORBIDDEN and fails the build | everything under `public/` is a distributable input; a private file there is a published file waiting for a deploy |
| P37-D12 | The private override lives at `private/assets/`, outside every bundler input | a path the production build graph never reads cannot be shipped by it |
| P37-D13 | The dev loader keys on `NODE_ENV !== 'production'` and has no opt-in flag | a flag is a way to ship it by accident; a build-time substitution is eliminated from the bundle |
| P37-D14 | A fail-closed release guard scans distributable output for private paths and a marker | `.gitignore` protects commits; only a scan of the artefact protects a release |
| P37-D15 | A public placeholder carries its own licence and a semantic key, never a fabricated `appearanceId` | inventing a source record for art with no source is the same lie as inventing a coordinate |
| P37-D16 | Transform tests use SYNTHETIC calibration; a CANDIDATE id stays cosmetic | the maths is testable without calibration, and a sprite must never become collision or `groundSpeed` |

---

## 13. Acceptance matrix — planned, NOT yet counted

`scripts/count-matrix.mjs` counts ids that exist as tests. This phase has **no implementation**, so
`phase-3-7` is deliberately **absent** from that script: registering groups with zero tests would
fail CI and, worse, would claim coverage that does not exist. The groups below are the plan; the
script gains `phase-3-7` in the implementation PR, with the counts it can actually prove.

| Group | Planned cases | What it must fix |
|---|---|---|
| **PRV** | provenance | appearanceId → frameGroup → spriteId → sheet round-trips; 32px and 64px cells both place correctly; a filename is never an id |
| **ATL** | atlas transform | world ⇄ screen round-trip under zoom, pan, resize and DPR; no world coordinate moves |
| **PIN** | pins | typed metadata; content-key backing; an uncalibrated pin renders `demo`; the renderer stores nothing |
| **CTY** | city mini-atlas | navigation in and back out, keyboard and touch; no invented coordinate presented as exact |
| **SLC** | the visual slice | the 15 × 11 window draws the server's tiles, the server's leg and the server's encounter, with sprites |
| **HUD** | HUD grammar | every panel renders with no private asset present; layout holds at desktop and at 390 × 844 |
| **AUTH** | authority | navigation mutates no combat, RNG, timing, persistence, economy or pinning |
| **FALL** | fallback | a missing private override degrades to the placeholder silently; no remote fetch |
| **DIST** | release isolation (A1) | the forbidden `public/assets/private/` path fails the build; a marked fake private file never reaches the artefact by bytes, path or marker; the dev loader is unreachable in production; a clean checkout builds and serves placeholders with no 404 |

---

## 14. Scope boundaries

No world-wide import. No rebuilding Tibia's underground. No UI generated from a giant bitmap. No
schema rewrite. No new simulation clock. No new persistence or migration unless strictly necessary
and separately approved. No Party, no tactical AI, no automation rules, no premium, no vocation
systems.

---

## 15. Amendment history

| when | what |
|---|---|
| initial | the reviewed specification |
| **after independent review** | **A1** — §9 rewritten around DISTRIBUTION rather than Git history: the `public/assets/private/` path is forbidden and build-failing, the override moves to `private/assets/`, the dev loader is `NODE_ENV`-gated with no opt-in flag, a fail-closed release guard scans the artefact, and both the absent and the marked-fake states are tested. New decisions P37-D11–D14 and the **DIST** acceptance group. **A2** — §3.1 separates public-placeholder provenance (semantic key, own licence) from client-derived provenance (five-link chain, never fabricated); §4 states transform tests use SYNTHETIC calibration and prove nothing about real geography; §5 adds that a 512 × 512 crop does not demonstrate island coverage; §6 fixes walls as independently authored placeholders and CANDIDATE ids as cosmetic-only, with Phase 3.6's 150 fallback retained. New decisions P37-D15–D16. |

---

## 16. Status

`IMPLEMENTATION_SPEC_READY` — specification only. This document has not been independently reviewed, no
implementation exists, and Phase 3.7 may not be treated as designed-and-accepted. The implementation
PR is gated on independent review of this spec and of the private spike.
