'use client';

/**
 * The FOUR navigation surfaces (Phase 3.7 spec §4, §5, and
 * `docs/design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`).
 *
 *   WORLD ATLAS  →  REGIONAL MINI-ATLAS  →  LOCAL FOCUS  →  PLAYABLE HUNT
 *   macro, minimap-like  one region, detailed  a town      the Game Window
 *
 * Each level has ONE job and its own picture. The world names regions and
 * nothing smaller; the region shows where a region's places sit; the local
 * focus carries the town pins, one of which is a Hunt. They are deliberately
 * different rasters at different scales — two levels drawing the same art are
 * one level with two names, and a player cannot tell which they are on.
 *
 * NO AUTHORITY. This component owns which surface is on screen and nothing
 * else: it starts no Activity, stores no position and invents no content key.
 * Entering a Hunt is handed back to the caller, which asks the server, exactly
 * as the Phase 1 Atlas already did.
 *
 * EVERY PIN IS A DEMONSTRATION. No raster here carries a world origin or a
 * pixels-per-tile scale, so nothing on one can be a real coordinate;
 * `pinIsDemo` is true for all of them and the marking is not suppressible. The
 * one pin that means anything is the HUNT pin, and what it means is a CONTENT
 * KEY the server already knows — not a place on a map.
 */
import { useMemo, useState } from 'react';
import {
  CITY_RASTER_SIZE,
  RASTER_SIZE,
  REGION_RASTER_SIZE,
  paintAtlasRaster,
  paintCityRaster,
  paintRegionRaster,
} from '../_lib/atlas-raster';
import { syntheticCalibration, type AtlasPin } from '../_lib/atlas-view';
import { privateAtlasUrl } from '../_lib/sprites';
import { PixelAtlas } from './PixelAtlas';

/** The three atlas surfaces, outermost first. The Game Window is the fourth
 *  and belongs to the run, not to this component. */
type Level = 'world' | 'region' | 'local';

const LEVEL_ORDER: readonly Level[] = ['world', 'region', 'local'];

/**
 * SYNTHETIC calibrations, and they say so in their own value.
 *
 * Rookgaard-shaped and invented. They make the transform exercisable;
 * `sourced: false` is what keeps every pin marked `demo`. Real calibration and
 * region polygons are a Phase 9 concern, gated on source data that does not
 * exist yet — see the design document named above.
 */
const WORLD_CALIBRATION = syntheticCalibration(31_000, 31_000, 1);
const REGION_CALIBRATION = syntheticCalibration(32_000, 31_900, 4);
const LOCAL_CALIBRATION = syntheticCalibration(32_060, 31_950, 8);

/**
 * World pins are REGIONS. Nothing smaller appears at this scale — that is what
 * makes this surface macro rather than a zoomed-in town.
 *
 * The mainland is present and LOCKED: the world has more in it than Phase 3.7
 * implements, and drawing only the one reachable place would teach a player a
 * world with one island in it. Locked is visible, announced and inert.
 */
const WORLD_PINS: readonly AtlasPin[] = [
  { id: 'rookgaard', kind: 'CITY', label: 'Rookgaard', rasterX: 168, rasterY: 214 },
  {
    id: 'mainland',
    kind: 'CITY',
    label: 'Mainland',
    rasterX: 340,
    rasterY: 150,
    locked: true,
    reason: 'The mainland regions arrive with the Phase 9 content rollout.',
  },
];

/** Region pins are PLACES INSIDE ONE REGION: a town, and what is not built. */
const REGION_PINS: readonly AtlasPin[] = [
  { id: 'rookgaard-town', kind: 'CITY', label: 'Rookgaard Town', rasterX: 192, rasterY: 192 },
  {
    id: 'academy',
    kind: 'QUEST',
    label: 'Academy',
    rasterX: 268,
    rasterY: 120,
    locked: true,
    reason: 'No Activity exists here yet.',
  },
];

/**
 * Local pins are the town's own places.
 *
 * `contentKey` appears on the Hunt pin ONLY, and it is the key the shipped
 * bundle actually carries. The others are labels on a placeholder drawing:
 * there is no verified Temple or shop coordinate in the supplied reference, so
 * claiming one would be inventing geography (spec §5).
 */
const LOCAL_PINS: readonly AtlasPin[] = [
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
  const [level, setLevel] = useState<Level>('world');
  const [blocked, setBlocked] = useState<string | null>(null);

  // Painted once each. Deterministic, so every machine sees one picture.
  const worldRaster = useMemo(() => paintAtlasRaster(), []);
  const regionRaster = useMemo(() => paintRegionRaster(), []);
  const localRaster = useMemo(() => paintCityRaster(), []);

  const go = (next: Level) => {
    setBlocked(null);
    setLevel(next);
  };

  /** A locked pin explains itself rather than doing nothing silently. */
  const refuse = (pin: AtlasPin) => setBlocked(pin.reason ?? `${pin.label} is not available yet.`);

  const crumbs: readonly { level: Level; label: string }[] = [
    { level: 'world', label: 'World' },
    { level: 'region', label: 'Rookgaard Region' },
    { level: 'local', label: 'Rookgaard Town' },
  ];
  const depth = LEVEL_ORDER.indexOf(level);

  return (
    <div className="atlas-stack" data-testid="rookgaard-atlas" data-level={level} data-view={level}>
      <nav className="atlas-stack__crumbs" aria-label="Atlas navigation">
        {crumbs.slice(0, depth + 1).map((crumb, index) => (
          <span key={crumb.level} className="atlas-stack__crumb">
            {index > 0 ? <span aria-hidden="true">›</span> : null}
            <button
              type="button"
              onClick={() => go(crumb.level)}
              disabled={crumb.level === level}
              data-testid={`atlas-breadcrumb-${crumb.level}`}
            >
              {crumb.label}
            </button>
          </span>
        ))}
        <span className="atlas-stack__crumb-current" data-testid="atlas-breadcrumb-current">
          {crumbs[depth]!.label}
        </span>
      </nav>

      {depth > 0 ? (
        <button
          type="button"
          className="atlas-stack__back"
          onClick={() => go(LEVEL_ORDER[depth - 1]!)}
          data-testid="atlas-back"
        >
          ‹ Back to {crumbs[depth - 1]!.label}
        </button>
      ) : null}

      {level === 'world' ? (
        <PixelAtlas
          testId="world-atlas"
          title="World Atlas"
          raster={worldRaster}
          size={RASTER_SIZE}
          privateRaster={privateAtlasUrl('world')}
          calibration={WORLD_CALIBRATION}
          pins={WORLD_PINS}
          onPin={(pin) => (pin.locked ? refuse(pin) : go('region'))}
          caption={
            'MACRO overview — regions only, minimap-like. Placeholder art drawn by this project. ' +
            'Nearest-neighbour zoom over a single ' +
            `${RASTER_SIZE} × ${RASTER_SIZE} raster: a pixel preview, not a multi-resolution tile ` +
            'pyramid, because no source data at that resolution exists. Navigation only — this is ' +
            'not playable geometry, and no coastline here is real geography.'
          }
        />
      ) : level === 'region' ? (
        <PixelAtlas
          testId="region-atlas"
          title="Rookgaard Region"
          raster={regionRaster}
          size={REGION_RASTER_SIZE}
          privateRaster={privateAtlasUrl('region')}
          calibration={REGION_CALIBRATION}
          pins={REGION_PINS}
          onPin={(pin) => (pin.locked ? refuse(pin) : go('local'))}
          caption={
            'REGIONAL view — one region at readable detail, showing where its places sit. ' +
            'Placeholder art drawn by this project. Every position is a DEMO: the supplied ' +
            'reference carries no world origin and no pixels-per-tile scale, so no coastline, ' +
            'road or settlement here is verified. Region boundaries and the selection highlight ' +
            'arrive with real geometry in a later phase; none is invented here.'
          }
        />
      ) : (
        <>
          <PixelAtlas
            testId="local-atlas"
            title="Rookgaard Town"
            raster={localRaster}
            size={CITY_RASTER_SIZE}
            privateRaster={privateAtlasUrl('local')}
            calibration={LOCAL_CALIBRATION}
            pins={LOCAL_PINS}
            onPin={(pin) => {
              if (pin.locked) return refuse(pin);
              if (pin.contentKey && !busy) onEnterHunt(pin.contentKey);
            }}
            caption={
              'LOCAL focus — one town, its own pins. Placeholder town plan drawn by this ' +
              'project. Every position is a DEMO: no Temple, shop or NPC coordinate here is ' +
              'verified. Only the Hunt pin means anything, and what it means is a content key ' +
              'the server already has.'
            }
          />
          <p className="atlas-stack__hint">
            Choose <strong>Rookgaard Sewers</strong> to enter the Hunt.
          </p>
        </>
      )}

      {blocked ? (
        <p className="atlas-stack__blocked small" role="status" data-testid="atlas-locked-notice">
          {blocked}
        </p>
      ) : null}
    </div>
  );
}
