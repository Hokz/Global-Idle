/**
 * Phase 3.7 §13 — ATL and PIN. The Atlas transform, and what a pin may claim.
 *
 * The arithmetic is testable; the CALIBRATION is not supplied. Every case here
 * uses a SYNTHETIC calibration, and that is the point rather than a shortcut:
 * a passing transform test proves the function is its own inverse, and proves
 * nothing whatever about where the Temple really is in Rookgaard (spec §4).
 */
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  clampZoom,
  isCalibrated,
  pinIsDemo,
  screenToWorld,
  syntheticCalibration,
  worldToScreen,
  zoomAbout,
  type AtlasPin,
  type Viewport,
} from '../../apps/web/app/_lib/atlas-view.js';

/** Rookgaard-shaped numbers, invented: origin tile (32000, 31900), 2 px a tile. */
const CAL = syntheticCalibration(32_000, 31_900, 2);

describe('§13 ATL — the Atlas transform', () => {
  it('ATL1: world → screen is a pure function of origin, scale, zoom and pan', () => {
    // By hand: (32010 − 32000) × 2 = 20 raster px, minus pan 4, times zoom 3.
    const view: Viewport = { zoom: 3, panX: 4, panY: 6 };
    expect(worldToScreen({ tileX: 32_010, tileY: 31_910 }, CAL, view)).toEqual({
      x: (20 - 4) * 3,
      y: (20 - 6) * 3,
    });
    // The origin tile sits at the raster origin, before pan and zoom.
    expect(worldToScreen({ tileX: 32_000, tileY: 31_900 }, CAL, IDENTITY_VIEWPORT)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('ATL2: screen → world → screen round-trips exactly, at every zoom and pan', () => {
    // Not one sample: a sweep, because an inverse that only holds at zoom 1 is
    // the kind of bug a single case misses.
    for (const zoom of [1, 2, 3, 5, 8]) {
      for (const [panX, panY] of [
        [0, 0],
        [7, 13],
        [120, 96],
      ] as const) {
        const view: Viewport = { zoom, panX, panY };
        for (const [x, y] of [
          [0, 0],
          [17, 5],
          [333, 291],
        ] as const) {
          const back = worldToScreen(screenToWorld({ x, y }, CAL, view), CAL, view);
          expect(back.x, `zoom ${zoom} pan ${panX},${panY}`).toBeCloseTo(x, 9);
          expect(back.y, `zoom ${zoom} pan ${panX},${panY}`).toBeCloseTo(y, 9);
        }
      }
    }
  });

  it('ATL3: zoom is whole-number and bounded — a preview, not a pyramid', () => {
    // Fractional zoom on a nearest-neighbour raster reintroduces exactly the
    // blur the pixel art exists to avoid, so it is rounded away.
    expect(clampZoom(2.4)).toBe(2);
    expect(clampZoom(2.6)).toBe(3);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
    expect(clampZoom(999)).toBe(MAX_ZOOM);
    expect(MIN_ZOOM).toBe(1);
  });

  it('ATL4: zooming holds the raster point under the pointer still', () => {
    // What makes a wheel feel like zoom rather than teleport, and it is
    // arithmetic: the raster point under the cursor before must be the raster
    // point under it after.
    const anchor = { x: 200, y: 140 };
    const before: Viewport = { zoom: 2, panX: 30, panY: 20 };
    const after = zoomAbout(anchor, 5, before);
    expect(after.zoom).toBe(5);
    const rasterBefore = screenToWorld(anchor, CAL, before);
    const rasterAfter = screenToWorld(anchor, CAL, after);
    expect(rasterAfter.tileX).toBeCloseTo(rasterBefore.tileX, 9);
    expect(rasterAfter.tileY).toBeCloseTo(rasterBefore.tileY, 9);
  });

  it('ATL5: resize and DPR move the PAN, never a world coordinate', () => {
    // A browser window is not allowed to change where anything is. Clamping
    // the pan keeps the raster covering the viewport while every world tile
    // maps to the same raster pixel it always did.
    const view: Viewport = { zoom: 2, panX: 400, panY: 400 };
    const small = clampPan(view, 512, 512, 300, 200);
    const large = clampPan(view, 512, 512, 900, 700);

    // Clamped differently for different viewports, because a wider view shows
    // more raster and so may scroll less far:
    //   zoom 2, view 300 -> 150 raster px visible, max pan 512 − 150 = 362
    //   zoom 2, view 900 -> 450 raster px visible, max pan 512 − 450 =  62
    expect(small.panX).toBe(512 - 300 / 2);
    expect(large.panX).toBe(512 - 900 / 2);
    expect(large.panX).toBeLessThan(small.panX);
    // …and yet the world→raster half of the transform is untouched by either.
    for (const clamped of [small, large]) {
      const at = worldToScreen({ tileX: 32_050, tileY: 31_950 }, CAL, {
        ...clamped,
        panX: 0,
        panY: 0,
      });
      expect(at).toEqual({ x: 100 * clamped.zoom, y: 100 * clamped.zoom });
    }
    // And a raster the viewport fully contains pins to the origin rather than
    // drifting: 100 raster px against 450 visible leaves nothing to scroll.
    expect(clampPan(view, 100, 100, 900, 700)).toEqual({ zoom: 2, panX: 0, panY: 0 });
  });
});

describe('§13 PIN — what a pin is allowed to claim', () => {
  const demoPin: AtlasPin = {
    id: 'temple',
    kind: 'CITY',
    label: 'Temple',
    rasterX: 255,
    rasterY: 196,
  };

  it('PIN1: no calibration is sourced in this phase, so every pin is DEMO', () => {
    // The supplied rasters carry no world origin and no pixels-per-tile scale.
    // `syntheticCalibration` says so in its own return value, and the UI reads
    // it rather than deciding for itself.
    expect(isCalibrated(CAL)).toBe(false);
    expect(pinIsDemo(demoPin, CAL)).toBe(true);
    // Even a pin that CLAIMS a sourced position is demo on an uncalibrated
    // raster: a real tile still lands in an arbitrary pixel.
    expect(pinIsDemo({ ...demoPin, sourced: true }, CAL)).toBe(true);
  });

  it('PIN2: both halves are required before a pin is a fact', () => {
    // A calibrated raster does not invent a coordinate nobody supplied, and a
    // sourced coordinate is meaningless on a raster nothing has aligned.
    const sourcedCal = { ...CAL, sourced: true };
    expect(pinIsDemo(demoPin, sourcedCal)).toBe(true); // calibrated, unsourced pin
    expect(pinIsDemo({ ...demoPin, sourced: true }, CAL)).toBe(true); // sourced pin, no calibration
    expect(pinIsDemo({ ...demoPin, sourced: true }, sourcedCal)).toBe(false); // both
  });

  it('PIN3: a pin carries typed metadata and may reference content, never invent it', () => {
    const pins: readonly AtlasPin[] = [
      { id: 'a', kind: 'CITY', label: 'Rookgaard', rasterX: 1, rasterY: 1 },
      { id: 'b', kind: 'HUNT', label: 'Sewers', rasterX: 2, rasterY: 2, contentKey: 'hunt.x' },
      { id: 'c', kind: 'NPC', label: 'Someone', rasterX: 3, rasterY: 3 },
      { id: 'd', kind: 'SHOP', label: 'Shop', rasterX: 4, rasterY: 4 },
      { id: 'e', kind: 'QUEST', label: 'Quest', rasterX: 5, rasterY: 5 },
    ];
    expect(pins.map((pin) => pin.kind)).toEqual(['CITY', 'HUNT', 'NPC', 'SHOP', 'QUEST']);
    // A content key is optional and, when present, is a real key the server
    // knows — the pin never mints one.
    expect(pins.filter((pin) => pin.contentKey !== undefined)).toHaveLength(1);
    // And none of them is a fact yet.
    expect(pins.every((pin) => pinIsDemo(pin, CAL))).toBe(true);
  });
});
