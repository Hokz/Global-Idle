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
  BEAT_MS,
  CHARACTER_ACTOR,
  DIAGONAL_STEP_FACTOR,
  TICK_MS,
  compileMap,
  createSeededRandom,
  simulateHunt,
  stepDurationMs,
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
  // `monster.speed` for a Rat (`data-otservbr-global/monster/mammals/rat.lua`).
  stepSpeed: 67,
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
  // `vocation basespeed + (level - 1)` — 110 at level 1, so 550 ms a step
  // against the Rat's 900. The Character is faster than what chases it.
  stepSpeed: 111,
};

const PLAN: RoomPlan = {
  creatures: { 'creature.rat': RAT },
  rooms: [
    { number: 1, creatures: [{ key: 'creature.rat', count: 2 }], endless: false },
    { number: 2, creatures: [{ key: 'creature.rat', count: 2 }], endless: true },
  ],
};

const at = (x: number, y: number): TilePosition => ({ x, y, z: 7 });

/** Chebyshev one, stated here so a timing case does not import a rule. */
const isAdjacentTiles = (a: TilePosition, b: TilePosition): boolean =>
  a.z === b.z && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;

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
    // One tick in, the Character is mid-step: it left at 50 ms, arrived at
    // 600, and left again — so the boundary falls inside a leg, which is the
    // case a settlement has to survive.
    const first = simulateHunt(before, PROFILE, PLAN, 1, seeded(), undefined, spatial());
    expect(first.state.movement).toBeDefined();
    expect(first.state.movement!.arrivesAtMs).toBeGreaterThan(first.state.tick * TICK_MS);

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

  it('SPC9: clearing a room moves the fight into the NEXT chamber', () => {
    // The progression this phase is for: room 2 is not a counter, it is a
    // place. The Character clears the west chamber, the next encounter spawns
    // in the east one, and getting there is a walk through the doorway.
    const step = simulateHunt(
      state({ position: at(2, 2), creatures: [rat('a', at(2, 1)), rat('b', at(2, 3))] }),
      PROFILE,
      PLAN,
      400,
      seeded(),
      undefined,
      spatial(),
    );
    expect(step.roomsCleared).toBeGreaterThan(0);
    expect(step.state.room).toBe(2);
    // Spawned in the EAST region, which is what room 2 names.
    for (const creature of step.state.creatures) {
      expect(creature.id).toContain(':east:');
      expect(creature.position!.x).toBeGreaterThanOrEqual(4);
    }
    // And the Character went through the one-tile doorway to get to them.
    expect(step.events.some((event) => event.kind === 'move')).toBe(true);
  });

  it('SPC10: the endless room cycles in place, with a new cycle of actors', () => {
    const first = simulateHunt(
      state({ room: 2, position: at(5, 2), creatures: [] }),
      PROFILE,
      PLAN,
      1200,
      seeded(),
      undefined,
      spatial(),
    );
    expect(first.state.room).toBe(2);
    expect(first.state.cycle).toBeGreaterThan(1);
    // The room never advances past the endless one, and the run-local ids
    // carry the cycle — so a renderer never confuses cycle 3's rat with
    // cycle 2's, and neither does a reload.
    for (const creature of first.state.creatures) {
      expect(creature.id).toContain(`:c${first.state.cycle}:`);
    }
  });
});

describe('§20 RND — space spends no randomness', () => {
  // The claim this group defends: a spatial decision is a RULE, not a roll.
  // If walking consumed draws, the fight after it would differ for a reason
  // that had nothing to do with the fight — and a reload that re-walked the
  // same path would produce a different battle.
  const approach = () =>
    state({ position: at(1, 2), creatures: [rat('a', at(5, 1)), rat('b', at(5, 3))] });

  it('RND1: a different seed changes the fight and not one tile', () => {
    const one = simulateHunt(
      approach(),
      PROFILE,
      PLAN,
      12,
      createSeededRandom('seed-one'),
      undefined,
      spatial(),
    );
    const other = simulateHunt(
      approach(),
      PROFILE,
      PLAN,
      12,
      createSeededRandom('seed-two'),
      undefined,
      spatial(),
    );
    expect(other.state.position).toEqual(one.state.position);
    expect(other.state.creatures.map((creature) => creature.position)).toEqual(
      one.state.creatures.map((creature) => creature.position),
    );
    expect(other.events.filter((event) => event.kind === 'move')).toEqual(
      one.events.filter((event) => event.kind === 'move'),
    );
  });

  it('RND2: a span spent walking consumes no draws at all', () => {
    // One tick of approach from the far side of the room: nobody is in reach
    // at either end of it, so nobody rolls anything.
    const step = simulateHunt(approach(), PROFILE, PLAN, 1, seeded(), undefined, spatial());
    expect(step.events.some((event) => event.kind === 'move')).toBe(true);
    expect(step.events.some((event) => event.kind === 'hit')).toBe(false);
    expect(step.events.some((event) => event.kind === 'taken')).toBe(false);
    expect(step.drawsConsumed).toBe(0);
  });

  it('RND3: the same exchange costs the same draws with a map and without one', () => {
    // Adjacent from the first tick, so space changes nothing about who swings.
    const beside = state({ position: at(2, 2), creatures: [rat('a', at(2, 1))] });
    const withMap = simulateHunt(beside, PROFILE, PLAN, 1, seeded(), undefined, spatial());
    const without = simulateHunt(
      state({ creatures: [{ key: 'creature.rat', health: RAT.maxHealth, nextAttackTick: 0 }] }),
      PROFILE,
      PLAN,
      1,
      seeded(),
    );
    expect(withMap.drawsConsumed).toBe(without.drawsConsumed);
    expect(withMap.state.creatures[0]!.health).toBe(without.state.creatures[0]!.health);
  });
});

describe('§20 STP — one authoritative movement timeline', () => {
  /** An open room, so geometry never gets a vote in a timing case. */
  const OPEN_ROOM: MapSource = {
    key: 'map.room',
    z: 7,
    rows: ['#######', '#.....#', '#.....#', '#.....#', '#######'],
    legend: LEGEND,
    entry: { x: 1, y: 2 },
    regions: [
      { id: 'west', rect: [1, 1, 2, 3], room: 1, spawns: [{ x: 1, y: 1 }] },
      { id: 'east', rect: [4, 1, 2, 3], room: 2, spawns: [{ x: 5, y: 1 }] },
    ],
  };

  it('STP1: a step lasts what the source says it lasts', () => {
    // `floor(1000 * groundSpeed / calculated)` rounded up to SERVER_BEAT, with
    // the log curve in between — creature.cpp:1690-1709.
    expect(stepDurationMs(110)).toBe(550);
    expect(stepDurationMs(67)).toBe(900);
    // Faster is shorter, monotonically, and never below one beat.
    expect(stepDurationMs(300)).toBeLessThan(stepDurationMs(110));
    expect(stepDurationMs(0)).toBeGreaterThanOrEqual(BEAT_MS);
    // Every duration lands on the 50 ms beat.
    for (const speed of [1, 40, 67, 110, 220, 1000]) {
      expect(stepDurationMs(speed) % BEAT_MS).toBe(0);
    }
  });

  it('STP2: an actor cannot swing from a tile it has not reached yet', () => {
    // A deliberately slow Character: it leaves at 50 ms and arrives at 1600,
    // so at the tick-1 boundary its DESTINATION is adjacent to the Rat while
    // it is not. A model that moved first and asked later would hit here.
    const slow = { ...PROFILE, stepSpeed: 40 };
    const step = simulateHunt(
      state({ position: at(1, 2), creatures: [rat('a', at(3, 2))] }),
      slow,
      PLAN,
      1,
      seeded(),
      undefined,
      spatial(OPEN_ROOM),
    );
    const flight = step.state.movement;
    expect(flight).toBeDefined();
    expect(flight!.arrivesAtMs).toBeGreaterThan(step.state.tick * TICK_MS);
    // The destination IS in reach of the Rat. The actor is not.
    expect(isAdjacentTiles(flight!.to, at(3, 2))).toBe(true);
    expect(step.state.position).toEqual(at(1, 2));
    expect(step.events.some((event) => event.kind === 'hit')).toBe(false);
  });

  it('STP3: a destination is RESERVED — no two actors ever claim one tile', () => {
    let current = state({
      position: at(1, 2),
      creatures: [rat('a', at(5, 1)), rat('b', at(5, 3)), rat('c', at(5, 2))],
    });
    for (let span = 0; span < 200 && current.ended === null; span += 1) {
      const step = simulateHunt(
        current,
        PROFILE,
        PLAN,
        1,
        createSeededRandom(`stp3:${span}`),
        undefined,
        spatial(OPEN_ROOM),
      );
      current = step.state;
      const living = current.creatures.filter((creature) => creature.health > 0);
      const tiles = [current.position!, ...living.map((creature) => creature.position!)];
      const claims = [
        ...(current.movement ? [current.movement.to] : []),
        ...living.flatMap((creature) => (creature.movement ? [creature.movement.to] : [])),
      ];
      const all = [...tiles, ...claims].map((tile) => `${tile.x},${tile.y},${tile.z}`);
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('STP4: a leg in flight describes itself completely and coherently', () => {
    const step = simulateHunt(
      state({ position: at(1, 2), creatures: [rat('a', at(5, 2))] }),
      { ...PROFILE, stepSpeed: 40 },
      PLAN,
      1,
      seeded(),
      undefined,
      spatial(OPEN_ROOM),
    );
    const flight = step.state.movement!;
    expect(flight.from).toEqual(step.state.position);
    expect(isAdjacentTiles(flight.from, flight.to)).toBe(true);
    expect(flight.startsAtMs).toBeLessThan(flight.arrivesAtMs);
    expect(flight.arrivesAtMs - flight.startsAtMs).toBe(stepDurationMs(40));
    // And the event that announced it says the same thing.
    const announced = step.events.find((event) => event.kind === 'move');
    expect(announced).toMatchObject({
      actor: CHARACTER_ACTOR,
      from: flight.from,
      to: flight.to,
      startsAtMs: flight.startsAtMs,
      arrivesAtMs: flight.arrivesAtMs,
    });
  });

  it('STP5: a settlement boundary inside a leg is not a seam', () => {
    const before = state({ position: at(1, 2), creatures: [rat('a', at(5, 2))] });
    const first = simulateHunt(
      before,
      { ...PROFILE, stepSpeed: 40 },
      PLAN,
      1,
      seeded(),
      undefined,
      spatial(OPEN_ROOM),
    );
    expect(first.state.movement).toBeDefined();

    const reloaded = JSON.parse(JSON.stringify(first.state)) as HuntState;
    expect(reloaded).toEqual(first.state);
    const resumed = simulateHunt(
      reloaded,
      { ...PROFILE, stepSpeed: 40 },
      PLAN,
      10,
      seeded(),
      undefined,
      spatial(OPEN_ROOM),
    );
    const continued = simulateHunt(
      first.state,
      { ...PROFILE, stepSpeed: 40 },
      PLAN,
      10,
      seeded(),
      undefined,
      spatial(OPEN_ROOM),
    );
    expect(JSON.stringify(resumed.state)).toBe(JSON.stringify(continued.state));
    expect(JSON.stringify(resumed.events)).toBe(JSON.stringify(continued.events));
  });

  it('STP6: movement is finer than the combat tick', () => {
    const step = simulateHunt(
      state({ position: at(1, 2), creatures: [rat('a', at(5, 2))] }),
      PROFILE,
      PLAN,
      2,
      seeded(),
      undefined,
      spatial(OPEN_ROOM),
    );
    const moves = step.events.filter((event) => event.kind === 'move');
    expect(moves.length).toBeGreaterThan(1);
    // At least one step both began and ended between two combat ticks — which
    // is the whole point of resolving movement on the 50 ms beat.
    expect(moves.some((move) => 'startsAtMs' in move && move.startsAtMs % TICK_MS !== 0)).toBe(
      true,
    );
  });

  it('STP7: a diagonal step costs three cardinal ones, in time as in the source', () => {
    // The corner map from PTH9: the only legal move out of (1,1) is diagonal.
    const corner: MapSource = {
      key: 'map.corner',
      z: 7,
      rows: ['#####', '#.#.#', '##..#', '#####'],
      legend: LEGEND,
      entry: { x: 1, y: 1 },
      regions: [{ id: 'only', rect: [1, 1, 3, 2], room: 1, spawns: [{ x: 3, y: 1 }] }],
    };
    const step = simulateHunt(
      state({ position: at(1, 1), creatures: [rat('a', at(3, 1))] }),
      PROFILE,
      PLAN,
      1,
      seeded(),
      undefined,
      spatial(corner),
    );
    const move = step.events.find((event) => event.kind === 'move');
    expect(move).toBeDefined();
    const flight = move as Extract<typeof move, { kind: 'move' }>;
    expect(flight.to).toEqual(at(2, 2));
    expect(flight.arrivesAtMs - flight.startsAtMs).toBe(
      stepDurationMs(PROFILE.stepSpeed!) * DIAGONAL_STEP_FACTOR,
    );
  });
});
