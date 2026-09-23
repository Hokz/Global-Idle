'use client';

/**
 * World Atlas → Rookgaard city → a Hunt (Phase 3.7 spec §4, §5).
 *
 * Three surfaces, one navigation path, and NO authority. This component owns
 * which view is on screen and nothing else: it starts no Activity, stores no
 * position and invents no content key. Entering a Hunt is handed back to the
 * caller, which asks the server, exactly as the Phase 1 Atlas already did.
 *
 * EVERY PIN HERE IS A DEMONSTRATION. The reference rasters carry no world
 * origin and no pixels-per-tile scale, so nothing on them can be a real
 * coordinate; `pinIsDemo` is true for all of them and the marking is not
 * suppressible. The one pin that means something is the HUNT pin, and what it
 * means is a CONTENT KEY the server already knows — not a place on a map.
 */
import { useMemo, useState } from 'react';
import {
  CITY_RASTER_SIZE,
  RASTER_SIZE,
  paintAtlasRaster,
  paintCityRaster,
} from '../_lib/atlas-raster';
import { syntheticCalibration, type AtlasPin } from '../_lib/atlas-view';
import { PixelAtlas } from './PixelAtlas';

/**
 * A SYNTHETIC calibration, and it says so in its own value.
 *
 * The numbers are Rookgaard-shaped and invented. They make the transform
 * exercisable; `sourced: false` is what keeps every pin marked `demo`.
 */
const WORLD_CALIBRATION = syntheticCalibration(32_000, 31_900, 2);
const CITY_CALIBRATION = syntheticCalibration(32_060, 31_950, 8);

const WORLD_PINS: readonly AtlasPin[] = [
  { id: 'rookgaard', kind: 'CITY', label: 'Rookgaard', rasterX: 256, rasterY: 250 },
];

/**
 * The city pins.
 *
 * `contentKey` appears on the Hunt pin only, and it is the key the shipped
 * bundle actually carries. The others are labels on a placeholder drawing:
 * there is no verified Temple or shop coordinate in the supplied reference,
 * so claiming one would be inventing geography (spec §5).
 */
const CITY_PINS: readonly AtlasPin[] = [
  { id: 'temple', kind: 'CITY', label: 'Temple', rasterX: 128, rasterY: 96 },
  { id: 'shop', kind: 'SHOP', label: 'Shop', rasterX: 52, rasterY: 168 },
  { id: 'trainer', kind: 'NPC', label: 'Trainer', rasterX: 178, rasterY: 44 },
  { id: 'quest', kind: 'QUEST', label: 'Quest', rasterX: 180, rasterY: 172 },
  {
    id: 'sewers',
    kind: 'HUNT',
    label: 'Rookgaard Sewers',
    rasterX: 116,
    rasterY: 186,
    contentKey: 'hunt.rookgaard.sewers',
  },
];

export interface RookgaardAtlasProps {
  /** Enter a Hunt by its CONTENT KEY. The caller asks the server; this
   *  component never starts anything itself. */
  readonly onEnterHunt: (contentKey: string) => void;
  /** Whether the caller is mid-request, so the surface can say so. */
  readonly busy?: boolean;
}

export function RookgaardAtlas({ onEnterHunt, busy = false }: RookgaardAtlasProps) {
  const [view, setView] = useState<'world' | 'city'>('world');
  // Painted once. Deterministic, so it is the same picture on every machine.
  const worldRaster = useMemo(() => paintAtlasRaster(), []);
  const cityRaster = useMemo(() => paintCityRaster(), []);

  return (
    <div className="atlas-stack" data-testid="rookgaard-atlas" data-view={view}>
      <nav className="atlas-stack__crumbs" aria-label="Atlas navigation">
        <button
          type="button"
          onClick={() => setView('world')}
          disabled={view === 'world'}
          data-testid="atlas-breadcrumb-world"
        >
          World
        </button>
        <span aria-hidden="true">›</span>
        <span data-testid="atlas-breadcrumb-current">
          {view === 'world' ? 'Choose a region' : 'Rookgaard'}
        </span>
      </nav>

      {view === 'world' ? (
        <PixelAtlas
          testId="world-atlas"
          title="World Atlas"
          raster={worldRaster}
          size={RASTER_SIZE}
          calibration={WORLD_CALIBRATION}
          pins={WORLD_PINS}
          onPin={(pin) => {
            if (pin.id === 'rookgaard') setView('city');
          }}
          caption={
            'Placeholder art, drawn by this project. Nearest-neighbour zoom over a single ' +
            `${RASTER_SIZE} × ${RASTER_SIZE} raster — a pixel preview, not a multi-resolution tile ` +
            'pyramid, because no source data at that resolution exists. Navigation only: this is ' +
            'not playable geometry.'
          }
        />
      ) : (
        <>
          <PixelAtlas
            testId="city-atlas"
            title="Rookgaard"
            raster={cityRaster}
            size={CITY_RASTER_SIZE}
            calibration={CITY_CALIBRATION}
            pins={CITY_PINS}
            onPin={(pin) => {
              if (pin.contentKey && !busy) onEnterHunt(pin.contentKey);
            }}
            caption={
              'Placeholder town plan, drawn by this project. Every position is a DEMO: the ' +
              'supplied reference carries no world origin and no pixels-per-tile scale, so no ' +
              'Temple, shop or NPC coordinate here is verified. Only the Hunt pin means anything, ' +
              'and what it means is a content key the server already has.'
            }
          />
          <p className="atlas-stack__hint">
            Choose <strong>Rookgaard Sewers</strong> to enter the Hunt.
          </p>
        </>
      )}
    </div>
  );
}
