/**
 * Semantic sprite keys, and what actually gets drawn for one (Phase 3.7 §3.1).
 *
 * THE RENDERER ASKS FOR A MEANING, NEVER A FILE. `tile.cave.floor` is the
 * contract; a public placeholder and a private client sprite are two possible
 * answers to it, and only one of them ever ships.
 *
 * Public placeholders are INDEPENDENTLY AUTHORED here — procedural pixel art,
 * a few lines of canvas each, drawn from a deterministic hash so the same tile
 * looks the same on every frame and after a reload. They have their own
 * provenance (this file, this project, this licence) and a semantic key. They
 * carry NO `appearanceId` and no `spriteId`, because inventing a source record
 * for art that has no source is the same lie as inventing a coordinate.
 *
 * A private override may replace one IN DEVELOPMENT ONLY, through the loader
 * at `app/_dev/private-asset/` — see spec §9.2. In a public build the override
 * does not exist, is not fetched, and is not referenced.
 */

/** Every meaning the scene can ask for. Adding one is a type error until it
 *  has a public painter, which is what keeps the public build complete. */
export type SpriteKey =
  | 'tile.cave.floor'
  | 'tile.cave.wall'
  | 'tile.cave.water'
  | 'tile.cave.sludge'
  | 'prop.stone'
  | 'prop.chest'
  | 'actor.character'
  | 'actor.rat';

export type Facing = 'north' | 'east' | 'south' | 'west';

/**
 * What the private subset COULD supply for a key, in development.
 *
 * Recorded as real source identity — `appearanceId` and `spriteId` — because
 * for these, unlike the placeholders, a real source record exists. `role` is
 * the honest part: `verified` means the source states what the thing IS;
 * `candidate` means only its NAME suggests it, and the manifest carries no
 * `unpass`, no `blockPathFind` and no `bank.waypoints` to confirm anything.
 *
 * A `candidate` is COSMETIC, always. Nothing here reaches collision or
 * `groundSpeed`; walkability stays with the authored tile kind and ground
 * speed keeps Phase 3.6's sourced 150 fallback (spec §6).
 */
export interface PrivateSpriteRef {
  readonly appearanceId: number;
  readonly spriteId: number;
  readonly cellPx: 32 | 64;
  readonly role: 'verified' | 'candidate';
  readonly file: string;
}

/**
 * The private reference subset, by meaning.
 *
 * `tile.cave.wall` is deliberately ABSENT. The subset contains no verified
 * cave wall: appearance 44110 is named "cave wall panel" and is three diagonal
 * beam pieces, not a wall (spec §11). A missing entry means the public
 * placeholder is used even in development, which is the honest answer.
 */
export const PRIVATE_SPRITES: Partial<Record<SpriteKey, PrivateSpriteRef>> = {
  'tile.cave.floor': {
    appearanceId: 44092,
    spriteId: 209404,
    cellPx: 32,
    role: 'candidate',
    file: 'sprites/cave_floor_earth_CANDIDATE/sprite_209404.png',
  },
  'prop.stone': {
    appearanceId: 1780,
    spriteId: 174063,
    cellPx: 32,
    role: 'candidate',
    file: 'sprites/stone_CANDIDATE/sprite_174063.png',
  },
  'prop.chest': {
    appearanceId: 44078,
    spriteId: 259492,
    cellPx: 64,
    role: 'candidate',
    file: 'sprites/cave_chest_CANDIDATE/sprite_259492.png',
  },
  'actor.rat': {
    appearanceId: 21,
    spriteId: 3821,
    cellPx: 64,
    role: 'verified',
    file: 'sprites/rat/sprite_3821.png',
  },
  'actor.character': {
    appearanceId: 128,
    spriteId: 5939,
    cellPx: 64,
    role: 'verified',
    file: 'sprites/citizen_base/sprite_5939.png',
  },
};

/**
 * The rat's four idle frames, one per facing.
 *
 * `patternWidth` is 4 and the source orders a creature's directions
 * north, east, south, west — so `3819 + index`. This mapping is an ASSUMPTION
 * about pattern order, not a statement the manifest makes, and it is cosmetic:
 * facing the wrong way is a wrong picture, never a wrong game.
 */
export const RAT_IDLE_BY_FACING: Readonly<Record<Facing, number>> = {
  north: 3819,
  east: 3820,
  south: 3821,
  west: 3822,
};

/** Where the dev loader serves a private file from. Never used in a public
 *  build: `privateSpriteUrl` returns null there and nothing requests it. */
export const PRIVATE_ASSET_ROUTE = '/dev-private-asset';

/**
 * The URL a private sprite would be at, or `null`.
 *
 * `null` in production, ALWAYS — and the check is the same build-time constant
 * the loader gates on, so a release bundle folds this to `null` and drops the
 * string entirely. A caller that gets `null` draws the public placeholder,
 * which is the only path CI and every public build ever take.
 */
export function privateSpriteUrl(key: SpriteKey): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const reference = PRIVATE_SPRITES[key];
  return reference ? `${PRIVATE_ASSET_ROUTE}/${reference.file}` : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public placeholders — independently authored, and the only thing that ships.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A stable value per tile, so a floor is mottled the same way every frame.
 *
 * The same trick Phase 3.5's scene already uses: not `Math.random`, because a
 * floor that shimmered every frame would be a bug you could see.
 */
export function tileNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export interface Palette {
  readonly base: string;
  readonly speck: string;
  readonly edge: string;
}

/**
 * The palette for each meaning. Cave-ish, readable, and WALKABILITY-LEGIBLE:
 * floors are warm and light, blocking tiles are cold and dark, because a
 * player has to be able to tell at a glance where the Character can go.
 */
export const PUBLIC_PALETTE: Readonly<Record<SpriteKey, Palette>> = {
  'tile.cave.floor': { base: '#6b5335', speck: '#7d6440', edge: '#5a4529' },
  'tile.cave.wall': { base: '#33373d', speck: '#3e444b', edge: '#23262a' },
  'tile.cave.water': { base: '#24415e', speck: '#2d5175', edge: '#1a3049' },
  'tile.cave.sludge': { base: '#4a5330', speck: '#58633a', edge: '#3a4126' },
  'prop.stone': { base: '#8c8f95', speck: '#a2a5ab', edge: '#6a6d73' },
  'prop.chest': { base: '#7a5326', speck: '#95682f', edge: '#523718' },
  'actor.character': { base: '#d9d2c4', speck: '#f0e9da', edge: '#3c3830' },
  'actor.rat': { base: '#6d5f52', speck: '#857567', edge: '#332c26' },
};

/** Does this meaning read as somewhere the Character can stand? Presentation
 *  only — the server's tile kind is what actually decides (spec §6). */
export const READS_AS_WALKABLE: Readonly<Record<SpriteKey, boolean>> = {
  'tile.cave.floor': true,
  'tile.cave.wall': false,
  'tile.cave.water': false,
  'tile.cave.sludge': true,
  'prop.stone': true,
  'prop.chest': true,
  'actor.character': true,
  'actor.rat': true,
};

/**
 * Where a sprite cell is drawn over its tile.
 *
 * A 32px cell covers its tile exactly. A 64px cell is anchored BOTTOM-RIGHT
 * over the same tile, which is the client's own arrangement: a tall creature
 * or a chest overhangs up and to the left, so the tile it occupies is the one
 * under its feet. Getting this wrong puts every large sprite one tile down and
 * to the right of where the server says the actor is.
 *
 * Returned in the caller's pixel units, so the Game Window and a test can use
 * the same function without either knowing the other's scale.
 */
export interface DrawBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function spriteDrawBox(
  cellPx: 32 | 64,
  tilePx: number,
  tileX: number,
  tileY: number,
): DrawBox {
  const scale = cellPx / 32;
  const size = tilePx * scale;
  return {
    x: tileX * tilePx - (size - tilePx),
    y: tileY * tilePx - (size - tilePx),
    width: size,
    height: size,
  };
}
