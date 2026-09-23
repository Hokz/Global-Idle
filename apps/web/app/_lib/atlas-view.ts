/**
 * The Atlas coordinate transform (Phase 3.7 spec §4).
 *
 * PURE, and deliberately dull: (origin, pixelsPerTile, zoom, pan) in, screen
 * position out, and back again. It is the only thing that converts between a
 * world tile and a pixel on the Atlas, so it is the only thing that can get it
 * wrong — and a round trip is a test rather than an argument.
 *
 * THE CALIBRATION IS NOT SUPPLIED. The reference rasters carry no world origin
 * and no pixels-per-tile scale, so every `Calibration` in this phase is either
 * SYNTHETIC (tests, which prove the arithmetic) or DEMO (the UI, which says so
 * out loud). A correct transform proves nothing whatever about where the
 * Temple really is in Rookgaard — see `isCalibrated`.
 */

/** What a raster would need before a pin could be honest. */
export interface Calibration {
  /** The world tile the raster's top-left pixel corresponds to. */
  readonly originTileX: number;
  readonly originTileY: number;
  /** Raster pixels per world tile, at zoom 1. */
  readonly pixelsPerTile: number;
  /**
   * Whether these numbers came from source data.
   *
   * `false` everywhere in Phase 3.7. A synthetic calibration makes the maths
   * testable; it does not make a position true, and the UI must keep saying so.
   */
  readonly sourced: boolean;
}

export interface Viewport {
  /** Whole-number magnification. Nearest-neighbour, so fractional zoom would
   *  only reintroduce the blur the pixel art exists to avoid. */
  readonly zoom: number;
  /** Raster pixels scrolled, before magnification. */
  readonly panX: number;
  readonly panY: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface WorldTile {
  readonly tileX: number;
  readonly tileY: number;
}

/** A calibration is honest only when it came from the source. Nothing in this
 *  phase does, which is why every real pin renders `demo`. */
export const isCalibrated = (calibration: Calibration): boolean => calibration.sourced;

/**
 * A calibration for TESTS and DEMO PINS.
 *
 * Named so nothing can use it by accident and believe it: `sourced` is false,
 * and a caller that wants to know asks `isCalibrated`.
 */
export const syntheticCalibration = (
  originTileX: number,
  originTileY: number,
  pixelsPerTile: number,
): Calibration => ({ originTileX, originTileY, pixelsPerTile, sourced: false });

export const IDENTITY_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };

/** Zoom is whole-number and bounded: a raster preview, never a pyramid. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export const clampZoom = (zoom: number): number =>
  Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));

/** World tile → screen pixel, inside the Atlas viewport. */
export function worldToScreen(
  tile: WorldTile,
  calibration: Calibration,
  viewport: Viewport,
): ScreenPoint {
  const rasterX = (tile.tileX - calibration.originTileX) * calibration.pixelsPerTile;
  const rasterY = (tile.tileY - calibration.originTileY) * calibration.pixelsPerTile;
  return {
    x: (rasterX - viewport.panX) * viewport.zoom,
    y: (rasterY - viewport.panY) * viewport.zoom,
  };
}

/**
 * Screen pixel → world tile.
 *
 * The exact inverse of `worldToScreen`, and NOT rounded: rounding here would
 * make the round trip lossy for any point inside a tile, and the test that
 * proves the pair are inverses would be testing the rounding instead.
 */
export function screenToWorld(
  point: ScreenPoint,
  calibration: Calibration,
  viewport: Viewport,
): WorldTile {
  const rasterX = point.x / viewport.zoom + viewport.panX;
  const rasterY = point.y / viewport.zoom + viewport.panY;
  return {
    tileX: rasterX / calibration.pixelsPerTile + calibration.originTileX,
    tileY: rasterY / calibration.pixelsPerTile + calibration.originTileY,
  };
}

/**
 * Pan so that a raster point stays under the pointer while the zoom changes.
 *
 * This is what makes wheel-zoom feel like zooming rather than teleporting, and
 * it is arithmetic rather than feel: the raster point under the cursor before
 * the change must be the raster point under it after.
 */
export function zoomAbout(anchor: ScreenPoint, nextZoom: number, viewport: Viewport): Viewport {
  const zoom = clampZoom(nextZoom);
  const rasterX = anchor.x / viewport.zoom + viewport.panX;
  const rasterY = anchor.y / viewport.zoom + viewport.panY;
  return { zoom, panX: rasterX - anchor.x / zoom, panY: rasterY - anchor.y / zoom };
}

/**
 * Keep the raster covering the viewport, whatever the window does.
 *
 * Resize and DPR are the reason this exists as a function: a viewport that
 * grew could otherwise show emptiness past the raster edge, and clamping the
 * PAN rather than the world is what keeps world coordinates untouched by a
 * browser window (spec §4).
 */
export function clampPan(
  viewport: Viewport,
  rasterWidth: number,
  rasterHeight: number,
  viewWidth: number,
  viewHeight: number,
): Viewport {
  const visibleX = viewWidth / viewport.zoom;
  const visibleY = viewHeight / viewport.zoom;
  // A raster smaller than the viewport pins to the origin rather than drifting.
  const maxX = Math.max(0, rasterWidth - visibleX);
  const maxY = Math.max(0, rasterHeight - visibleY);
  return {
    zoom: viewport.zoom,
    panX: Math.max(0, Math.min(maxX, viewport.panX)),
    panY: Math.max(0, Math.min(maxY, viewport.panY)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pins
// ─────────────────────────────────────────────────────────────────────────────

export type PinKind = 'CITY' | 'HUNT' | 'NPC' | 'SHOP' | 'QUEST';

export interface AtlasPin {
  readonly id: string;
  readonly kind: PinKind;
  readonly label: string;
  /** Where it is drawn, in RASTER pixels. */
  readonly rasterX: number;
  readonly rasterY: number;
  /** The content key this pin stands for, when one exists. A pin is allowed to
   *  be decorative; it is not allowed to invent a key. */
  readonly contentKey?: string;
  /**
   * True only when the position came from calibrated source data.
   *
   * False for every pin in Phase 3.7, which is why `pinIsDemo` is true for
   * every pin in Phase 3.7, and why each renders with a visible marking.
   */
  readonly sourced?: boolean;
  /**
   * A destination that exists in the world but is not reachable yet.
   *
   * It stays VISIBLE — a map with holes in it teaches a wrong world — but it
   * is announced as unavailable, cannot be activated, and must never offer an
   * activity that is not implemented. `reason` is shown to the player.
   */
  readonly locked?: boolean;
  readonly reason?: string;
}

/**
 * Must this pin be shown as a demonstration rather than a fact?
 *
 * Yes unless BOTH the pin states a sourced position AND the raster it sits on
 * is calibrated. Either alone is not enough: a sourced tile on an uncalibrated
 * raster lands in an arbitrary pixel, and a calibrated raster does not make up
 * a coordinate nobody supplied.
 */
export const pinIsDemo = (pin: AtlasPin, calibration: Calibration): boolean =>
  !(pin.sourced === true && isCalibrated(calibration));
