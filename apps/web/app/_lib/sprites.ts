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
 * A frame's place in the SOURCE SHEET it was cut from.
 *
 * The fourth link of the chain. `sheet` is the client archive's own filename,
 * `firstSpriteId` the id its first cell carries, and `sheetType` the archive's
 * type code. Together they say *which bytes on disk* a sprite id resolves to —
 * which is the difference between a provenance record and a pair of numbers.
 */
export interface SourceSheet {
  readonly sheet: string;
  readonly firstSpriteId: number;
  readonly sheetType: number;
}

/**
 * An appearance's frame-group geometry, verbatim from the manifest.
 *
 * `width` is the pattern's direction axis for a creature; `layers` above 1
 * means the appearance is composited from several images per cell and a single
 * extracted PNG is therefore NOT the whole picture. Recording it is what makes
 * an incomplete extraction visible instead of plausible.
 */
export interface PatternGeometry {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly layers: number;
  readonly boundingSquare: number | null;
}

/**
 * The FIVE-LINK provenance chain for one private reference (spec §3).
 *
 *   appearanceId → frameGroup + pattern → spriteId → source sheet → PNG
 *
 * Every link is recorded from `manifest/source_manifest.json` in the private
 * reference. Nothing here is inferred from a filename, and where the source
 * does not establish something, `gaps` names it rather than letting a
 * plausible guess harden into a fact.
 *
 * `role` is the honest half: `verified` means the source states what the thing
 * IS; `candidate` means only its NAME suggests it, and the manifest carries no
 * `unpass`, no `blockPathFind` and no `bank.waypoints` to confirm anything. A
 * `candidate` is COSMETIC, always — nothing here reaches collision or
 * `groundSpeed` (spec §6).
 */
export interface PrivateSpriteRef {
  readonly appearanceId: number;
  readonly appearanceClass: 'outfit' | 'object';
  readonly frameGroup: number;
  readonly pattern: PatternGeometry;
  readonly spriteId: number;
  readonly source: SourceSheet;
  readonly cellPx: 32 | 64;
  readonly role: 'verified' | 'candidate';
  readonly file: string;
  /** Named SOURCE GAPS. Empty means the chain resolves end to end. */
  readonly gaps: readonly string[];
}

/** The rat's frame groups, as the manifest numbers them. */
export const RAT_IDLE_GROUP = 0;
export const RAT_WALK_GROUP = 1;

/** First sprite id of each rat frame group, from the manifest. */
const RAT_IDLE_FIRST = 3819;
const RAT_WALK_FIRST = 3823;

/** 32 walking frames over a pattern width of 4 is 8 animation phases. */
export const RAT_WALK_PHASES = 8;

/** The rat's two frame groups, as the manifest declares them. */
const RAT_SHEET: SourceSheet = {
  sheet: 'sprites-e8edf4ecb0db5d9fd2658a75ef6e89a1975dc3a15705746f6b10d1fe9b957f89.bmp.lzma',
  firstSpriteId: 3791,
  sheetType: 3,
};
const RAT_PATTERN: PatternGeometry = {
  width: 4,
  height: 1,
  depth: 1,
  layers: 1,
  boundingSquare: 32,
};

/**
 * The private reference subset, by meaning.
 *
 * `tile.cave.wall` is deliberately ABSENT. The subset contains no verified cave
 * wall: appearance 44110 is named "cave wall panel", its pattern width is 3 and
 * its three frames are diagonal beam pieces, not a wall (spec §11). A missing
 * entry means the public placeholder is used even in development, which is the
 * honest answer.
 */
export const PRIVATE_SPRITES: Partial<Record<SpriteKey, PrivateSpriteRef>> = {
  'tile.cave.floor': {
    appearanceId: 44092,
    appearanceClass: 'object',
    frameGroup: 2,
    pattern: { width: 1, height: 1, depth: 1, layers: 1, boundingSquare: null },
    spriteId: 209404,
    source: {
      sheet: 'sprites-4357cb9851406400c84b834238fead4861b2c6a7de4f3b7878f0b99fbe7696dd.bmp.lzma',
      firstSpriteId: 209269,
      sheetType: 0,
    },
    cellPx: 32,
    role: 'candidate',
    file: 'sprites/cave_floor_earth_CANDIDATE/sprite_209404.png',
    gaps: ['no source metadata establishes this appearance as a walkable ground tile'],
  },
  'prop.stone': {
    appearanceId: 1780,
    appearanceClass: 'object',
    frameGroup: 2,
    pattern: { width: 1, height: 1, depth: 1, layers: 1, boundingSquare: null },
    spriteId: 174063,
    source: {
      sheet: 'sprites-4a2ec9db3fa3704a9d569596e8f3573f8990544930aeab5035f781b280536f21.bmp.lzma',
      firstSpriteId: 173989,
      sheetType: 0,
    },
    cellPx: 32,
    role: 'candidate',
    file: 'sprites/stone_CANDIDATE/sprite_174063.png',
    gaps: ['name only; no collision or waypoint metadata'],
  },
  'prop.chest': {
    appearanceId: 44078,
    appearanceClass: 'object',
    frameGroup: 2,
    pattern: { width: 1, height: 1, depth: 1, layers: 1, boundingSquare: 41 },
    spriteId: 259492,
    source: {
      sheet: 'sprites-858371531c6f8e6477a9b9e34be142d7b51151f591add01352e376b2b6613de0.bmp.lzma',
      firstSpriteId: 259486,
      sheetType: 3,
    },
    cellPx: 64,
    role: 'candidate',
    file: 'sprites/cave_chest_CANDIDATE/sprite_259492.png',
    gaps: ['name only; not established as an interactive container'],
  },
  'actor.rat': {
    appearanceId: 21,
    appearanceClass: 'outfit',
    frameGroup: RAT_IDLE_GROUP,
    pattern: RAT_PATTERN,
    spriteId: 3819,
    source: RAT_SHEET,
    cellPx: 64,
    role: 'verified',
    file: 'sprites/rat/sprite_3819.png',
    gaps: [
      'the ORDER of the four pattern-width slots (which index is north) is an assumption, not a manifest statement — cosmetic only',
    ],
  },
  'actor.character': {
    appearanceId: 128,
    appearanceClass: 'outfit',
    frameGroup: 1,
    pattern: { width: 4, height: 3, depth: 2, layers: 2, boundingSquare: 46 },
    spriteId: 5939,
    source: {
      sheet: 'sprites-b83cd9a58e52813845e70fa01e75018a2a578e8a250775b3841d5bbe63839c75.bmp.lzma',
      firstSpriteId: 5915,
      sheetType: 3,
    },
    cellPx: 64,
    role: 'verified',
    file: 'sprites/citizen_base/sprite_5939.png',
    gaps: [
      'PARTIAL BASE LAYER ONLY: pattern 4x3x2 with 2 layers is 48 cells per group, and 8 frames were extracted — a direction mapping is NOT derivable',
      'the second appearance layer, the colour/template masks and every addon are absent',
      'no complete outfit animation or colouring may be claimed from this reference',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Frame selection — derived from the pattern, not from a hand-written table
// ─────────────────────────────────────────────────────────────────────────────

/** The four pattern-width slots, in ASSUMED order. Cosmetic: facing the wrong
 *  way is a wrong picture, never a wrong game. Recorded as a gap above. */
export const FACING_ORDER: readonly Facing[] = ['north', 'east', 'south', 'west'];

/**
 * The rat's idle frame for a facing.
 *
 * Index arithmetic, not a lookup table: with `patternHeight`, `patternDepth`
 * and `layers` all 1, the only axis that varies is the pattern's width, so the
 * id is `first + directionIndex`. The manifest's four idle frames are
 * 3819-3822 and this reproduces exactly that range.
 */
export function ratIdleSpriteId(facing: Facing): number {
  return RAT_IDLE_FIRST + FACING_ORDER.indexOf(facing);
}

/**
 * The rat's walking frame for a facing and an animation phase.
 *
 * Same arithmetic one axis out: 32 frames laid out as phase-major over four
 * directions, so `first + phase * width + directionIndex`. The phase is
 * PRESENTATION — it is derived below from the authoritative leg's own clock and
 * changes nothing the server decided.
 */
export function ratWalkSpriteId(facing: Facing, phase: number): number {
  const wrapped = ((Math.floor(phase) % RAT_WALK_PHASES) + RAT_WALK_PHASES) % RAT_WALK_PHASES;
  return RAT_WALK_FIRST + wrapped * RAT_PATTERN.width + FACING_ORDER.indexOf(facing);
}

/** Kept for callers that want the idle range as a map. Derived, so it cannot
 *  drift from the arithmetic the renderer uses. */
export const RAT_IDLE_BY_FACING: Readonly<Record<Facing, number>> = {
  north: ratIdleSpriteId('north'),
  east: ratIdleSpriteId('east'),
  south: ratIdleSpriteId('south'),
  west: ratIdleSpriteId('west'),
};

/**
 * Which way an actor faces, from the step the SERVER authored.
 *
 * The leg is authoritative; this reads it. A diagonal resolves to its dominant
 * axis, and a stationary actor keeps the facing it was given, because a
 * creature that snapped north every time it stopped would look broken.
 */
export function facingFromDelta(dx: number, dy: number, fallback: Facing = 'south'): Facing {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

/**
 * The animation phase of a leg in flight, from the server's own timestamps.
 *
 * Presentation derived from authority: the phase is where `now` sits between
 * the leg's start and arrival, so a slow step animates slowly and a fast one
 * quickly WITHOUT the client owning a second clock. Outside a leg there is no
 * phase — the caller draws the idle frame.
 */
export function walkPhase(
  startAtMs: number,
  arrivesAtMs: number,
  nowMs: number,
  phases = RAT_WALK_PHASES,
): number | null {
  if (!(arrivesAtMs > startAtMs)) return null;
  if (nowMs < startAtMs || nowMs >= arrivesAtMs) return null;
  const progress = (nowMs - startAtMs) / (arrivesAtMs - startAtMs);
  return Math.min(phases - 1, Math.floor(progress * phases));
}

/**
 * The private file a rat frame lives in, or `null`.
 *
 * `null` in production always, exactly like `privateSpriteUrl`. The rat is the
 * ONE appearance whose direction mapping the manifest actually determines, so
 * it is the only one that gets per-frame selection; everything else draws one
 * static frame or its public placeholder.
 */
export function ratFrameUrl(facing: Facing, phase: number | null): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const id = phase === null ? ratIdleSpriteId(facing) : ratWalkSpriteId(facing, phase);
  return `${PRIVATE_ASSET_ROUTE}/sprites/rat/sprite_${id}.png`;
}

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

/** The three atlas surfaces that can carry a private map reference. */
export type AtlasSurface = 'world' | 'region' | 'local';

/**
 * The private MAP references, by surface, from `manifest.mapReferences`.
 *
 * The supplied reference carries a satellite view and a minimap of Rookgaard.
 * Neither is calibrated — there is no world origin and no pixels-per-tile
 * scale — so they are a PICTURE and never a coordinate system: every pin drawn
 * over one still renders `demo` (spec §4).
 *
 * `local` is deliberately absent. The reference has no town-scale image, and
 * inventing one by cropping the minimap would be manufacturing detail the
 * source does not contain. That surface uses its public placeholder even in
 * development, which is the honest answer.
 */
export const PRIVATE_MAP_REFERENCES: Readonly<Partial<Record<AtlasSurface, string>>> = {
  world: 'maps/rookgaard_satellite_reference.png',
  region: 'maps/rookgaard_minimap_reference.png',
};

/**
 * The private raster an atlas surface would draw, or `null`.
 *
 * `null` in production ALWAYS, by the same build-time fold as every other
 * private path, so a release bundle drops the string and requests nothing.
 */
export function privateAtlasUrl(surface: AtlasSurface): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const file = PRIVATE_MAP_REFERENCES[surface];
  return file ? `${PRIVATE_ASSET_ROUTE}/${file}` : null;
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
