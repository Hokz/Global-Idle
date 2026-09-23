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
  FACING_ORDER,
  PRIVATE_ASSET_ROUTE,
  PRIVATE_MAP_REFERENCES,
  PRIVATE_SPRITES,
  PUBLIC_PALETTE,
  RAT_IDLE_BY_FACING,
  RAT_WALK_PHASES,
  READS_AS_WALKABLE,
  facingFromDelta,
  privateAtlasUrl,
  privateSpriteUrl,
  ratFrameUrl,
  ratIdleSpriteId,
  ratWalkSpriteId,
  spriteDrawBox,
  tileNoise,
  walkPhase,
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
  it('PRV1: every private reference resolves the WHOLE five-link chain', () => {
    // Independent review's blocker: the previous record stored an appearance
    // id, a sprite id and a cell size, and PRV1 checked that those were
    // numbers. That is two links of five. A provenance record has to say which
    // BYTES a sprite id resolves to, or it cannot be audited against anything.
    //
    //   appearanceId → frameGroup + pattern → spriteId → source sheet → PNG
    for (const [key, reference] of Object.entries(PRIVATE_SPRITES)) {
      // 1 — the appearance, and what kind of thing it is
      expect(Number.isInteger(reference.appearanceId), key).toBe(true);
      expect(['outfit', 'object'], key).toContain(reference.appearanceClass);
      // 2 — the frame group and its pattern geometry, verbatim
      expect(Number.isInteger(reference.frameGroup), key).toBe(true);
      for (const axis of ['width', 'height', 'depth', 'layers'] as const) {
        expect(reference.pattern[axis], `${key}.pattern.${axis}`).toBeGreaterThan(0);
      }
      // 3 — the sprite
      expect(Number.isInteger(reference.spriteId), key).toBe(true);
      // 4 — the sheet those bytes came from, by name, origin id and type
      expect(reference.source.sheet, key).toMatch(/^sprites-[0-9a-f]{64}\.bmp\.lzma$/);
      expect(reference.source.firstSpriteId, key).toBeLessThanOrEqual(reference.spriteId);
      expect(Number.isInteger(reference.source.sheetType), key).toBe(true);
      // 5 — the extracted file, named for the sprite it holds
      expect(reference.file, key).toContain(`sprite_${reference.spriteId}.png`);
      // …and the honesty fields
      expect([32, 64], key).toContain(reference.cellPx);
      expect(['verified', 'candidate'], key).toContain(reference.role);
      expect(Array.isArray(reference.gaps), key).toBe(true);
    }
    // The ids are the manifest's, not invented.
    expect(PRIVATE_SPRITES['actor.rat']).toMatchObject({
      appearanceId: 21,
      frameGroup: 0,
      spriteId: 3819,
      source: { firstSpriteId: 3791, sheetType: 3 },
    });
    expect(PRIVATE_SPRITES['tile.cave.floor']).toMatchObject({
      appearanceId: 44092,
      spriteId: 209404,
      source: { firstSpriteId: 209269, sheetType: 0 },
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
      // collision flag. An exhaustive key list rather than a deny-list, so
      // ANY new field fails this until someone looks at it.
      expect(Object.keys(reference).sort(), key).toEqual(
        [
          'appearanceClass',
          'appearanceId',
          'cellPx',
          'file',
          'frameGroup',
          'gaps',
          'pattern',
          'role',
          'source',
          'spriteId',
        ].sort(),
      );
      // …and the provenance sub-records are provenance only.
      expect(Object.keys(reference.source).sort(), key).toEqual(
        ['firstSpriteId', 'sheet', 'sheetType'].sort(),
      );
      expect(Object.keys(reference.pattern).sort(), key).toEqual(
        ['boundingSquare', 'depth', 'height', 'layers', 'width'].sort(),
      );
    }
    // Presentation legibility is a separate, clearly-named table.
    expect(READS_AS_WALKABLE['tile.cave.floor']).toBe(true);
    expect(READS_AS_WALKABLE['tile.cave.wall']).toBe(false);
  });

  it('PRV6: the rat has one idle frame per facing, DERIVED from the pattern', () => {
    // 4×1×1 pattern, one layer, frameGroup 0, sprites 3819–3822. The map is
    // computed from the arithmetic the renderer uses, so it cannot drift from
    // it. The ORDER is an assumption about pattern order and is cosmetic and
    // declared as a gap; the RANGE is the manifest's and is not.
    const ids = Object.values(RAT_IDLE_BY_FACING);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(Math.min(...ids)).toBe(3819);
    expect(Math.max(...ids)).toBe(3822);
    expect(PRIVATE_SPRITES['actor.rat']?.gaps.join(' ')).toMatch(/ORDER/);
  });

  it('PRV7: the citizen declares a PARTIAL extraction rather than implying a whole one', () => {
    // The private reference says outfit 128 is a base-layer reference only.
    // Pattern 4×3×2 with 2 layers is 48 cells per group; 8 frames exist. A
    // direction mapping is therefore NOT derivable, and the record says so
    // instead of leaving a plausible-looking outfit entry that implies it is.
    const citizen = PRIVATE_SPRITES['actor.character'];
    expect(citizen).toBeDefined();
    expect(citizen!.pattern).toMatchObject({ width: 4, height: 3, depth: 2, layers: 2 });
    expect(citizen!.pattern.layers).toBeGreaterThan(1);
    const gaps = citizen!.gaps.join(' ');
    expect(gaps).toMatch(/PARTIAL BASE LAYER/);
    expect(gaps).toMatch(/not derivable/i);
    expect(gaps).toMatch(/addon/i);
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
    // The rat's record names frameGroup 0's first frame; per-facing selection
    // is `ratFrameUrl`'s job and has its own cases (FRM).
    const url = privateSpriteUrl('actor.rat');
    expect(url).toBe(`${PRIVATE_ASSET_ROUTE}/sprites/rat/sprite_3819.png`);
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

describe('§13 FRM — the frame the RENDERER actually selects', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('FRM1: idle ids are computed, and reproduce the manifest range exactly', () => {
    // Not "the constant contains four numbers" — the arithmetic the renderer
    // runs, checked against the range the source declares.
    expect(FACING_ORDER.map(ratIdleSpriteId)).toEqual([3819, 3820, 3821, 3822]);
  });

  it("FRM2: walking ids cover the manifest's 32 frames, once each", () => {
    // 32 frames over a pattern width of 4 is 8 phases. If the layout were
    // direction-major instead of phase-major the SET would still be 3823-3854,
    // so this also pins that every (facing, phase) pair is distinct — which is
    // what stops two directions sharing one picture.
    const ids = new Set<number>();
    for (let phase = 0; phase < RAT_WALK_PHASES; phase += 1) {
      for (const facing of FACING_ORDER) ids.add(ratWalkSpriteId(facing, phase));
    }
    expect(ids.size).toBe(32);
    expect(Math.min(...ids)).toBe(3823);
    expect(Math.max(...ids)).toBe(3854);
    // The phase wraps rather than running off the end of the sheet.
    expect(ratWalkSpriteId('north', RAT_WALK_PHASES)).toBe(ratWalkSpriteId('north', 0));
    expect(ratWalkSpriteId('north', -1)).toBe(ratWalkSpriteId('north', RAT_WALK_PHASES - 1));
  });

  it("FRM3: facing comes from the SERVER's leg, and a diagonal picks its dominant axis", () => {
    expect(facingFromDelta(1, 0)).toBe('east');
    expect(facingFromDelta(-1, 0)).toBe('west');
    expect(facingFromDelta(0, 1)).toBe('south');
    expect(facingFromDelta(0, -1)).toBe('north');
    // Eight-direction movement is real, four sprite slots are all the source
    // supplies, so a diagonal resolves rather than flickering between two.
    expect(facingFromDelta(1, -1)).toBe('east');
    expect(facingFromDelta(-1, 1)).toBe('west');
    // Standing still keeps the pose it was given: a creature that snapped back
    // to one direction every time it stopped would look like a bug.
    expect(facingFromDelta(0, 0, 'west')).toBe('west');
  });

  it('FRM4: the animation phase is read off the authoritative timestamps', () => {
    // Presentation derived from authority. A 1000 ms leg over 8 phases puts
    // the boundary every 125 ms, so a SLOW step animates slowly — without the
    // client owning a clock anything durable depends on.
    expect(walkPhase(1000, 2000, 1000)).toBe(0);
    expect(walkPhase(1000, 2000, 1125)).toBe(1);
    expect(walkPhase(1000, 2000, 1999)).toBe(7);
    // Outside the leg there is no phase at all — the caller draws idle.
    expect(walkPhase(1000, 2000, 999)).toBeNull();
    expect(walkPhase(1000, 2000, 2000)).toBeNull();
    // A zero-length or inverted leg is not a division to attempt.
    expect(walkPhase(1000, 1000, 1000)).toBeNull();
    expect(walkPhase(2000, 1000, 1500)).toBeNull();
  });

  it('FRM5: in DEVELOPMENT the selected frame is a real per-facing file', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(ratFrameUrl('north', null)).toBe(`${PRIVATE_ASSET_ROUTE}/sprites/rat/sprite_3819.png`);
    expect(ratFrameUrl('west', null)).toBe(`${PRIVATE_ASSET_ROUTE}/sprites/rat/sprite_3822.png`);
    // Walking selects from the walking group, never the idle one.
    expect(ratFrameUrl('north', 0)).toBe(`${PRIVATE_ASSET_ROUTE}/sprites/rat/sprite_3823.png`);
    expect(ratFrameUrl('east', 3)).toBe(`${PRIVATE_ASSET_ROUTE}/sprites/rat/sprite_3836.png`);
    // Two different facings never resolve to the same picture.
    expect(ratFrameUrl('north', 2)).not.toBe(ratFrameUrl('south', 2));
  });

  it('FRM7: the atlas surfaces draw a private map reference only in DEVELOPMENT', () => {
    // The map references are wired the same way the sprites are, through the
    // one dev-only loader — so "private art appears in the Atlas" is a real
    // development behaviour rather than a claim, and a public build still
    // paints the procedural placeholder and requests nothing.
    vi.stubEnv('NODE_ENV', 'development');
    expect(privateAtlasUrl('world')).toBe(`${PRIVATE_ASSET_ROUTE}/${PRIVATE_MAP_REFERENCES.world}`);
    expect(privateAtlasUrl('region')).toBe(
      `${PRIVATE_ASSET_ROUTE}/${PRIVATE_MAP_REFERENCES.region}`,
    );
    // The reference carries NO town-scale image. Cropping the minimap to fake
    // one would manufacture detail the source does not contain.
    expect(PRIVATE_MAP_REFERENCES.local).toBeUndefined();
    expect(privateAtlasUrl('local')).toBeNull();

    vi.stubEnv('NODE_ENV', 'production');
    for (const surface of ['world', 'region', 'local'] as const) {
      expect(privateAtlasUrl(surface), surface).toBeNull();
    }
  });

  it('FRM6: a PRODUCTION build selects no frame at all', () => {
    // The same fold as every other private path: no URL, so no request, so the
    // placeholder is the only thing a public build can draw.
    vi.stubEnv('NODE_ENV', 'production');
    for (const facing of FACING_ORDER) {
      expect(ratFrameUrl(facing, null)).toBeNull();
      expect(ratFrameUrl(facing, 4)).toBeNull();
    }
  });
});
