# Atlas navigation and region boundaries

**Status:** `APPROVED DIRECTION` for the navigation hierarchy and the boundary/raster separation ·
`FUTURE / NOT IMPLEMENTED` for region polygons, calibration and the gold region highlight.

**Owning phases:** Phase 3.7 owns the hierarchy and the uncalibrated-pin rule · Phase 9 owns
verified calibration, region polygons and the region-wide highlight.

**Related:** [`docs/specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md`](../../specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md)
· [`docs/MASTER_DEVELOPMENT_ROADMAP.md`](../../MASTER_DEVELOPMENT_ROADMAP.md) §20
· [`docs/PHASE_GATES.md`](../../PHASE_GATES.md)

---

## 1. Why this document exists

The Atlas is four different things wearing one name. A world map, a regional map, a city view and
a playable tile scene have different jobs, different data and different truth claims, and
conflating them is how a decorative pin becomes a coordinate somebody later trusts.

This document fixes the hierarchy and, more importantly, fixes **what each surface is allowed to
claim**.

---

## 2. The four navigation surfaces — `APPROVED DIRECTION`

```text
WORLD ATLAS          macro / minimap-like       navigation only
  └─ REGIONAL MINI-ATLAS   the detailed source crop for one region
       └─ LOCAL FOCUS      a city or subarea, narrower still
            └─ GAME WINDOW playable, server-authoritative
```

| Surface | What it is | What it may claim |
|---|---|---|
| **World Atlas** | macro overview, minimap-like. Coarse; it exists to get a player to a region. | Region identity and navigation targets. Not exact geography. |
| **Regional mini-atlas** | where the detailed source crop belongs. One region at readable resolution. | Region-level layout, once calibrated. Until then, nothing positional. |
| **Local focus** | a city or subarea — narrower than the region, wider than a hunt. | Place identity and entry points. |
| **Game Window** | the playable 15 × 11 tile scene. | Everything it draws, because the server authored it. |

Only the **Game Window** is playable and server-authoritative. The three atlas surfaces are
navigation: they name content keys and let a player choose one. They start nothing, store no
position and decide no outcome — see [`§8 of the master roadmap's authority rules`](../../MASTER_DEVELOPMENT_ROADMAP.md)
and the `AUTH` acceptance cases in the Phase 3.7 specification.

## 3. Boundaries are data, not pixels — `APPROVED DIRECTION`

**A region boundary is a separate datum from the raster it is drawn over.**

This is an architectural requirement, not a rendering preference. A boundary stored as "these
pixels are Rookgaard" dies the moment the raster is recropped, rescaled or replaced. A boundary
stored as world-coordinate geometry survives all three, and can be checked against the map the
server already owns.

The architecture must therefore accept region boundaries **later** without rework:

- a region carries an identity and, when sourced, a **polygon in world coordinates**;
- the raster carries a **calibration** — a world origin and a pixels-per-tile scale — that maps
  world coordinates onto its own pixels;
- the renderer composes the two. It never stores geometry of its own.

Phase 3.7 ships the transform half of this (`worldToScreen` / `screenToWorld` and a
`Calibration` record) with `sourced: false` throughout. The polygon half is future work.

## 4. Calibration, and the rule about coordinates — `APPROVED DIRECTION`

**No invented coordinate. Ever.**

- A calibration is `sourced` only when its origin and scale came from source data. A calibration
  made up to make the arithmetic exercisable is `SYNTHETIC`, and must say so in its own value.
- A pin whose position is not sourced, or whose raster is not calibrated, renders as a visible
  **demo** marker. The marking is not suppressible.
- A correct coordinate transform proves the *arithmetic* is right. It proves nothing whatever
  about where a place really is.

This is the rule that keeps a plausible-looking map from quietly becoming a false one.

## 5. Gold region highlight — `FUTURE / NOT IMPLEMENTED`

**Approved as a future visual behaviour, gated on sourced polygons.**

The intended behaviour: hovering or selecting a region fills the **entire true region polygon**
with a gold highlight and draws its border. Not a bounding box, not a hand-drawn blob, not a
circle around a pin — the real shape.

It is gated precisely because a fake shape is worse than no shape: a golden border drawn around
invented geometry teaches the player a wrong map and teaches the project a wrong fact. The
highlight ships when, and only when, calibrated polygons exist. Until then regions are selected
from a list or a demo pin.

**Deferred with it:** accurate geographic polygons and raster calibration generally. The
architecture accepts them; the data does not exist yet.

## 6. Asset isolation — `APPROVED DIRECTION`, already enforced

Public-art / private-asset isolation remains mandatory on every surface in this document.

Private client-derived material is a local reference, never a distributable artefact. The
boundary is enforced by `pnpm release:check`; `apps/web/public/assets/private/` is a forbidden
path; the development-only loader cannot serve in production. A map raster derived from
proprietary source material is subject to exactly the same rule as a sprite.

Placeholder art authored by this project carries its own provenance and a semantic key, and
never a fabricated source id.

## 7. Open questions

Tracked in [`docs/OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md) under *World, Atlas and regions*:

- where calibrated region polygons come from, and what licence covers them;
- whether a region boundary is one polygon or a multi-polygon with holes;
- whether the world atlas and the regional atlas share one coordinate space or two;
- what a region highlight does at a boundary two regions share.
