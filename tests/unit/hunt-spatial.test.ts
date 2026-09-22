/**
 * Phase 3.5 §20 — SPC1 to SPC8.
 *
 * The simulator WITH a map. Everything here is the pure engine: a state in, a
 * state out, no database and no clock. What these cases pin is the part of the
 * fight that space actually changed — who may be hit, who walks, who wins a
 * tile — and the part it must not have changed at all.
 */
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_ACTOR,
  compileMap,
  createSeededRandom,
  simulateHunt,
  type CombatProfile,
  type CreatureStats,
  type HuntState,
  type MapSource,
  type RoomPlan,
  type SpatialPlan,
  type TilePosition,
} from '@global-idle/game-engine';

const LEGEND = { '#': 'wall', '.': 'floor', '~': 'water' } as const;

/**
 * Two chambers joined by a ONE-TILE doorway at (3, 2).
 *
 * ```
 * 0123456
 * ####### 0
 * #..#..# 1
 * #.....# 2   <- (3, 2) is the only way through
 * #..#..# 3
 * ####### 4
 * ```
 */
const DOORWAY: MapSource = {
  key: 'map.doorway',
  z: 7,
  rows: ['#######', '#..#..#', '#.....#', '#..#..#', '#######'],
  legend: LEGEND,
  entry: { x: 1, y: 2 },
  regions: [
    {
      id: 'west',
      rect: [1, 1, 2, 3],
      room: 1,
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 3 },
      ],
    },
    {
      id: 'east',
      rect: [4, 1, 2, 3],
      room: 2,
      spawns: [
        { x: 5, y: 1 },
        { x: 5, y: 3 },
      ],
    },
  ],
};

const RAT: CreatureStats = {
  key: 'creature.rat',
  maxHealth: 20,
  experience: 5,
  attackIntervalMs: 2000,
  maxDamage: 8,
  defense: 5,
  armor: 1,
  mitigation: 7,
  gold: { chance: 1, min: 1, max: 4 },
};

const PROFILE: CombatProfile = {
  level: 2,
  maxHealth: 185,
  attackSkill: 12,
  attackValue: 9.6,
  armed: true,
  attackFactor: 1,
  attackIntervalMs: 2000,
  defense: 4,
  armor: 4,
  supply: { healMin: 60, healMax: 90, useBelowPercent: 40 },
};

const PLAN: RoomPlan = {
  creatures: { 'creature.rat': RAT },
  rooms: [
    { number: 1, creatures: [{ key: 'creature.rat', count: 2 }], endless: false },
    { number: 2, creatures: [{ key: 'creature.rat', count: 2 }], endless: true },
  ],
};

const at = (x: number, y: number): TilePosition => ({ x, y, z: 7 });

function spatial(source: MapSource = DOORWAY): SpatialPlan {
  const map = compileMap(source);
  const byRoom = new Map(map.regions.map((region) => [region.room, region]));
  const endless = map.regions[map.regions.length - 1]!;
  return { map, regionFor: (room) => byRoom.get(room) ?? endless };
}

/** A state assembled by hand, so a case can pin one arrangement of actors. */
function state(over: Partial<HuntState> = {}): HuntState {
  return {
    tick: 0,
    room: 1,
    cycle: 0,
    health: PROFILE.maxHealth,
    supplyCharges: 0,
    creatures: [],
    characterNextAttackTick: 0,
    ended: null,
    ...over,
  };
}

const rat = (id: string, position: TilePosition, health = RAT.maxHealth) => ({
  key: 'creature.rat',
  health,
  nextAttackTick: 0,
  id,
  position,
});

const seeded = () => createSeededRandom('spc');

describe('§20 SPC — the fight, with a map under it', () => {
  it('SPC1: out of reach is out of the fight — the Character walks instead of hitting', () => {
    const step = simulateHunt(
      state({ position: at(1, 2), creatures: [rat('a', at(5, 2))] }),
      PROFILE,
      PLAN,
      1,
      seeded(),
      undefined,
      spatial(),
    );
    expect(step.events.some((event) => event.kind === 'hit')).toBe(false);
    expect(step.events).toContainEqual(
      expect.objectContaining({ kind: 'move', actor: CHARACTER_ACTOR }),
    );
    expect(step.state.position).toEqual(at(2, 2));
  });

  it('SPC2: the Character fights what is IN REACH, not what is first in the array', () => {
    // The regression this group exists for. Creature `a` is behind a doorway
    // that creature `b` is standing in, so there is no path to `a` at all. The
    // old rule — lowest index, always — left the Character standing still
    // being bitten by `b` until the run ran out of clock.
    const before = state({
      position: at(2, 2),
      creatures: [rat('a', at(5, 2)), rat('b', at(3, 2))],
    });
    const step = simulateHunt(before, PROFILE, PLAN, 1, seeded(), undefined, spatial());

    expect(step.events.filter((event) => event.kind === 'move')).toHaveLength(0);
    const hits = step.events.filter((event) => event.kind === 'hit');
    expect(hits).toHaveLength(1);
    expect(step.state.creatures[1]!.health).toBeLessThan(RAT.maxHealth);
    expect(step.state.creatures[0]!.health).toBe(RAT.maxHealth);
  });

  it('SPC3: reach decides the candidates, INDEX still decides between them', () => {
    // Both are adjacent, so the lowest index is hit — space narrows the set,
    // it never reorders it.
    const step = simulateHunt(
      state({ position: at(2, 2), creatures: [rat('a', at(2, 1)), rat('b', at(2, 3))] }),
      PROFILE,
      PLAN,
      1,
      seeded(),
      undefined,
      spatial(),
    );
    expect(step.state.creatures[0]!.health).toBeLessThan(RAT.maxHealth);
    expect(step.state.creatures[1]!.health).toBe(RAT.maxHealth);
  });

  it('SPC4: nothing unreachable stops the run — a blocked fight still finishes', () => {
    // The end-to-end shape of the same bug: with the doorway held, the run must
    // still reach a cleared room instead of stalling forever.
    const held = state({
      position: at(2, 2),
      creatures: [rat('a', at(5, 2)), rat('b', at(3, 2))],
    });
    const step = simulateHunt(held, PROFILE, PLAN, 400, seeded(), undefined, spatial());
    expect(step.state.ended).toBeNull();
    expect(step.roomsCleared).toBeGreaterThan(0);
  });

  it('SPC5: two actors never stand on one tile', () => {
    const step = simulateHunt(
      state({
        position: at(1, 2),
        creatures: [rat('a', at(5, 1)), rat('b', at(5, 3)), rat('c', at(5, 2))],
      }),
      PROFILE,
      PLAN,
      60,
      seeded(),
      undefined,
      spatial(),
    );
    const tiles = [
      step.state.position!,
      ...step.state.creatures.filter((creature) => creature.health > 0).map((c) => c.position!),
    ];
    const unique = new Set(tiles.map((tile) => `${tile.x},${tile.y},${tile.z}`));
    expect(unique.size).toBe(tiles.length);
  });

  it('SPC6: the same state and the same seed produce the same positions', () => {
    const before = state({
      position: at(1, 2),
      creatures: [rat('a', at(5, 1)), rat('b', at(5, 3))],
    });
    const once = simulateHunt(before, PROFILE, PLAN, 50, seeded(), undefined, spatial());
    const twice = simulateHunt(before, PROFILE, PLAN, 50, seeded(), undefined, spatial());
    expect(JSON.stringify(twice.state)).toBe(JSON.stringify(once.state));
    expect(JSON.stringify(twice.events)).toBe(JSON.stringify(once.events));
  });

  it('SPC7: a reload mid-movement resumes the identical future', () => {
    // A settlement boundary can fall in the middle of an approach. What must
    // survive it is the STATE: a Character halfway across a room, a creature
    // with a leg in flight, ids that are still the same actors. The engine is
    // pure, so "resumes identically" means the state that came back from the
    // database produces the same next span as the one that never left memory.
    const before = state({
      position: at(1, 2),
      creatures: [rat('a', at(5, 1)), rat('b', at(5, 3))],
    });
    const first = simulateHunt(before, PROFILE, PLAN, 6, seeded(), undefined, spatial());
    expect(first.state.leg).toBeDefined();

    const reloaded = JSON.parse(JSON.stringify(first.state)) as HuntState;
    expect(reloaded).toEqual(first.state); // nothing unserializable leaked into it

    const resumed = simulateHunt(reloaded, PROFILE, PLAN, 20, seeded(), undefined, spatial());
    const continued = simulateHunt(first.state, PROFILE, PLAN, 20, seeded(), undefined, spatial());
    expect(JSON.stringify(resumed.state)).toBe(JSON.stringify(continued.state));
    expect(JSON.stringify(resumed.events)).toBe(JSON.stringify(continued.events));
  });

  it('SPC8: with no map, the simulator is exactly what Phase 2 verified', () => {
    const before = state({ creatures: [] });
    const step = simulateHunt(before, PROFILE, PLAN, 30, seeded());
    expect(step.state.position).toBeUndefined();
    expect(step.state.leg).toBeUndefined();
    expect(step.events.some((event) => event.kind === 'move')).toBe(false);
    expect(Object.keys(step.state.creatures[0] ?? {})).toEqual(['key', 'health', 'nextAttackTick']);
  });
});
