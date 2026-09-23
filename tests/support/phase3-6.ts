/**
 * Phase 3.6 — a corridor to measure movement in.
 *
 * The prototype Rookgaard Sewers has no sourced tile metadata yet (spec §12),
 * so nothing here touches it. These definitions are published BESIDE it, in
 * the test's own bundle, and exist only so a case can change one thing —
 * the ground, or the Character's level — and watch the Hunt's output move.
 */
import type { BundleSource } from '@global-idle/game-data';

export const LANE_MAP = 'map.test.lane';
export const LANE_HUNT = 'hunt.test.lane';

/** x = 1..40 of corridor, walls around it, the Character starting in the middle. */
const WIDTH = 42;
const FLOOR = WIDTH - 2;

/**
 * A corridor with a Rat at each end.
 *
 * One endless room with two spawn tiles, so every cycle puts one Rat at each
 * end and the Character has to cross the whole lane to finish it. Travel is
 * therefore a large share of the run, which is the only way a change in step
 * duration can show up as a change in OUTPUT rather than as a number in a
 * unit test.
 */
export function laneDefinitions(groundSpeed: number | undefined) {
  const ground = groundSpeed === undefined ? 'floor' : { kind: 'floor' as const, groundSpeed };
  return [
    {
      key: LANE_MAP,
      kind: 'map',
      references: [],
      label: 'Movement test lane',
      z: 7,
      rows: ['#'.repeat(WIDTH), `#${'.'.repeat(FLOOR)}#`, '#'.repeat(WIDTH)],
      legend: { '#': 'wall', '.': ground },
      entry: { x: 20, y: 1 },
      regions: [
        {
          id: 'lane',
          rect: [1, 1, FLOOR, 1],
          room: 1,
          spawns: [
            { x: 1, y: 1 },
            { x: FLOOR, y: 1 },
          ],
        },
      ],
      sourceRef:
        'Authored for Phase 3.6 movement tests. Not Canary geometry and not shipped content: a straight lane exists so travel time is measurable, nothing more.',
    },
    {
      key: LANE_HUNT,
      kind: 'hunt',
      references: ['character-baseline.origin', 'creature.rat', 'region.rookgaard', LANE_MAP],
      label: 'Movement test lane',
      region: 'region.rookgaard',
      summary: 'A corridor with a Rat at each end. Phase 3.6 movement measurement only.',
      primaryCreature: 'Rat',
      activityTypeKey: 'hunt',
      availability: 'AVAILABLE',
      characterBaseline: 'character-baseline.origin',
      map: LANE_MAP,
      rooms: [{ number: 1, creatures: [{ key: 'creature.rat', count: 2 }], endless: true }],
    },
  ];
}

/** Publish the authored content PLUS the lane, at one ground speed. */
export const withLane =
  (groundSpeed: number | undefined) =>
  (source: BundleSource): BundleSource => ({
    ...source,
    definitions: [
      ...source.definitions,
      ...laneDefinitions(groundSpeed),
    ] as BundleSource['definitions'],
  });
