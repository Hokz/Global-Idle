'use client';

/**
 * The World Atlas (spec §7, V5-V7).
 *
 * Inline SVG, no map library: one region and a handful of markers do not need
 * a tile pyramid, and real DOM nodes give keyboard focus and accessible names
 * for free — both of which §15 requires and a canvas would lose.
 *
 * NOTHING essential is hover-only. Markers are <button>s: click, tap, or focus
 * and press Enter.
 */
import { useRef, useState } from 'react';
import type { Atlas as AtlasData, Marker, Region } from '../_lib/api';
import { asset } from '../_lib/assets';

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const CLAMP = { min: 0.5, max: 3 };
const clamp = (value: number) => Math.min(CLAMP.max, Math.max(CLAMP.min, value));

export function Atlas({
  data,
  selected,
  onSelect,
}: {
  data: AtlasData;
  selected: Marker | null;
  onSelect: (marker: Marker | null) => void;
}) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const pan = (dx: number, dy: number) => setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  const zoomBy = (factor: number) =>
    setCamera((c) => ({ ...c, zoom: clamp(Number((c.zoom * factor).toFixed(3))) }));

  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Atlas controls">
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>
          Reset view
        </button>
        <span className="muted small" data-testid="zoom">
          {Math.round(camera.zoom * 100)}%
        </span>
      </div>

      <svg
        className="atlas"
        data-testid="atlas"
        viewBox="0 0 1100 700"
        role="application"
        aria-label="World Atlas. Drag to pan, use the zoom buttons, or Tab to a marker."
        tabIndex={0}
        onKeyDown={(event) => {
          const step = 40;
          if (event.key === 'ArrowLeft') pan(step, 0);
          else if (event.key === 'ArrowRight') pan(-step, 0);
          else if (event.key === 'ArrowUp') pan(0, step);
          else if (event.key === 'ArrowDown') pan(0, -step);
          else if (event.key === '+' || event.key === '=') zoomBy(1.25);
          else if (event.key === '-') zoomBy(0.8);
          else if (event.key === 'Escape') onSelect(null);
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          // Only the BACKGROUND starts a pan. Capturing the pointer on a
          // marker press swallows the click that selects it — found by
          // driving the real browser, where the marker was visible and
          // clickable and the handler simply never ran.
          if ((event.target as Element).closest('button')) return;
          drag.current = { x: event.clientX, y: event.clientY, ox: camera.x, oy: camera.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setCamera((c) => ({
            ...c,
            x: start.ox + (event.clientX - start.x),
            y: start.oy + (event.clientY - start.y),
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          {data.regions.map((region) => (
            <RegionShape key={region.key} region={region} />
          ))}
          {data.markers.map((marker) => (
            <MarkerButton
              key={marker.key}
              marker={marker}
              selected={selected?.key === marker.key}
              onSelect={onSelect}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function RegionShape({ region }: { region: Region }) {
  const locked = region.availability !== 'AVAILABLE';
  const art = asset(region.backdropAssetId);
  return (
    <g aria-hidden="true" opacity={locked ? 0.45 : 1} data-testid={`region-${region.key}`}>
      <rect
        x={region.atlas.x}
        y={region.atlas.y}
        width={region.atlas.width}
        height={region.atlas.height}
        rx="14"
        fill={art.fill}
        stroke={art.stroke}
        strokeWidth="2"
        strokeDasharray={locked ? '8 6' : undefined}
      />
      <text
        x={region.atlas.x + 16}
        y={region.atlas.y + 30}
        fill="#e7e9ee"
        fontSize="18"
        fontWeight="600"
      >
        {region.label}
        {locked ? ' 🔒' : ''}
      </text>
      {locked ? (
        <text x={region.atlas.x + 16} y={region.atlas.y + 52} fill="#9aa1b1" fontSize="13">
          Coming in a later phase
        </text>
      ) : null}
    </g>
  );
}

function MarkerButton({
  marker,
  selected,
  onSelect,
}: {
  marker: Marker;
  selected: boolean;
  onSelect: (marker: Marker | null) => void;
}) {
  const locked = marker.availability !== 'AVAILABLE';
  const art = asset(marker.iconAssetId);
  return (
    <g transform={`translate(${marker.position.x} ${marker.position.y})`}>
      <foreignObject x="-70" y="-46" width="140" height="92">
        <button
          type="button"
          data-testid={`marker-${marker.key}`}
          aria-pressed={selected}
          disabled={locked}
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
