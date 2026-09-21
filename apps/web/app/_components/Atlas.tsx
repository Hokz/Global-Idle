'use client';

/**
 * The World Atlas (spec §7, V5–V7).
 *
 * Inline SVG, no map library: one region and a handful of markers do not need
 * a tile pyramid, and real DOM nodes give keyboard focus and accessible names
 * for free — both of which §15 requires and a canvas would lose.
 *
 * NOTHING essential is hover-only. Markers and regions are activated by click,
 * tap, or focus plus Enter. §7.1's table is implemented in full: wheel and
 * pinch zoom, one- and two-finger touch, keyboard pan and zoom, region focus,
 * and deselect by Escape or by pressing empty space.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Atlas as AtlasData, Marker, Region } from '../_lib/api';
import { asset } from '../_lib/assets';

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** The SVG user-space the camera moves within. */
const VIEW = { width: 1100, height: 700 } as const;

/**
 * §7.1: zoom is clamped `minZoom..maxZoom` **from region data**, not from a
 * constant this component invented.
 *
 * The bound is the INTERSECTION across the regions a player can actually be
 * in, so no reachable region is ever rendered outside its own declared range.
 * Phase 1 authors exactly one AVAILABLE region (content rule `one-available-
 * region`), so the intersection is that region's range; the intersection is
 * what keeps this correct when a second region opens. Locked regions are
 * scenery — their ranges are not a constraint on a camera that cannot enter
 * them.
 */
export function zoomBounds(regions: readonly Region[]): { min: number; max: number } {
  const available = regions.filter((region) => region.availability === 'AVAILABLE');
  const usable = available.length > 0 ? available : regions;
  if (usable.length === 0) return { min: 1, max: 1 };

  const min = Math.max(...usable.map((region) => region.minZoom));
  const max = Math.min(...usable.map((region) => region.maxZoom));
  // An empty intersection would mean two reachable regions declare ranges that
  // do not overlap, which is a content error rather than something to paper
  // over silently. Phase 1 cannot reach it; widening to the union here would
  // hide it from whoever does.
  return min <= max ? { min, max } : { min, max: min };
}

/** Client pixels → SVG user units, through the element's own CTM. */
function toUserSpace(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: VIEW.width / 2, y: VIEW.height / 2 };
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: point.x, y: point.y };
}

const centreOf = (region: Region) => ({
  x: region.atlas.x + region.atlas.width / 2,
  y: region.atlas.y + region.atlas.height / 2,
});

/**
 * Is this pointer event on a control that handles its own activation?
 *
 * REGIONS ARE NOT CONTROLS FOR THIS PURPOSE. They cover the whole map, so
 * treating them as ones made pan and pinch work only in the gaps between them
 * — which, with four locked regions and one available one, is almost nowhere.
 * A press on a region is resolved on pointer-UP instead, by how far it
 * travelled: a short press activates the region, a long one panned.
 */
const onControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest('button') !== null;

/** The region a press landed on, if any. */
const regionKeyAt = (target: EventTarget | null): string | null =>
  target instanceof Element
    ? (target.closest('[data-region]')?.getAttribute('data-region') ?? null)
    : null;

export function Atlas({
  data,
  selected,
  onSelect,
}: {
  data: AtlasData;
  selected: Marker | null;
  onSelect: (marker: Marker | null) => void;
}) {
  const bounds = useMemo(() => zoomBounds(data.regions), [data.regions]);
  const clamp = useCallback(
    (value: number) => Math.min(bounds.max, Math.max(bounds.min, value)),
    [bounds],
  );

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: clamp(1) });
  const [focused, setFocused] = useState<Region | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  /** Every pointer currently down on the map, in SVG user units. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** One-finger / mouse pan. */
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  /** Two-finger pinch: the distance and midpoint the gesture started from. */
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  /** How far the current press has travelled. A press that did not move is a
   *  CLICK: on a region it focuses, on empty space it deselects (§7.1). */
  const travelled = useRef(0);
  /** Which region the current press started on, if any. */
  const pressedRegion = useRef<string | null>(null);

  const regionOf = useMemo(() => {
    const byKey = new Map(data.regions.map((region) => [region.key, region]));
    return (marker: Marker) => byKey.get(marker.region);
  }, [data.regions]);

  const pan = (dx: number, dy: number) => setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));

  /**
   * Zoom about a FIXED POINT in user space, so the world under the cursor or
   * between the fingers stays where it is. Zooming about the origin instead
   * makes the map slide away from whatever the player was looking at.
   */
  const zoomAbout = (factor: number, anchor?: { x: number; y: number }) =>
    setCamera((c) => {
      const zoom = clamp(Number((c.zoom * factor).toFixed(4)));
      if (zoom === c.zoom) return c;
      const point = anchor ?? { x: VIEW.width / 2, y: VIEW.height / 2 };
      const ratio = zoom / c.zoom;
      return { zoom, x: point.x - (point.x - c.x) * ratio, y: point.y - (point.y - c.y) * ratio };
    });

  const reset = () => {
    setCamera({ x: 0, y: 0, zoom: clamp(1) });
    setFocused(null);
  };

  /** Activating a region CENTRES it. It never navigates: a locked region has
   *  nowhere to navigate to, and an available one is already where you are. */
  const focusRegion = (region: Region) => {
    setFocused(region);
    setCamera((c) => {
      const centre = centreOf(region);
      return {
        ...c,
        x: VIEW.width / 2 - centre.x * c.zoom,
        y: VIEW.height / 2 - centre.y * c.zoom,
      };
    });
  };

  const deselect = () => {
    onSelect(null);
    setFocused(null);
  };

  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Atlas controls">
        <button type="button" onClick={() => zoomAbout(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomAbout(0.8)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={reset}>
          Reset view
        </button>
        <span className="muted small" data-testid="zoom">
          {Math.round(camera.zoom * 100)}%
        </span>
        <span className="muted small" data-testid="focused-region">
          {focused
            ? focused.availability === 'AVAILABLE'
              ? focused.label
              : `${focused.label} — Coming in a later phase`
            : 'Rookgaard'}
        </span>
      </div>

      <svg
        ref={svgRef}
        className="atlas"
        data-testid="atlas"
        data-zoom-min={bounds.min}
        data-zoom-max={bounds.max}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="application"
        aria-label="World Atlas. Drag to pan, scroll or pinch to zoom, or Tab to a region or marker."
        tabIndex={0}
        onKeyDown={(event) => {
          const step = 40;
          if (event.key === 'ArrowLeft') pan(step, 0);
          else if (event.key === 'ArrowRight') pan(-step, 0);
          else if (event.key === 'ArrowUp') pan(0, step);
          else if (event.key === 'ArrowDown') pan(0, -step);
          else if (event.key === '+' || event.key === '=') zoomAbout(1.25);
          else if (event.key === '-') zoomAbout(0.8);
          else if (event.key === 'Escape') deselect();
          else return;
          event.preventDefault();
        }}
        onWheel={(event) => {
          // §7.1 desktop zoom. `touch-action: none` on the element means the
          // page does not scroll underneath, so this is not stealing a gesture
          // the document wanted.
          const svg = svgRef.current;
          const anchor = svg ? toUserSpace(svg, event.clientX, event.clientY) : undefined;
          zoomAbout(event.deltaY < 0 ? 1.15 : 1 / 1.15, anchor);
        }}
        onPointerDown={(event) => {
          // Only the BACKGROUND starts a gesture. Capturing the pointer on a
          // marker press swallows the click that selects it — found by driving
          // the real browser, where the marker was visible and clickable and
          // the handler simply never ran.
          if (onControl(event.target)) return;
          const svg = svgRef.current;
          if (!svg) return;

          const point = toUserSpace(svg, event.clientX, event.clientY);
          pointers.current.set(event.pointerId, point);
          event.currentTarget.setPointerCapture(event.pointerId);

          if (pointers.current.size === 2) {
            // A second finger turns the pan into a pinch. The pan anchor is
            // dropped so the map does not lurch when one finger lifts.
            const [a, b] = [...pointers.current.values()];
            pinch.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: camera.zoom };
            drag.current = null;
          } else if (pointers.current.size === 1) {
            travelled.current = 0;
            pressedRegion.current = regionKeyAt(event.target);
            drag.current = { x: point.x, y: point.y, ox: camera.x, oy: camera.y };
          }
        }}
        onPointerMove={(event) => {
          const svg = svgRef.current;
          if (!svg || !pointers.current.has(event.pointerId)) return;
          const point = toUserSpace(svg, event.clientX, event.clientY);
          pointers.current.set(event.pointerId, point);

          if (pointers.current.size >= 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()];
            const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
            if (pinch.current.distance > 0) {
              const midpoint = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
              const target = clamp(pinch.current.zoom * (distance / pinch.current.distance));
              setCamera((c) => {
                if (target === c.zoom) return c;
                const ratio = target / c.zoom;
                return {
                  zoom: target,
                  x: midpoint.x - (midpoint.x - c.x) * ratio,
                  y: midpoint.y - (midpoint.y - c.y) * ratio,
                };
              });
            }
            travelled.current = Infinity;
            return;
          }

          const start = drag.current;
          if (!start) return;
          travelled.current += Math.hypot(point.x - start.x, point.y - start.y);
          setCamera((c) => ({
            ...c,
            x: start.ox + (point.x - start.x),
            y: start.oy + (point.y - start.y),
          }));
        }}
        onPointerUp={(event) => {
          const had = pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (pointers.current.size === 0) {
            drag.current = null;
            // A press that did not become a drag is a CLICK. On a region it
            // focuses that region; on empty space it deselects (§7.1).
            // Distinguishing the two by travel is what lets panning, focusing
            // and dismissing share one gesture surface.
            if (had && travelled.current < 4 && !onControl(event.target)) {
              const key = pressedRegion.current;
              const region = key
                ? data.regions.find((candidate) => candidate.key === key)
                : undefined;
              if (region) focusRegion(region);
              else deselect();
            }
            pressedRegion.current = null;
          } else if (pointers.current.size === 1) {
            // A finger lifted out of a pinch: re-anchor the remaining one so
            // the map does not jump.
            const [remaining] = [...pointers.current.values()];
            drag.current = { x: remaining!.x, y: remaining!.y, ox: camera.x, oy: camera.y };
          }
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (pointers.current.size === 0) drag.current = null;
        }}
      >
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          {data.regions.map((region) => (
            <RegionShape
              key={region.key}
              region={region}
              focused={focused?.key === region.key}
              onActivate={focusRegion}
            />
          ))}
          {data.markers.map((marker) => (
            <MarkerButton
              key={marker.key}
              marker={marker}
              region={regionOf(marker)}
              selected={selected?.key === marker.key}
              onSelect={onSelect}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function RegionShape({
  region,
  focused,
  onActivate,
}: {
  region: Region;
  focused: boolean;
  onActivate: (region: Region) => void;
}) {
  const locked = region.availability !== 'AVAILABLE';
  const art = asset(region.backdropAssetId);
  return (
    <g
      data-region={region.key}
      data-testid={`region-${region.key}`}
      role="button"
      tabIndex={0}
      // §7.3: a locked region is VISIBLE, dimmed and `aria-disabled` — present
      // in the tree so a screen-reader user perceives the same sense of scale a
      // sighted one does, and announced as unavailable rather than hidden.
      aria-disabled={locked || undefined}
      aria-label={
        locked
          ? `${region.label}. Locked — coming in a later phase.`
          : `${region.label}. Available.`
      }
      opacity={locked ? 0.45 : 1}
      style={{ cursor: 'pointer' }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        onActivate(region);
      }}
    >
      <rect
        x={region.atlas.x}
        y={region.atlas.y}
        width={region.atlas.width}
        height={region.atlas.height}
        rx="14"
        fill={art.fill}
        stroke={focused ? '#7fb3ff' : art.stroke}
        strokeWidth={focused ? 4 : 2}
        strokeDasharray={locked ? '8 6' : undefined}
      />
      <text
        x={region.atlas.x + 16}
        y={region.atlas.y + 30}
        fill="#e7e9ee"
        fontSize="18"
        fontWeight="600"
        pointerEvents="none"
      >
        {region.label}
        {locked ? ' 🔒' : ''}
      </text>
      {locked ? (
        <text
          x={region.atlas.x + 16}
          y={region.atlas.y + 52}
          fill="#9aa1b1"
          fontSize="13"
          pointerEvents="none"
        >
          Coming in a later phase
        </text>
      ) : null}
    </g>
  );
}

function MarkerButton({
  marker,
  region,
  selected,
  onSelect,
}: {
  marker: Marker;
  region: Region | undefined;
  selected: boolean;
  onSelect: (marker: Marker | null) => void;
}) {
  // A marker in a LOCKED region is unreachable however the marker itself is
  // authored: §7.3 forbids clicking through to unavailable content, and the
  // region is the thing that is unavailable.
  const locked =
    marker.availability !== 'AVAILABLE' ||
    (region !== undefined && region.availability !== 'AVAILABLE');
  const art = asset(marker.iconAssetId);
  return (
    <g transform={`translate(${marker.position.x} ${marker.position.y})`}>
      <foreignObject x="-70" y="-46" width="140" height="92">
        <button
          type="button"
          data-testid={`marker-${marker.key}`}
          aria-pressed={selected}
          disabled={locked}
          aria-disabled={locked || undefined}
          onClick={() => onSelect(marker)}
          style={{
            width: '140px',
            minHeight: '44px',
            background: selected ? art.stroke : art.fill,
            borderColor: art.stroke,
            color: '#fff',
            fontSize: '13px',
            lineHeight: 1.2,
            padding: '8px',
          }}
        >
          {marker.label}
        </button>
      </foreignObject>
    </g>
  );
}
