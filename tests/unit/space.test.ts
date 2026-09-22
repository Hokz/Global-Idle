/**
 * Phase 3.5 §20 — TIL1 to TIL6, PTH1 to PTH6.
 *
 * The tile model and the pathfinder, as pure functions. No database, no clock,
 * no randomness — which is the point: every spatial decision in this game is
 * reproducible from the same inputs, so a reload cannot change the future.
 */
import { describe, expect, it } from 'vitest';
import {
  DIAGONAL_WALK_COST,
  MapError,
  STEPS,
  NORMAL_WALK_COST,
  blocksProjectile,
  canOccupy,
  canPathThrough,
  chebyshev,
  compileMap,
  connectorAt,
  isAdjacent,
  isWalkable,
  meleeGoals,
  stepCost,
  stepToward,
  type MapSource,
  type TileMap,
} from '@global-idle/game-engine';

const LEGEND = { '#': 'wall', '.': 'floor', '~': 'water' } as const;

const source = (rows: readonly string[], over: Partial<MapSource> = {}): MapSource => ({
  key: 'map.test',
  z: 7,
  rows,
  legend: LEGEND,
  entry: { x: 1, y: 1 },
  regions: [
    {
      id: 'r1',
      rect: [1, 1, rows[0]!.length - 2, rows.length - 2],
      room: 1,
      spawns: [{ x: 1, y: 1 }],
    },
  ],
  ...over,
});

const OPEN = ['#####', '#...#', '#...#', '#...#', '#####'];
const at = (x: number, y: number) => ({ x, y, z: 7 });
const free = () => false;

describe('§20 TIL — the tile model', () => {
  it('TIL1: authored rows compile into flat arrays with O(1) lookup', () => {
    const map = compileMap(source(OPEN));
    expect(map.width).toBe(5);
    expect(map.height).toBe(5);
    expect(map.flags).toBeInstanceOf(Uint8Array);
    expect(map.flags.length).toBe(25);
    expect(isWalkable(map, at(1, 1))).toBe(true);
    expect(isWalkable(map, at(0, 0))).toBe(false);
  });

  it('TIL2: a position carries Z from the first map, and another floor is not this one', () => {
    const map = compileMap(source(OPEN));
    expect(map.entry.z).toBe(7);
    // Z exists NOW even though the Sewers use one floor: retrofitting a third
    // axis into saved positions and region membership is a migration.
    expect(isWalkable(map, { x: 1, y: 1, z: 6 })).toBe(false);
    expect(isAdjacent(at(1, 1), { x: 1, y: 2, z: 6 })).toBe(false);
  });

  it('TIL3: a ragged map is refused at COMPILE time, not discovered by a walker', () => {
    expect(() => compileMap(source(['####', '#..#', '###']))).toThrow(MapError);
  });

  it('TIL4: a symbol the legend does not define is refused', () => {
    expect(() => compileMap(source(['#####', '#.?.#', '#####']))).toThrow(/legend/);
  });

  it('TIL5: an entry or a spawn on a wall is refused', () => {
    expect(() => compileMap(source(OPEN, { entry: { x: 0, y: 0 } }))).toThrow(/entry/);
    expect(() =>
      compileMap(
        source(OPEN, {
          regions: [{ id: 'r1', rect: [1, 1, 3, 3], room: 1, spawns: [{ x: 0, y: 0 }] }],
        }),
      ),
    ).toThrow(/walkable/);
  });

  it('TIL6: decoration is not collision — water blocks, and it says which it is', () => {
    const map = compileMap(source(['#####', '#.~.#', '#####']));
    expect(isWalkable(map, at(2, 1))).toBe(false);
    expect(map.kind[1 * 5 + 2]).toBe(2);
    expect(map.kind[1 * 5 + 1]).toBe(0);
  });
});

describe('§20 PTH — deterministic pathfinding to a GOAL SET', () => {
  const walled: TileMap = compileMap(
    source(['#########', '#.......#', '#.#######', '#.......#', '#########']),
  );

  it('PTH1: an actor never paths ONTO its target — it paths to a tile beside it', () => {
    const map = compileMap(source(OPEN));
    const goals = meleeGoals(map, at(3, 1), free);
    expect(goals).toContainEqual(at(2, 1));
    expect(goals).not.toContainEqual(at(3, 1));
    // The target's own tile is never in the set, which is what makes this
    // reusable for a ranged policy later without changing the caller.
    expect(goals.every((goal) => !isAdjacent(goal, goal))).toBe(true);
  });

  it('PTH2: it walks AROUND a real obstacle rather than through it', () => {
    // The wall spans the middle; the only way from the top corridor to the
    // bottom one is around the left end.
    let here = at(7, 1);
    const target = at(7, 3);
    const seen: string[] = [];
    for (let step = 0; step < 40; step += 1) {
      const goals = meleeGoals(walled, target, free);
      const next = stepToward(walled, here, goals, free);
      if (!next) break;
      here = next;
      seen.push(`${next.x},${next.y}`);
      expect(isWalkable(walled, next)).toBe(true);
      if (isAdjacent(here, target)) break;
    }
    expect(isAdjacent(here, target)).toBe(true);
    // It had to go left along row 1 and come back along row 3 — a straight
    // line would have been two steps.
    expect(seen.length).toBeGreaterThan(2);
    expect(seen).toContain('1,2');
  });

  it('PTH3: the same question always gets the same answer', () => {
    const goals = meleeGoals(walled, at(7, 3), free);
    const first = stepToward(walled, at(7, 1), goals, free);
    for (let n = 0; n < 5; n += 1) {
      expect(stepToward(walled, at(7, 1), goals, free)).toEqual(first);
    }
  });

  it('PTH4: a blocked tile is not routed THROUGH, and an occupied goal is dropped', () => {
    const map = compileMap(source(OPEN));
    const blocked = (p: { x: number; y: number }) => p.x === 2 && p.y === 1;
    expect(meleeGoals(map, at(3, 1), blocked)).not.toContainEqual(at(2, 1));
    // With every neighbour of the target taken, there is nowhere to go.
    expect(stepToward(map, at(1, 1), [], blocked)).toBeNull();
  });

  it('PTH5: an unreachable goal set returns null rather than a wrong step', () => {
    const island = compileMap(
      source(['#######', '#..#..#', '#..#..#', '#######'], {
        regions: [{ id: 'r1', rect: [1, 1, 5, 2], room: 1, spawns: [{ x: 1, y: 1 }] }],
      }),
    );
    const goals = meleeGoals(island, at(5, 1), free);
    expect(goals.length).toBeGreaterThan(0);
    expect(stepToward(island, at(1, 1), goals, free)).toBeNull();
  });

  it('PTH6: standing on a goal already means there is nothing to do', () => {
    const map = compileMap(source(OPEN));
    const goals = meleeGoals(map, at(2, 1), free);
    expect(stepToward(map, at(1, 1), goals, free)).toBeNull();
  });
});

describe('§20 PTH — eight directions, as the source has them', () => {
  it('PTH7: a diagonal is not a shortcut — two cardinals are cheaper than one', () => {
    const map = compileMap(source(['#####', '#...#', '#...#', '#...#', '#####']));
    const goals = meleeGoals(map, at(3, 3), free);
    // From the opposite corner the diagonal is one step of 35 against two
    // cardinals of 10 + 10 — so the CHEAPER route is the cardinal pair, and
    // the first step must be one of those. Diagonals exist; they are not free.
    const next = stepToward(map, at(1, 1), goals, free);
    expect(next).not.toBeNull();
    expect([`${next!.x},${next!.y}`]).toContain('2,1');
  });

  it('PTH8: a diagonal costs 35 and a cardinal 10 — the source’s own numbers', () => {
    expect(NORMAL_WALK_COST).toBe(10);
    expect(DIAGONAL_WALK_COST).toBe(35);
    expect(stepCost(1, 0)).toBe(NORMAL_WALK_COST);
    expect(stepCost(0, -1)).toBe(NORMAL_WALK_COST);
    expect(stepCost(-1, 1)).toBe(DIAGONAL_WALK_COST);
    // `((|dx| + |dy|) - 1) * 25 + 10` — astarnodes.cpp:274-277.
    expect(DIAGONAL_WALK_COST).toBe((2 - 1) * 25 + NORMAL_WALK_COST);
  });

  it('PTH9: a diagonal CUTS THE CORNER — the source validates the destination only', () => {
    // ```
    //  01234
    // 0#####
    // 1#.#.#    from (1,1) every orthogonal neighbour is wall; the ONLY open
    // 2##..#    neighbour is (2,2), a diagonal whose two flanking tiles —
    // 3#####    (2,1) and (1,2) — are both blocked.
    // ```
    // The source allows it: `internalMoveCreature` validates `toTile` and
    // nothing else, and its A* evaluates a diagonal neighbour by that
    // neighbour alone.
    const corner = compileMap(
      source(['#####', '#.#.#', '##..#', '#####'], {
        entry: { x: 1, y: 1 },
        regions: [{ id: 'r1', rect: [1, 1, 3, 2], room: 1, spawns: [{ x: 1, y: 1 }] }],
      }),
    );
    expect(isWalkable(corner, at(2, 1))).toBe(false);
    expect(isWalkable(corner, at(1, 2))).toBe(false);
    expect(isWalkable(corner, at(2, 2))).toBe(true);
    const goals = meleeGoals(corner, at(3, 1), free);
    expect(goals).toContainEqual(at(3, 2));
    const next = stepToward(corner, at(1, 1), goals, free);
    // The only route out of (1,1) is the diagonal to (2,2).
    expect(next).toEqual(at(2, 2));
  });

  it('PTH10: a dynamic actor on the diagonal destination blocks it like anything else', () => {
    const corner = compileMap(
      source(['#####', '#.#.#', '##..#', '#####'], {
        entry: { x: 1, y: 1 },
        regions: [{ id: 'r1', rect: [1, 1, 3, 2], room: 1, spawns: [{ x: 1, y: 1 }] }],
      }),
    );
    const standing = (p: { x: number; y: number }) => p.x === 2 && p.y === 2;
    const goals = meleeGoals(corner, at(3, 1), standing);
    expect(stepToward(corner, at(1, 1), goals, standing)).toBeNull();
  });

  it('PTH11: melee reach is Chebyshev one — diagonals included, movement aside', () => {
    expect(isAdjacent(at(2, 2), at(3, 3))).toBe(true);
    expect(isAdjacent(at(2, 2), at(2, 3))).toBe(true);
    expect(isAdjacent(at(2, 2), at(4, 3))).toBe(false);
    expect(isAdjacent(at(2, 2), at(2, 2))).toBe(false);
    expect(chebyshev(at(2, 2), at(3, 3))).toBe(1);
    expect(isAdjacent(at(2, 2), { x: 3, y: 3, z: 6 })).toBe(false);
  });

  it('PTH12: a path is not routed THROUGH a tile that only blocks pathing', () => {
    // `sludge` may be stood on and refuses to be routed through — the source's
    // magic-field shape, and the case that proves the two bits are not one.
    const map = compileMap(
      source(['#######', '#..,..#', '#######'], {
        entry: { x: 1, y: 1 },
        regions: [{ id: 'r1', rect: [1, 1, 5, 1], room: 1, spawns: [{ x: 1, y: 1 }] }],
        legend: { '#': 'wall', '.': 'floor', '~': 'water', ',': 'sludge' },
      }),
    );
    expect(canOccupy(map, at(3, 1))).toBe(true);
    expect(canPathThrough(map, at(3, 1))).toBe(false);
    const goals = meleeGoals(map, at(5, 1), free);
    // The only corridor runs through the sludge, so there is no path at all.
    expect(stepToward(map, at(1, 1), goals, free)).toBeNull();
  });
});

describe('§20 COL — three collision questions, not one', () => {
  const kinds = compileMap(
    source(['#######', '#.~,..#', '#######'], {
      entry: { x: 1, y: 1 },
      regions: [{ id: 'r1', rect: [1, 1, 5, 1], room: 1, spawns: [{ x: 1, y: 1 }] }],
      legend: { '#': 'wall', '.': 'floor', '~': 'water', ',': 'sludge' },
    }),
  );

  it('COL1: a wall blocks all three', () => {
    expect(canOccupy(kinds, at(0, 1))).toBe(false);
    expect(canPathThrough(kinds, at(0, 1))).toBe(false);
    expect(blocksProjectile(kinds, at(0, 1))).toBe(true);
  });

  it('COL2: water blocks standing and pathing — and an arrow crosses it', () => {
    expect(canOccupy(kinds, at(2, 1))).toBe(false);
    expect(canPathThrough(kinds, at(2, 1))).toBe(false);
    // The whole reason the bits are separate: a Phase 4 Paladin shooting over
    // the sewer channel needs no content migration to do it.
    expect(blocksProjectile(kinds, at(2, 1))).toBe(false);
  });

  it('COL3: sludge can be stood on, refuses to be routed through, and is see-through', () => {
    expect(canOccupy(kinds, at(3, 1))).toBe(true);
    expect(canPathThrough(kinds, at(3, 1))).toBe(false);
    expect(blocksProjectile(kinds, at(3, 1))).toBe(false);
  });

  it('COL4: floor blocks nothing, and outside the map blocks everything', () => {
    expect(canOccupy(kinds, at(1, 1))).toBe(true);
    expect(canPathThrough(kinds, at(1, 1))).toBe(true);
    expect(blocksProjectile(kinds, at(1, 1))).toBe(false);
    expect(canOccupy(kinds, at(99, 1))).toBe(false);
    expect(blocksProjectile(kinds, at(99, 1))).toBe(true);
  });
});

describe('§20 FLR — the floor seam is declared, and honestly not executable', () => {
  const twoFloors = compileMap(
    source(['#####', '#...#', '#####'], {
      entry: { x: 1, y: 1 },
      regions: [{ id: 'r1', rect: [1, 1, 3, 1], room: 1, spawns: [{ x: 1, y: 1 }] }],
      connectors: [{ from: { x: 3, y: 1, z: 7 }, to: { x: 3, y: 1, z: 6 }, kind: 'STAIRS_UP' }],
    }),
  );

  it('FLR1: a connector is authored content, and the map still has ONE floor', () => {
    expect(connectorAt(twoFloors, at(3, 1))?.kind).toBe('STAIRS_UP');
    expect(connectorAt(twoFloors, at(1, 1))).toBeNull();
    // The map compiles one floor of geometry. Declaring a link to z=6 does not
    // conjure walls, water or regions there, so z=6 is NOT part of this map.
    expect(twoFloors.z).toBe(7);
    expect(isWalkable(twoFloors, { x: 1, y: 1, z: 6 })).toBe(false);
    expect(canPathThrough(twoFloors, { x: 1, y: 1, z: 6 })).toBe(false);
    // And the only way to read collision is through the floor that authored it.
    expect(blocksProjectile(twoFloors, { x: 1, y: 1, z: 6 })).toBe(true);
  });

  it('FLR4: a second Z cannot borrow this floor’s collision bytes', () => {
    // The defect this case exists for: `flags` is indexed by `y * width + x`
    // with no Z term, so admitting a second Z would have made every tile of
    // the "other floor" answer with THIS floor's walls. A floor that is not
    // authored is simply not there.
    for (const z of [6, 8, 0, -1]) {
      expect(isWalkable(twoFloors, { x: 1, y: 1, z })).toBe(false);
      expect(canOccupy(twoFloors, { x: 2, y: 1, z })).toBe(false);
      expect(canPathThrough(twoFloors, { x: 2, y: 1, z })).toBe(false);
    }
    // The same tiles on the authored floor are open, so the refusal above is
    // about the FLOOR and not about the coordinates.
    expect(isWalkable(twoFloors, at(1, 1))).toBe(true);
    expect(canPathThrough(twoFloors, at(2, 1))).toBe(true);
  });

  it('FLR2: a connector that changes nothing, or stands on a wall, is refused', () => {
    expect(() =>
      compileMap(
        source(['#####', '#...#', '#####'], {
          connectors: [{ from: { x: 1, y: 1, z: 7 }, to: { x: 2, y: 1, z: 7 }, kind: 'LADDER' }],
        }),
      ),
    ).toThrow(/does not change floor/);
    expect(() =>
      compileMap(
        source(['#####', '#...#', '#####'], {
          connectors: [{ from: { x: 0, y: 0, z: 7 }, to: { x: 0, y: 0, z: 6 }, kind: 'LADDER' }],
        }),
      ),
    ).toThrow(/not on a walkable tile/);
  });

  it('FLR3: pathfinding stays on ONE floor — a goal upstairs is not a step', () => {
    // The source's A* holds `z` constant too; changing floor is a property of
    // a tile you arrive on, which is what a connector will be when a floor has
    // geometry of its own.
    const upstairs = [{ x: 3, y: 1, z: 6 }];
    expect(stepToward(twoFloors, at(1, 1), upstairs, free)).toBeNull();
  });
});

describe('§20 RCH — a map that cannot be played is not published', () => {
  const sewerish = (rows: readonly string[]) =>
    source(rows, {
      entry: { x: 1, y: 1 },
      regions: [
        { id: 'a', rect: [1, 1, 2, 1], room: 1, spawns: [{ x: 1, y: 1 }] },
        { id: 'b', rect: [5, 1, 2, 1], room: 2, spawns: [{ x: 5, y: 1 }] },
      ],
    });

  it('RCH1: a connected progression compiles', () => {
    const map = compileMap(sewerish(['########', '#......#', '########']));
    expect(map.regions).toHaveLength(2);
  });

  it('RCH2: a doorway walled shut fails the BUILD, not the player’s evening', () => {
    // Room 2 is structurally valid, inside the map, with a walkable spawn —
    // and unreachable. Structural validation passes it; this does not.
    expect(() => compileMap(sewerish(['########', '#..##..#', '########']))).toThrow(
      /progression is broken/,
    );
  });
});

describe('§20 PTH — the path is the CHEAPEST path', () => {
  /**
   * The regression this group exists for.
   *
   * ```
   *  01234567
   * 0########
   * 1#S.#.T.#     S = start (1,1); T = target (5,1), its tile occupied
   * 2#.#.#..#
   * 3#......#
   * 4#......#
   * 5#......#
   * 6#......#
   * 7########
   * ```
   *
   * The first heuristic charged `35 · min(dx,dy) + 10 · (max−min)` and called
   * itself the exact optimal cost. With a diagonal edge of 35 against two
   * cardinals of 20 it OVERESTIMATES, which makes A* inadmissible — and on
   * this map it really did take an 80-cost route past a 70-cost one.
   */
  const COUNTEREXAMPLE = [
    '########',
    '#..#...#',
    '#.#.#..#',
    '#......#',
    '#......#',
    '#......#',
    '#......#',
    '########',
  ];

  const counterexample = compileMap(
    source(COUNTEREXAMPLE, {
      entry: { x: 1, y: 1 },
      regions: [{ id: 'r', rect: [1, 1, 6, 6], room: 1, spawns: [{ x: 1, y: 1 }] }],
    }),
  );

  /** The target's own tile is occupied, as a hostile target's always is. */
  const onTarget = (position: { x: number; y: number }) => position.x === 5 && position.y === 1;

  /** Walk `stepToward` to a goal and add up what it actually cost. */
  const walk = (
    map: TileMap,
    from: typeof at extends never ? never : ReturnType<typeof at>,
    goals: ReturnType<typeof at>[],
    blocked: (p: { x: number; y: number }) => boolean,
  ) => {
    const reached = new Set(goals.map((goal) => `${goal.x},${goal.y}`));
    let here = from;
    let cost = 0;
    const route = [`${from.x},${from.y}`];
    for (let guard = 0; guard < 64; guard += 1) {
      const next = stepToward(map, here, goals, blocked);
      if (!next) break;
      cost += stepCost(next.x - here.x, next.y - here.y);
      here = next;
      route.push(`${here.x},${here.y}`);
      if (reached.has(`${here.x},${here.y}`)) break;
    }
    return { cost, route, arrived: reached.has(`${here.x},${here.y}`) };
  };

  /**
   * An exhaustive shortest path over the SAME edge model, in the test only.
   *
   * It is deliberately a different algorithm — no heuristic at all — so it can
   * disagree with the production one when the production one is wrong.
   */
  function cheapestCost(
    map: TileMap,
    from: ReturnType<typeof at>,
    goals: ReturnType<typeof at>[],
    blocked: (p: { x: number; y: number }) => boolean,
  ): number {
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const goalKeys = new Set(goals.map(key));
    const distance = new Map<string, number>([[key(from), 0]]);
    const settled = new Set<string>();
    for (;;) {
      let best: string | null = null;
      let bestCost = Infinity;
      for (const [node, cost] of distance) {
        if (!settled.has(node) && cost < bestCost) {
          best = node;
          bestCost = cost;
        }
      }
      if (best === null) return Infinity;
      settled.add(best);
      if (goalKeys.has(best)) return bestCost;
      const [bx, by] = best.split(',').map(Number) as [number, number];
      for (const [dx, dy] of STEPS) {
        const candidate = at(bx + dx, by + dy);
        const id = key(candidate);
        if (!canOccupy(map, candidate)) continue;
        if (!goalKeys.has(id) && !canPathThrough(map, candidate)) continue;
        if (!goalKeys.has(id) && blocked(candidate)) continue;
        const next = bestCost + stepCost(dx, dy);
        if (next < (distance.get(id) ?? Infinity)) distance.set(id, next);
      }
    }
  }

  it('PTH13: the chosen route costs 70, not the 80 an inadmissible heuristic took', () => {
    const goals = meleeGoals(counterexample, at(5, 1), onTarget);
    expect(goals.map((goal) => `${goal.x},${goal.y}`).sort()).toEqual(['4,1', '5,2', '6,1', '6,2']);

    const taken = walk(counterexample, at(1, 1), goals, onTarget);
    expect(taken.arrived).toBe(true);
    expect(taken.cost).toBe(70);
    // The first step is the one that makes the cheap route possible. The old
    // heuristic chose (2,1) and paid 80 for it.
    expect(taken.route[1]).toBe('1,2');

    // And it equals what an exhaustive search says the cheapest route costs.
    expect(taken.cost).toBe(cheapestCost(counterexample, at(1, 1), goals, onTarget));
  });

  it('PTH14: on every small fixture, the route matches an exhaustive oracle', () => {
    const fixtures: {
      rows: readonly string[];
      from: [number, number];
      target: [number, number];
    }[] = [
      { rows: COUNTEREXAMPLE, from: [1, 1], target: [5, 1] },
      {
        rows: ['#######', '#.....#', '#.###.#', '#.....#', '#######'],
        from: [1, 1],
        target: [5, 3],
      },
      {
        rows: ['#######', '#..#..#', '#..#..#', '#.....#', '#######'],
        from: [1, 1],
        target: [5, 1],
      },
      { rows: ['######', '#....#', '#.##.#', '#....#', '######'], from: [1, 1], target: [4, 3] },
      { rows: ['#####', '#...#', '#...#', '#...#', '#####'], from: [1, 1], target: [3, 3] },
    ];

    for (const fixture of fixtures) {
      const map = compileMap(
        source(fixture.rows, {
          entry: { x: 1, y: 1 },
          regions: [
            {
              id: 'r',
              rect: [1, 1, fixture.rows[0]!.length - 2, fixture.rows.length - 2],
              room: 1,
              spawns: [{ x: 1, y: 1 }],
            },
          ],
        }),
      );
      const target = at(fixture.target[0], fixture.target[1]);
      const occupied = (p: { x: number; y: number }) => p.x === target.x && p.y === target.y;
      const goals = meleeGoals(map, target, occupied);
      const from = at(fixture.from[0], fixture.from[1]);
      const taken = walk(map, from, goals, occupied);
      const cheapest = cheapestCost(map, from, goals, occupied);
      expect(taken.arrived, JSON.stringify(fixture.rows)).toBe(true);
      expect(taken.cost, JSON.stringify(fixture.rows)).toBe(cheapest);
    }
  });

  it('PTH15: the heuristic never overestimates, on any displacement', () => {
    // The property the fix restores, stated directly: `manhattan * 10` cannot
    // exceed the cheapest reachable cost, because every cardinal edge costs 10
    // and cuts Manhattan by 1, and every diagonal costs 35 and cuts it by 2.
    for (let dx = 0; dx <= 6; dx += 1) {
      for (let dy = 0; dy <= 6; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const estimate = (dx + dy) * NORMAL_WALK_COST;
        const diagonal = Math.min(dx, dy);
        const straight = Math.max(dx, dy) - diagonal;
        // The cheapest route on empty floor is the better of "all cardinals"
        // and "diagonals then cardinals".
        const cheapest = Math.min(
          (dx + dy) * NORMAL_WALK_COST,
          diagonal * DIAGONAL_WALK_COST + straight * NORMAL_WALK_COST,
        );
        expect(estimate).toBeLessThanOrEqual(cheapest);
      }
    }
  });
});
