/**
 * Space, as the simulation understands it (Phase 3.5 spec §2–§5).
 *
 * PURE. No clock, no database, no randomness. A tile map is compiled once from
 * authored rows into flat typed arrays, and every question a tick asks —
 * "is this walkable", "who is standing there", "which way to the Rat" — is an
 * array index or a bounded search over one.
 *
 * The coordinate is SEMANTIC, not pixels. `z` exists from the first map even
 * though the Sewers use one floor, because retrofitting a third axis into
 * saved positions, path costs and region membership is a migration and adding
 * it now is a field.
 */

export interface TilePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const samePosition = (a: TilePosition, b: TilePosition): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z;

/** Orthogonal distance. Phase 3.5 has no diagonal movement — see `STEPS`. */
export const manhattan = (a: TilePosition, b: TilePosition): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) * 64;

/**
 * FOUR directions, and that is a decision rather than an omission.
 *
 * Allowing diagonals immediately raises corner-cutting: may an actor move
 * between two walls that touch at a corner? Every answer is defensible and
 * each one changes pathing, chokepoints and how a corridor fight reads. Phase
 * 3.5 needs none of them, so it takes the rule with no corner case at all —
 * and a later phase that wants diagonals has to answer the question on
 * purpose, which is the right time to answer it.
 *
 * The order is the deterministic tie-break: north, west, east, south.
 */
export const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

/** One authored map, as a human writes it into content. */
export interface MapSource {
  readonly key: string;
  readonly z: number;
  /** One character per tile. `legend` says what each means. */
  readonly rows: readonly string[];
  readonly legend: Readonly<Record<string, TileKindName>>;
  readonly entry: { readonly x: number; readonly y: number };
  readonly regions: readonly MapRegionSource[];
}

export type TileKindName = 'floor' | 'wall' | 'water';

export interface MapRegionSource {
  readonly id: string;
  /** `[x, y, width, height]`, inclusive of `x,y`. */
  readonly rect: readonly [number, number, number, number];
  /** Which Phase 2 room this region IS. Rooms became places. */
  readonly room: number;
  /** Where this region's creatures stand when it is populated. */
  readonly spawns: readonly { readonly x: number; readonly y: number }[];
}

/** Compiled for the runtime: flat arrays, O(1) lookup, no parsing per step. */
export interface TileMap {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  /** 1 where an actor may stand. */
  readonly walkable: Uint8Array;
  /** The authored kind, for the renderer. */
  readonly kind: Uint8Array;
  readonly entry: TilePosition;
  readonly regions: readonly MapRegion[];
}

export interface MapRegion {
  readonly id: string;
  readonly room: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly spawns: readonly TilePosition[];
}

export const KIND_CODES: Readonly<Record<TileKindName, number>> = {
  floor: 0,
  wall: 1,
  water: 2,
};
const WALKABLE: Readonly<Record<TileKindName, boolean>> = {
  floor: true,
  wall: false,
  water: false,
};

export class MapError extends Error {
  override readonly name = 'MapError';
}

/**
 * Authored rows → runtime map, with every reason to refuse taken HERE.
 *
 * A map that is wrong should fail the content build, not produce a Character
 * that walks into a wall at run time. This is the validator and the compiler,
 * and they are one function because two would let them disagree.
 */
export function compileMap(source: MapSource): TileMap {
  const height = source.rows.length;
  if (height === 0) throw new MapError(`${source.key}: a map needs at least one row.`);
  const width = source.rows[0]!.length;
  if (width === 0) throw new MapError(`${source.key}: a map needs at least one column.`);

  const walkable = new Uint8Array(width * height);
  const kind = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = source.rows[y]!;
    if (row.length !== width) {
      throw new MapError(`${source.key}: row ${y} is ${row.length} wide, expected ${width}.`);
    }
    for (let x = 0; x < width; x += 1) {
      const symbol = row[x]!;
      const name = source.legend[symbol];
      if (!name)
        throw new MapError(
          `${source.key}: row ${y} column ${x} uses '${symbol}', which the legend does not define.`,
        );
      const index = y * width + x;
      kind[index] = KIND_CODES[name];
      walkable[index] = WALKABLE[name] ? 1 : 0;
    }
  }

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const walk = (x: number, y: number) => inside(x, y) && walkable[y * width + x] === 1;

  if (!walk(source.entry.x, source.entry.y)) {
    throw new MapError(`${source.key}: the entry tile is not walkable.`);
  }

  const seen = new Set<string>();
  const regions = source.regions.map((region) => {
    if (seen.has(region.id)) throw new MapError(`${source.key}: duplicate region ${region.id}.`);
    seen.add(region.id);
    const [x, y, w, h] = region.rect;
    if (w <= 0 || h <= 0 || !inside(x, y) || !inside(x + w - 1, y + h - 1)) {
      throw new MapError(`${source.key}: region ${region.id} is not inside the map.`);
    }
    if (region.spawns.length === 0) {
      throw new MapError(`${source.key}: region ${region.id} has no spawn tiles.`);
    }
    for (const spawn of region.spawns) {
      if (!walk(spawn.x, spawn.y)) {
        throw new MapError(
          `${source.key}: region ${region.id} spawns on (${spawn.x}, ${spawn.y}), which is not walkable.`,
        );
      }
      if (spawn.x < x || spawn.y < y || spawn.x >= x + w || spawn.y >= y + h) {
        throw new MapError(`${source.key}: region ${region.id} spawns outside its own rectangle.`);
      }
    }
    return {
      id: region.id,
      room: region.room,
      x,
      y,
      width: w,
      height: h,
      spawns: region.spawns.map((spawn) => ({ x: spawn.x, y: spawn.y, z: source.z })),
    };
  });

  if (regions.length === 0) throw new MapError(`${source.key}: a map needs at least one region.`);

  return {
    key: source.key,
    width,
    height,
    z: source.z,
    walkable,
    kind,
    entry: { x: source.entry.x, y: source.entry.y, z: source.z },
    regions,
  };
}

export const tileIndex = (map: TileMap, x: number, y: number): number => y * map.width + x;

export const isInside = (map: TileMap, position: TilePosition): boolean =>
  position.z === map.z &&
  position.x >= 0 &&
  position.y >= 0 &&
  position.x < map.width &&
  position.y < map.height;

export const isWalkable = (map: TileMap, position: TilePosition): boolean =>
  isInside(map, position) && map.walkable[tileIndex(map, position.x, position.y)] === 1;

/** The tiles an actor could stand on to attack something on `target`. */
export function meleeGoals(
  map: TileMap,
  target: TilePosition,
  blocked: (position: TilePosition) => boolean,
): TilePosition[] {
  const goals: TilePosition[] = [];
  for (const [dx, dy] of STEPS) {
    const candidate = { x: target.x + dx, y: target.y + dy, z: target.z };
    if (isWalkable(map, candidate) && !blocked(candidate)) goals.push(candidate);
  }
  return goals;
}

/**
 * The next STEP toward the nearest goal, or null when none is reachable.
 *
 * An actor never paths "to the target's tile" — it is occupied by definition.
 * It is given a GOAL SET, which is what makes the same function serve a melee
 * approach now and a "get within range with line of sight" policy later
 * without the caller changing.
 *
 * Deterministic A*: lowest `f`, ties to lowest `g`, then to the lowest tile
 * index. No randomness anywhere, so a reload recomputes the same path.
 */
export function stepToward(
  map: TileMap,
  from: TilePosition,
  goals: readonly TilePosition[],
  blocked: (position: TilePosition) => boolean,
  limit = 4096,
): TilePosition | null {
  if (goals.length === 0) return null;
  const goalIds = new Set(goals.map((goal) => tileIndex(map, goal.x, goal.y)));
  const start = tileIndex(map, from.x, from.y);
  if (goalIds.has(start)) return null;

  const heuristic = (x: number, y: number) =>
    Math.min(...goals.map((goal) => Math.abs(goal.x - x) + Math.abs(goal.y - y)));

  const cameFrom = new Map<number, number>();
  const g = new Map<number, number>([[start, 0]]);
  // A small map does not need a binary heap, and a heap is a data structure to
  // get wrong. The frontier is scanned; `limit` bounds the work.
  const open = new Set<number>([start]);
  let expanded = 0;

  while (open.size > 0 && expanded < limit) {
    let best = -1;
    let bestF = Infinity;
    let bestG = Infinity;
    for (const node of open) {
      const nodeG = g.get(node)!;
      const f = nodeG + heuristic(node % map.width, Math.floor(node / map.width));
      if (f < bestF || (f === bestF && (nodeG < bestG || (nodeG === bestG && node < best)))) {
        best = node;
        bestF = f;
        bestG = nodeG;
      }
    }
    open.delete(best);
    expanded += 1;

    if (goalIds.has(best)) {
      // Walk back to the first step after `start`.
      let node = best;
      while (cameFrom.get(node) !== start) {
        const previous = cameFrom.get(node);
        if (previous === undefined) return null;
        node = previous;
      }
      return { x: node % map.width, y: Math.floor(node / map.width), z: map.z };
    }

    const bx = best % map.width;
    const by = Math.floor(best / map.width);
    for (const [dx, dy] of STEPS) {
      const nx = bx + dx;
      const ny = by + dy;
      const candidate = { x: nx, y: ny, z: map.z };
      if (!isWalkable(map, candidate)) continue;
      const id = tileIndex(map, nx, ny);
      // A goal tile is enterable even if something stands next to it; any
      // OTHER blocked tile is not a place to route through.
      if (!goalIds.has(id) && blocked(candidate)) continue;
      const tentative = bestG + 1;
      if (tentative < (g.get(id) ?? Infinity)) {
        g.set(id, tentative);
        cameFrom.set(id, best);
        open.add(id);
      }
    }
  }
  return null;
}

/** Is `a` orthogonally adjacent to `b`? The melee precondition, once. */
export const isAdjacent = (a: TilePosition, b: TilePosition): boolean =>
  a.z === b.z && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
