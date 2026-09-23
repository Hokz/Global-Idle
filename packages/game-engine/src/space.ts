/**
 * Space, as the simulation understands it (Phase 3.5 spec §2–§5).
 *
 * PURE. No clock, no database, no randomness. A tile map is compiled once from
 * authored rows into flat typed arrays, and every question a settlement asks —
 * "may this be stood on", "may a path run through it", "which way to the Rat" —
 * is an array index or a bounded search over one.
 *
 * The coordinate is SEMANTIC, not pixels. `z` exists from the first map even
 * though the Sewers use one floor, because retrofitting a third axis into
 * saved positions, path costs and region membership is a migration and adding
 * it now is a field.
 *
 * Every rule here that claims to come from the source engine is cited in
 * `docs/specs/phase-3-5/PHASE_3_5_CANARY_SPATIAL_SOURCE_MAP.md`.
 */

export interface TilePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const samePosition = (a: TilePosition, b: TilePosition): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z;

/** Orthogonal distance. Kept for callers that want a cheap same-floor metric. */
export const manhattan = (a: TilePosition, b: TilePosition): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) * 64;

/** `Position::getDistanceX/Y` compared with `<=` — the source's range metric. */
export const chebyshev = (a: TilePosition, b: TilePosition): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * EIGHT directions, as the source engine has them
 * (`src/game/movement/position.hpp:12-22`, `src/utils/tools.cpp:581`).
 *
 * The order is one half of the deterministic tie-break: the four cardinals in
 * north, west, east, south, then the four diagonals. The other half is the
 * cost and the tile index, which is what actually decides — this order only
 * settles a tie that survives both.
 */
export const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * `MAP_NORMALWALKCOST` and the diagonal it implies
 * (`src/map/utils/astarnodes.hpp:38-40`, `astarnodes.cpp:274-277`):
 *
 *     ((|dx| + |dy|) - 1) * 25 + 10
 *
 * so a cardinal step is 10 and a diagonal 35. Integers, so the comparison that
 * breaks a tie is exact rather than a float that nearly is.
 */
export const NORMAL_WALK_COST = 10;
export const DIAGONAL_WALK_COST = 35;

export const stepCost = (dx: number, dy: number): number =>
  Math.abs(dx) === 1 && Math.abs(dy) === 1 ? DIAGONAL_WALK_COST : NORMAL_WALK_COST;

/** One authored map, as a human writes it into content. */
/**
 * The default ground speed, hard-coded in the source before anything is looked
 * up (`Creature::setParent`, `src/creatures/creature.cpp:1817`).
 *
 * A tile that authors nothing uses this, which is also the most common
 * authored value in the real client data — 1,097 of the appearances at the
 * pinned commit carry exactly 150.
 */
export const DEFAULT_GROUND_SPEED = 150;

/** `walk.groundSpeed` is a `uint16_t` in the source, and so is the array here. */
export const MAX_GROUND_SPEED = 65535;

/**
 * What a legend symbol MEANS.
 *
 * The short spelling is a kind on its own — `'#': 'wall'` — because most tiles
 * have nothing else to say. The long spelling adds the ground's own speed,
 * which is the number the step-duration curve divides into (§3 of the source
 * map). Both are normalised in ONE place, `readLegendEntry` below, so the two
 * spellings never become two meanings.
 *
 * LOWER `groundSpeed` is a FASTER step. The duration is proportional to it:
 * `floor(1000 × groundSpeed / calculatedStepSpeed)`. This reads backwards the
 * first time and is the source's own arithmetic.
 */
export interface MapTileDefinition {
  readonly kind: TileKindName;
  /** The ground's own speed. Absent means the 150 fallback; never 0. */
  readonly groundSpeed?: number | undefined;
}

export type MapLegendEntry = TileKindName | MapTileDefinition;

export interface MapSource {
  readonly key: string;
  readonly z: number;
  /** One character per tile. `legend` says what each means. */
  readonly rows: readonly string[];
  readonly legend: Readonly<Record<string, MapLegendEntry>>;
  readonly entry: { readonly x: number; readonly y: number };
  readonly regions: readonly MapRegionSource[];
  /**
   * Floor links — a DECLARED, DEFERRED contract (spec §6).
   *
   * A map compiles ONE floor of geometry. A connector may therefore be
   * authored and validated, and it is NOT executable: nothing in Phase 3.5
   * moves an actor to a floor whose walls, water and regions do not exist,
   * because those bytes would have to be borrowed from this floor and that is
   * not a second floor, it is the same floor wearing a different number.
   *
   * Phase 5 owns real multi-floor map geometry. What is here is the shape the
   * authoring format will keep, so that adding it later is a new field rather
   * than a migration of every published map.
   */
  readonly connectors?: readonly MapConnectorSource[];
}

/**
 * The three things a tile can block, kept apart because the source keeps them
 * apart: `blockSolid`, `blockPathFind` and `blockProjectile` are three
 * independent item properties mapping to three independent tile states
 * (`src/items/items.hpp:347-351`, `src/items/items_definitions.hpp:463-468`).
 *
 * Phase 3.5 fires no projectile. What it refuses to do is collapse the three
 * into one `walkable` bit, because un-collapsing it later is a content schema
 * migration and a Paladin is one phase away.
 */
export type TileKindName = 'floor' | 'wall' | 'water' | 'sludge';

export interface MapConnectorSource {
  readonly from: { readonly x: number; readonly y: number; readonly z: number };
  readonly to: { readonly x: number; readonly y: number; readonly z: number };
  readonly kind: ConnectorKind;
}

export type ConnectorKind = 'STAIRS_UP' | 'STAIRS_DOWN' | 'LADDER';

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
  /**
   * THE floor this map has geometry for. Singular, and deliberately so.
   *
   * `flags` and `kind` are indexed by `y * width + x` with no `z` term, so a
   * second floor would be reading this floor's collision. Until a map can
   * author per-floor rows, a map IS one floor.
   */
  readonly z: number;
  /** Per tile: the OR of `BLOCK_*`. Three questions, one byte. */
  readonly flags: Uint8Array;
  /** The authored kind, for the renderer. */
  readonly kind: Uint8Array;
  /**
   * Per tile: the ground speed a step DEPARTING from it divides by.
   *
   * Compiled, not parsed per step — a movement beat runs sixty times a second
   * of simulated time and must not touch the content bundle to do it. A
   * non-walkable tile carries the fallback because nothing ever departs from
   * one; the array is dense so the lookup is an index rather than a branch.
   */
  readonly groundSpeed: Uint16Array;
  readonly entry: TilePosition;
  readonly regions: readonly MapRegion[];
  readonly connectors: readonly MapConnector[];
}

export interface MapConnector {
  readonly from: TilePosition;
  readonly to: TilePosition;
  readonly kind: ConnectorKind;
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

export const BLOCK_SOLID = 1;
export const BLOCK_PATH = 2;
export const BLOCK_PROJECTILE = 4;

export const KIND_CODES: Readonly<Record<TileKindName, number>> = {
  floor: 0,
  wall: 1,
  water: 2,
  sludge: 3,
};

/**
 * What each authored kind blocks.
 *
 * `water` is the case that proves the three are not one: it cannot be stood on
 * and a path will not run through it, but an arrow crosses it — so a Phase 4
 * Paladin shooting over the sewer channel needs no schema change. `sludge` is
 * the mirror image, after the source's magic fields: stand on it if you must,
 * but the pathfinder routes around it.
 */
const BLOCKS: Readonly<Record<TileKindName, number>> = {
  floor: 0,
  wall: BLOCK_SOLID | BLOCK_PATH | BLOCK_PROJECTILE,
  water: BLOCK_SOLID | BLOCK_PATH,
  sludge: BLOCK_PATH,
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
/**
 * One legend symbol, normalised — the ONLY place the two spellings meet.
 *
 * A bad ground speed is refused here rather than clamped, and the message
 * names the symbol, because a map whose mud is secretly stone is a map whose
 * Hunt throughput is silently wrong.
 */
function readLegendEntry(
  key: string,
  symbol: string,
  entry: MapLegendEntry,
): { kind: TileKindName; groundSpeed: number } {
  if (typeof entry === 'string') return { kind: entry, groundSpeed: DEFAULT_GROUND_SPEED };
  const speed = entry.groundSpeed;
  if (speed === undefined) return { kind: entry.kind, groundSpeed: DEFAULT_GROUND_SPEED };
  if (!Number.isInteger(speed) || speed < 1 || speed > MAX_GROUND_SPEED) {
    throw new MapError(
      `${key}: legend '${symbol}' has groundSpeed ${String(speed)}; it must be a whole number from 1 to ${MAX_GROUND_SPEED}. Leave it out for the ${DEFAULT_GROUND_SPEED} default.`,
    );
  }
  return { kind: entry.kind, groundSpeed: speed };
}

export function compileMap(source: MapSource): TileMap {
  const height = source.rows.length;
  if (height === 0) throw new MapError(`${source.key}: a map needs at least one row.`);
  const width = source.rows[0]!.length;
  if (width === 0) throw new MapError(`${source.key}: a map needs at least one column.`);

  const legend = new Map<string, { kind: TileKindName; groundSpeed: number }>();
  for (const [symbol, entry] of Object.entries(source.legend)) {
    legend.set(symbol, readLegendEntry(source.key, symbol, entry));
  }

  const flags = new Uint8Array(width * height);
  const kind = new Uint8Array(width * height);
  const groundSpeed = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = source.rows[y]!;
    if (row.length !== width) {
      throw new MapError(`${source.key}: row ${y} is ${row.length} wide, expected ${width}.`);
    }
    for (let x = 0; x < width; x += 1) {
      const symbol = row[x]!;
      const tile = legend.get(symbol);
      if (!tile)
        throw new MapError(
          `${source.key}: row ${y} column ${x} uses '${symbol}', which the legend does not define.`,
        );
      const index = y * width + x;
      kind[index] = KIND_CODES[tile.kind];
      flags[index] = BLOCKS[tile.kind];
      groundSpeed[index] = tile.groundSpeed;
    }
  }

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const stand = (x: number, y: number) =>
    inside(x, y) && (flags[y * width + x]! & BLOCK_SOLID) === 0;

  if (!stand(source.entry.x, source.entry.y)) {
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
      if (!stand(spawn.x, spawn.y)) {
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

  const connectors = (source.connectors ?? []).map((connector) => {
    if (connector.from.z === connector.to.z) {
      throw new MapError(
        `${source.key}: connector at (${connector.from.x}, ${connector.from.y}) does not change floor.`,
      );
    }
    if (connector.from.z === source.z && !stand(connector.from.x, connector.from.y)) {
      throw new MapError(
        `${source.key}: connector at (${connector.from.x}, ${connector.from.y}) is not on a walkable tile.`,
      );
    }
    return {
      from: { ...connector.from },
      to: { ...connector.to },
      kind: connector.kind,
    };
  });

  const map: TileMap = {
    key: source.key,
    width,
    height,
    z: source.z,
    flags,
    kind,
    groundSpeed,
    entry: { x: source.entry.x, y: source.entry.y, z: source.z },
    regions,
    connectors,
  };

  assertProgressionReachable(map);
  return map;
}

export const tileIndex = (map: TileMap, x: number, y: number): number => y * map.width + x;

export const isInside = (map: TileMap, position: TilePosition): boolean =>
  position.z === map.z &&
  position.x >= 0 &&
  position.y >= 0 &&
  position.x < map.width &&
  position.y < map.height;

/** May an actor STAND here? `blockSolid`. */
export const canOccupy = (map: TileMap, position: TilePosition): boolean =>
  isInside(map, position) &&
  (map.flags[tileIndex(map, position.x, position.y)]! & BLOCK_SOLID) === 0;

/** May a PATH run through here? `blockPathFind`. */
export const canPathThrough = (map: TileMap, position: TilePosition): boolean =>
  isInside(map, position) &&
  (map.flags[tileIndex(map, position.x, position.y)]! & BLOCK_PATH) === 0;

/** Does this tile stop a PROJECTILE? `blockProjectile`. Nothing shoots yet. */
export const blocksProjectile = (map: TileMap, position: TilePosition): boolean =>
  !isInside(map, position) ||
  (map.flags[tileIndex(map, position.x, position.y)]! & BLOCK_PROJECTILE) !== 0;

/**
 * The ground speed a step DEPARTING from this tile divides by.
 *
 * Off the map — or on another floor — answers the 150 fallback rather than
 * throwing, for the same reason `canOccupy` answers `false`: a caller asking
 * about a tile that is not there has already lost, and a second failure mode
 * to handle would not help it.
 */
export const groundSpeedAt = (map: TileMap, position: TilePosition): number =>
  isInside(map, position)
    ? map.groundSpeed[tileIndex(map, position.x, position.y)]!
    : DEFAULT_GROUND_SPEED;

/** The old name, kept meaning exactly "may be stood on". */
export const isWalkable = canOccupy;

/**
 * The floor link AUTHORED on this tile, if there is one.
 *
 * Declared, validated, and not executable in Phase 3.5: the destination floor
 * has no geometry in this map, so nothing here moves an actor onto it. It
 * exists so the authoring format and the position type are already the right
 * shape when Phase 5 gives floors their own rows.
 */
export const connectorAt = (map: TileMap, position: TilePosition): MapConnector | null =>
  map.connectors.find((connector) => samePosition(connector.from, position)) ?? null;

/**
 * MELEE RANGE, defined independently of how anything moves.
 *
 * `Position::areInRange<1, 1>` (`src/game/movement/position.hpp:33-36`, used by
 * `Weapon::useFist` at `src/items/weapons/weapons.cpp:225`) is Chebyshev
 * distance one — all eight neighbours. It agrees with 8-direction movement
 * here, and it is a separate function because the day they disagree, one of
 * them has to be able to change.
 */
export const isAdjacent = (a: TilePosition, b: TilePosition): boolean =>
  a.z === b.z && chebyshev(a, b) === 1;

/** The tiles an actor could stand on to attack something on `target`. */
export function meleeGoals(
  map: TileMap,
  target: TilePosition,
  blocked: (position: TilePosition) => boolean,
): TilePosition[] {
  const goals: TilePosition[] = [];
  for (const [dx, dy] of STEPS) {
    const candidate = { x: target.x + dx, y: target.y + dy, z: target.z };
    if (canOccupy(map, candidate) && !blocked(candidate)) goals.push(candidate);
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
 * Deterministic A* over integer costs: lowest `f`, ties to lowest `g`, then to
 * the lowest tile index. No randomness anywhere, so a reload recomputes the
 * same path.
 *
 * DIAGONALS CUT CORNERS, and that is the source's rule rather than a
 * convenience: `Game::internalMoveCreature` validates the destination tile and
 * nothing else, and the source's own A* evaluates a diagonal neighbour by that
 * neighbour alone (`src/map/map.cpp:1107-1145`). A step is legal when its
 * destination is.
 */
export function stepToward(
  map: TileMap,
  from: TilePosition,
  goals: readonly TilePosition[],
  blocked: (position: TilePosition) => boolean,
  limit = 4096,
): TilePosition | null {
  if (goals.length === 0) return null;
  // One floor. Changing floor is a property of a tile you step onto, not a
  // path the search plans through — the source's A* holds `z` constant too.
  const here = goals.filter((goal) => goal.z === from.z);
  if (here.length === 0) return null;

  const goalIds = new Set(here.map((goal) => tileIndex(map, goal.x, goal.y)));
  const start = tileIndex(map, from.x, from.y);
  if (goalIds.has(start)) return null;

  /**
   * MANHATTAN × the cardinal cost, and the arithmetic matters.
   *
   * An earlier version charged `35 · min(dx,dy) + 10 · (max−min)` — the cost of
   * walking the diagonal part first — and called it the exact optimal cost on
   * empty floor. It is not, because with these edge costs the diagonal is NOT
   * the cheap way: for a displacement of (1, 1) it estimates 35 while two
   * cardinal steps cost 20. A heuristic that overestimates is inadmissible, and
   * an inadmissible A* returns "a path", not "the cheapest path". It really did
   * pick an 80-cost route where a 70-cost one existed (`PTH13`).
   *
   * This one never overestimates: every cardinal step costs 10 and reduces the
   * Manhattan distance by exactly 1, and every diagonal step costs 35 and
   * reduces it by at most 2, so `h` falls by at most 10 or 20 against edges of
   * 10 and 35. Admissible, and consistent — which is what makes the first
   * closed node the cheapest one.
   */
  const heuristic = (x: number, y: number) => {
    let best = Infinity;
    for (const goal of here) {
      const estimate = (Math.abs(goal.x - x) + Math.abs(goal.y - y)) * NORMAL_WALK_COST;
      if (estimate < best) best = estimate;
    }
    return best;
  };

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
      return { x: node % map.width, y: Math.floor(node / map.width), z: from.z };
    }

    const bx = best % map.width;
    const by = Math.floor(best / map.width);
    for (const [dx, dy] of STEPS) {
      const nx = bx + dx;
      const ny = by + dy;
      const candidate = { x: nx, y: ny, z: from.z };
      // A goal tile must be STANDABLE; every tile routed THROUGH must also be
      // path-open, which is where `blockPathFind` earns its separate bit.
      const id = tileIndex(map, nx, ny);
      const goal = goalIds.has(id);
      if (!canOccupy(map, candidate)) continue;
      if (!goal && !canPathThrough(map, candidate)) continue;
      if (!goal && blocked(candidate)) continue;
      const tentative = bestG + stepCost(dx, dy);
      if (tentative < (g.get(id) ?? Infinity)) {
        g.set(id, tentative);
        cameFrom.set(id, best);
        open.add(id);
      }
    }
  }
  return null;
}

/**
 * Can the Hunt still be PLAYED on this map?
 *
 * Structural validity is not enough once a map is a gameplay asset: a content
 * edit that walls off room 7 publishes a Hunt that softlocks halfway through.
 * So the compiler proves the progression graph, ignoring dynamic actors —
 * entry reaches room 1, room *n* reaches room *n+1*, and every spawn tile is
 * reachable inside its own region.
 */
function assertProgressionReachable(map: TileMap): void {
  const reachable = (from: TilePosition): Set<number> => {
    const seen = new Set<number>();
    if (!canOccupy(map, from)) return seen;
    const queue: TilePosition[] = [from];
    seen.add(tileIndex(map, from.x, from.y));
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const [dx, dy] of STEPS) {
        const next = { x: at.x + dx, y: at.y + dy, z: at.z };
        if (!canOccupy(map, next) || !canPathThrough(map, next)) continue;
        const id = tileIndex(map, next.x, next.y);
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(next);
      }
    }
    return seen;
  };

  const ordered = [...map.regions].sort((a, b) => a.room - b.room);
  let from = map.entry;
  for (const region of ordered) {
    const reach = reachable(from);
    for (const spawn of region.spawns) {
      if (!reach.has(tileIndex(map, spawn.x, spawn.y))) {
        throw new MapError(
          `${map.key}: region ${region.id} spawn (${spawn.x}, ${spawn.y}) cannot be reached from (${from.x}, ${from.y}) — the progression is broken.`,
        );
      }
    }
    from = region.spawns[0]!;
  }
}
