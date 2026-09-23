/**
 * Phase 3.7 §13 — PRV and FALL. Provenance, and what ships when it is absent.
 *
 * Two separate honesty claims, tested separately:
 *
 *  - PRV: a private client-derived sprite carries REAL source identity, a
 *    public placeholder carries NONE, and the 32/64 px cell distinction is
 *    handled rather than assumed (spec §3, §3.1);
 *  - FALL: with no private override — which is every public build, every CI
 *    run and almost every machine — the placeholder is used silently, and
 *    nothing is fetched from anywhere (spec §9).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRIVATE_ASSET_ROUTE,
  PRIVATE_SPRITES,
  PUBLIC_PALETTE,
  RAT_IDLE_BY_FACING,
  READS_AS_WALKABLE,
  privateSpriteUrl,
  spriteDrawBox,
  tileNoise,
  type SpriteKey,
} from '../../apps/web/app/_lib/sprites.js';

const ALL_KEYS: readonly SpriteKey[] = [
  'tile.cave.floor',
  'tile.cave.wall',
  'tile.cave.water',
  'tile.cave.sludge',
  'prop.stone',
  'prop.chest',
  'actor.character',
  'actor.rat',
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('§13 PRV — provenance, by kind of asset', () => {
  it('PRV1: every private reference carries real source identity', () => {
    // The five-link chain's identifying half. A filename is never the id, so
    // each entry states the appearance and the sprite the manifest gave.
    for (const [key, reference] of Object.entries(PRIVATE_SPRITES)) {
      expect(Number.isInteger(reference.appearanceId), key).toBe(true);
      expect(Number.isInteger(reference.spriteId), key).toBe(true);
      expect([32, 64], key).toContain(reference.cellPx);
      expect(['verified', 'candidate'], key).toContain(reference.role);
    }
    // The ids are the manifest's, not invented: rat outfit 21 → idle 3821,
    // and the two cave tiles are the appearances the ZIP actually names.
    expect(PRIVATE_SPRITES['actor.rat']).toMatchObject({ appearanceId: 21, spriteId: 3821 });
    expect(PRIVATE_SPRITES['tile.cave.floor']).toMatchObject({
      appearanceId: 44092,
      spriteId: 209404,
    });
  });

  it('PRV2: a PUBLIC placeholder carries no source id at all', () => {
    // The A2 correction. A placeholder is this project's own art; giving it an
    // `appearanceId` would invent a source record for something with no source.
    // The public side of the system is a palette and a semantic key, and that
    // is all it is.
    for (const key of ALL_KEYS) {
      expect(PUBLIC_PALETTE[key], key).toMatchObject({
        base: expect.stringMatching(/^#[0-9a-f]{6}$/),
      });
      expect(Object.keys(PUBLIC_PALETTE[key])).toEqual(['base', 'speck', 'edge']);
    }
    // Every meaning the scene can ask for has a public answer — that is what
    // makes a build with no private file complete rather than broken.
    expect(Object.keys(PUBLIC_PALETTE).sort()).toEqual([...ALL_KEYS].sort());
  });

  it('PRV3: a 64px cell is anchored BOTTOM-RIGHT, a 32px cell covers its tile', () => {
    // Getting this wrong puts every creature one tile down and to the right of
    // where the server says it is, which looks like a movement bug and is not.
    expect(spriteDrawBox(32, 32, 4, 5)).toEqual({ x: 128, y: 160, width: 32, height: 32 });
    expect(spriteDrawBox(64, 32, 4, 5)).toEqual({ x: 96, y: 128, width: 64, height: 64 });
    // The bottom-right corner is the SAME for both, which is the whole rule.
    for (const cell of [32, 64] as const) {
      const box = spriteDrawBox(cell, 32, 7, 3);
      expect(box.x + box.width, `cell ${cell}`).toBe(8 * 32);
      expect(box.y + box.height, `cell ${cell}`).toBe(4 * 32);
    }
  });

  it('PRV4: the private subset has NO cave wall, and says so by omission', () => {
    // Appearance 44110 is named "cave wall panel" and is three diagonal beam
    // pieces. The spike drew it and it bled outside the tile. A name is not a
    // role, so the key simply has no private answer and the placeholder wins
    // even in development.
    expect(PRIVATE_SPRITES['tile.cave.wall']).toBeUndefined();
    expect(privateSpriteUrl('tile.cave.wall')).toBeNull();
    // And the public placeholder for it exists, so a wall is still drawn.
    expect(PUBLIC_PALETTE['tile.cave.wall']).toBeDefined();
  });

  it('PRV5: a CANDIDATE is cosmetic — walkability comes from the tile kind', () => {
    // No `unpass`, no `blockPathFind` and no `bank.waypoints` for any of them,
    // so a sprite may decorate a tile and may never define one. The only thing
    // this table drives is how the tile READS to a player.
    const candidates = Object.entries(PRIVATE_SPRITES).filter(
      ([, reference]) => reference.role === 'candidate',
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const [key, reference] of candidates) {
      // The record carries no gameplay field whatsoever — not a speed, not a
      // collision flag. If one ever appears here, this fails.
      expect(Object.keys(reference).sort(), key).toEqual(
        ['appearanceId', 'cellPx', 'file', 'role', 'spriteId'].sort(),
      );
    }
    // Presentation legibility is a separate, clearly-named table.
    expect(READS_AS_WALKABLE['tile.cave.floor']).toBe(true);
    expect(READS_AS_WALKABLE['tile.cave.wall']).toBe(false);
  });

  it('PRV6: the rat has one idle frame per facing, from the source range', () => {
    // 4×1×1 patterns, frameGroup 0, sprites 3819–3822. The ORDER is an
    // assumption about pattern order and is cosmetic; the RANGE is the
    // manifest's and is not.
    const ids = Object.values(RAT_IDLE_BY_FACING);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(Math.min(...ids)).toBe(3819);
    expect(Math.max(...ids)).toBe(3822);
  });
});

describe('§13 FALL — what happens with no private asset present', () => {
  it('FALL1: a PRODUCTION build resolves no private sprite at all', () => {
    // The same build-time constant the loader gates on, so a release bundle
    // folds this to `null` and drops the URL string entirely.
    vi.stubEnv('NODE_ENV', 'production');
    for (const key of ALL_KEYS) {
      expect(privateSpriteUrl(key), key).toBeNull();
    }
  });

  it('FALL2: outside production a private URL is local and on the dev route', () => {
    // It still never leaves the machine: the route is same-origin and served
    // by the dev-only loader, so "no remote asset loading" holds in both
    // states rather than only in the one that ships.
    vi.stubEnv('NODE_ENV', 'development');
    const url = privateSpriteUrl('actor.rat');
    expect(url).toBe(`${PRIVATE_ASSET_ROUTE}/sprites/rat/sprite_3821.png`);
    expect(url?.startsWith('/')).toBe(true);
    expect(url).not.toMatch(/^https?:/);
  });

  it('FALL3: a key with no private answer degrades silently, not exceptionally', () => {
    // Absent is the ORDINARY case, so it must not be an error path. The caller
    // gets `null` and paints the placeholder; nothing throws and nothing logs.
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => privateSpriteUrl('tile.cave.wall')).not.toThrow();
    expect(privateSpriteUrl('tile.cave.wall')).toBeNull();
    expect(privateSpriteUrl('tile.cave.water')).toBeNull();
  });

  it('FALL4: the public placeholder is deterministic, so CI sees one picture', () => {
    // A placeholder that shimmered would make every screenshot comparison a
    // coin toss, and a floor that changed on reload would look like a bug.
    for (const [x, y] of [
      [0, 0],
      [3, 7],
      [14, 10],
    ] as const) {
      const first = tileNoise(x, y);
      expect(tileNoise(x, y)).toBe(first);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(1);
    }
    // And different tiles genuinely differ, or the mottling would be a flat fill.
    expect(tileNoise(1, 1)).not.toBe(tileNoise(2, 1));
  });
});
