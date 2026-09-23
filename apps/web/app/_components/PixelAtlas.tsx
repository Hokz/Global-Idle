'use client';

/**
 * The pixel atlas: a raster, a viewport and typed pins (Phase 3.7 spec §4).
 *
 * A VIEWER, not a map server. It magnifies one raster with nearest-neighbour
 * scaling and draws pins at raster coordinates. It is deliberately NOT a
 * multi-resolution tile pyramid, and the caption says so, because a pyramid
 * would need source data at that resolution and none was supplied.
 *
 * It holds a viewport — zoom and pan — and nothing else. No durable state, no
 * content, no server call. Every pin it is handed comes from its caller, and
 * any pin whose position is not calibrated against real source data renders
 * with a visible DEMO marking that the component will not let the caller
 * suppress (spec §4, §5).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDENTITY_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  pinIsDemo,
  zoomAbout,
  type AtlasPin,
  type Calibration,
  type Viewport,
} from '../_lib/atlas-view';

export interface PixelAtlasProps {
  /** A painted RGBA buffer, square, `size` on a side. */
  readonly raster: Uint8ClampedArray;
  readonly size: number;
  readonly calibration: Calibration;
  readonly pins: readonly AtlasPin[];
  readonly onPin?: (pin: AtlasPin) => void;
  readonly caption: string;
  readonly testId: string;
  /** Shown above the surface, so the viewer knows what they are looking at. */
  readonly title: string;
}

const PIN_COLOUR: Readonly<Record<AtlasPin['kind'], string>> = {
  CITY: '#e8c37a',
  HUNT: '#7fd39b',
  NPC: '#9fd0ff',
  SHOP: '#d3a0ff',
  QUEST: '#ffb27f',
};

export function PixelAtlas({
  raster,
  size,
  calibration,
  pins,
  onPin,
  caption,
  testId,
  title,
}: PixelAtlasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [box, setBox] = useState({ width: 480, height: 320 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Resize and DPR move the PAN, never a world coordinate (spec §4). The
  // observer exists so a rotated phone does not reveal emptiness past the
  // raster edge, and so nothing about the window can change where a pin is.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setView((current) => clampPan(current, size, size, box.width, box.height));
  }, [box.width, box.height, size]);

  // Paint the raster once per raster change, at its own resolution. The
  // magnification is CSS, with `image-rendering: pixelated`, so a zoom is a
  // nearest-neighbour blow-up of real pixels rather than a resample.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    // `Uint8ClampedArray<ArrayBufferLike>` is not assignable to `ImageDataArray`
    // in TS 6 because a SharedArrayBuffer-backed view would not be valid here.
    // The buffer is our own, painted above, so the narrowing is safe and the
    // copy keeps it that way.
    const data = new Uint8ClampedArray(raster);
    context.putImageData(new ImageData(data, size, size), 0, 0);
  }, [raster, size]);

  const zoomBy = useCallback(
    (delta: number, anchor?: { x: number; y: number }) => {
      setView((current) => {
        const at = anchor ?? { x: box.width / 2, y: box.height / 2 };
        const next = zoomAbout(at, current.zoom + delta, current);
        return clampPan(next, size, size, box.width, box.height);
      });
    },
    [box.width, box.height, size],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      setView((current) =>
        clampPan(
          { ...current, panX: current.panX + dx, panY: current.panY + dy },
          size,
          size,
          box.width,
          box.height,
        ),
      );
    },
    [box.width, box.height, size],
  );

  return (
    <section className="atlas-surface" data-testid={testId}>
      <header className="atlas-surface__head">
        <h2>{title}</h2>
        <div className="atlas-surface__zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            onClick={() => zoomBy(-1)}
            disabled={view.zoom <= MIN_ZOOM}
            aria-label="Zoom out"
            data-testid={`${testId}-zoom-out`}
          >
            −
          </button>
          <span data-testid={`${testId}-zoom`}>{view.zoom}×</span>
          <button
            type="button"
            onClick={() => zoomBy(1)}
            disabled={view.zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            data-testid={`${testId}-zoom-in`}
          >
            +
          </button>
        </div>
      </header>

      <div
        className="atlas-surface__frame"
        ref={frameRef}
        data-testid={`${testId}-frame`}
        // The viewport, observable. Pan is the only thing a gesture changes,
        // and a test that cannot read it can only assert that a canvas exists.
        data-pan={`${Math.round(view.panX)},${Math.round(view.panY)}`}
        tabIndex={0}
        role="application"
        aria-label={`${title}. Arrow keys pan, plus and minus zoom.`}
        onKeyDown={(event) => {
          const step = 24 / view.zoom;
          if (event.key === 'ArrowLeft') panBy(-step, 0);
          else if (event.key === 'ArrowRight') panBy(step, 0);
          else if (event.key === 'ArrowUp') panBy(0, -step);
          else if (event.key === 'ArrowDown') panBy(0, step);
          else if (event.key === '+' || event.key === '=') zoomBy(1);
          else if (event.key === '-') zoomBy(-1);
          else return;
          event.preventDefault();
        }}
        onWheel={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          zoomBy(event.deltaY < 0 ? 1 : -1, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        }}
        onPointerDown={(event) => {
          // A PIN IS A CONTROL, NOT THE MAP. Capturing the pointer for a drag
          // redirects the whole gesture — including the `click` — to the frame,
          // so a captured press on a pin silently does nothing. Measured: the
          // first version of this captured unconditionally and the Rookgaard
          // pin was unclickable, with a mouse and with a finger alike.
          if ((event.target as HTMLElement).closest('.atlas-pin')) return;
          // One pointer drags, which is the same gesture with a mouse and with
          // a finger — no separate touch path to drift out of step.
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            panX: view.panX,
            panY: view.panY,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          setView((current) =>
            clampPan(
              {
                ...current,
                panX: drag.panX - (event.clientX - drag.x) / current.zoom,
                panY: drag.panY - (event.clientY - drag.y) / current.zoom,
              },
              size,
              size,
              box.width,
              box.height,
            ),
          );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <div
          className="atlas-surface__world"
          style={{
            width: size,
            height: size,
            transform: `scale(${view.zoom}) translate(${-view.panX}px, ${-view.panY}px)`,
          }}
        >
          <canvas ref={canvasRef} width={size} height={size} className="atlas-surface__canvas" />
          {pins.map((pin) => {
            const demo = pinIsDemo(pin, calibration);
            return (
              <button
                key={pin.id}
                type="button"
                className="atlas-pin"
                data-testid="atlas-pin"
                data-kind={pin.kind}
                data-demo={demo ? 'true' : 'false'}
                style={{
                  left: pin.rasterX,
                  top: pin.rasterY,
                  // Pins keep their size as the raster magnifies, so a pin is
                  // a marker rather than a growing blob.
                  transform: `translate(-50%, -100%) scale(${1 / view.zoom})`,
                }}
                onClick={() => onPin?.(pin)}
                aria-label={`${pin.label}${demo ? ' (demo position)' : ''}`}
              >
                <span className="atlas-pin__dot" style={{ background: PIN_COLOUR[pin.kind] }} />
                <span className="atlas-pin__label">
                  {pin.label}
                  {demo ? <em className="atlas-pin__demo">demo</em> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="atlas-surface__caption" data-testid={`${testId}-caption`}>
        {caption}
      </p>
    </section>
  );
}
