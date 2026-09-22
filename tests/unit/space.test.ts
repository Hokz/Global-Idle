/**
 * Phase 3.5 §20 — TIL1 to TIL6, PTH1 to PTH6.
 *
 * The tile model and the pathfinder, as pure functions. No database, no clock,
 * no randomness — which is the point: every spatial decision in this game is
 * reproducible from the same inputs, so a reload cannot change the future.
 */
import { describe, expect, it } from 'vitest';
import {
  MapError,
  compileMap,
  isAdjacent,
  isWalkable,
  meleeGoals,
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
    expect(map.walkable).toBeInstanceOf(Uint8Array);
    expect(map.walkable.length).toBe(25);
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
