/**
 * Phase 3.6 §16 — SPD, GRD, BRK and PTH. What a step costs, and why.
 *
 * Phase 3.5 imported the curve and the beat; this group is about the two
 * inputs that were still constants. A step's duration now depends on WHO is
 * walking (the Character's own speed, which grows with level) and on WHAT they
 * are standing on (the ground's authored speed) — and those two together are
 * the whole of the "bugging speed" phenomenon, which is a staircase produced
 * by 50 ms quantization and not a state anything sets.
 *
 * Every expected number below is worked out FROM THE SOURCE FORMULA BY HAND in
 * the comment beside it. A test that computed its expectation by calling the
 * function under test would agree with any bug that function had.
 */
import { describe, expect, it } from 'vitest';
import {
  BEAT_MS,
  DEFAULT_GROUND_SPEED,
  DIAGONAL_STEP_FACTOR,
  MAX_GROUND_SPEED,
  MAX_STEP_DURATION_MS,
  MapError,
  PLAYER_MIN_STEP_SPEED,
  SLOWEST_CHARACTER_STEP_SPEED,
  StepDurationError,
  calculatedStepSpeed,
  compileMap,
  createSeededRandom,
  groundSpeedAt,
  meleeGoals,
  playerBaseStepSpeed,
  simulateHunt,
  stepDurationMs,
  stepToward,
  supportedStepDurationMs,
  type CombatProfile,
  type CreatureStats,
  type HuntState,
  type MapSource,
  type RoomPlan,
  type SpatialPlan,
} from '@global-idle/game-engine';

import { CONTENT_MAX_GROUND_SPEED } from '@global-idle/game-data';

const at = (x: number, y: number, z = 7) => ({ x, y, z });

/** A map whose every symbol is authored, so nothing is accidental. */
const mapOf = (rows: readonly string[], legend: MapSource['legend']): MapSource => ({
  key: 'map.test',
  z: 7,
  rows,
  legend,
  entry: { x: 1, y: 1 },
  regions: [
    {
      id: 'only',
      rect: [1, 1, rows[0]!.length - 2, rows.length - 2],
      room: 1,
      spawns: [{ x: 1, y: 1 }],
    },
  ],
});

describe('§16 SPD — an actor’s own speed', () => {
  it('SPD1: the source constants reproduce known step durations', () => {
    /**
     * By hand, from `Creature::updateCalculatedStepSpeed` and
     * `Creature::getStepDuration`:
     *
     *   speed 110:  ln(371.29) = 5.916977
     *               857.36 × 5.916977 = 5072.98
     *               5072.98 − 4795.01 + 0.5 = 278.47  ->  floor 278
     *               floor(1000 × 150 / 278) = floor(539.56) = 539
     *               ceil(539 / 50) × 50 = 550
     *
     *   speed 67 (a Rat):
     *               ln(328.29) = 5.794
     *               857.36 × 5.794 = 4967.6
     *               4967.6 − 4795.01 + 0.5 = 173.1   ->  floor 173
     *               floor(150000 / 173) = 867  ->  900
     */
    expect(stepDurationMs(110)).toBe(550);
    expect(stepDurationMs(67)).toBe(900);
    // The default parameter IS the source's fallback, not a coincidence.
    expect(stepDurationMs(110, DEFAULT_GROUND_SPEED)).toBe(550);
    expect(DEFAULT_GROUND_SPEED).toBe(150);
  });

  it('SPD2: a level-1 Character walks at raw speed 110', () => {
    expect(playerBaseStepSpeed(1)).toBe(110);
    expect(stepDurationMs(playerBaseStepSpeed(1))).toBe(550);
  });

  it('SPD3: raw speed rises by exactly one per level', () => {
    for (const [level, speed] of [
      [1, 110],
      [2, 111],
      [8, 117],
      [20, 129],
      [50, 159],
      [100, 209],
      [200, 309],
      [500, 609],
      [1000, 1109],
    ] as const) {
      expect(playerBaseStepSpeed(level), `level ${level}`).toBe(speed);
    }
  });

  it('SPD4: every vocation, and none, sources to base speed 110', () => {
    // `data/XML/vocations.xml` at the pinned commit: None, Sorcerer, Druid,
    // Paladin, Knight, Monk and every promotion all carry basespeed="110".
    // The base is a PARAMETER rather than a table because the source has
    // nothing for a table to say — inventing a spread would be a product
    // decision wearing a source's clothes.
    for (const vocationBase of [110, 110, 110, 110, 110, 110]) {
      expect(playerBaseStepSpeed(30, vocationBase)).toBe(139);
    }
    // And the parameter is real: Phase 4 can pass a different base.
    expect(playerBaseStepSpeed(30, 120)).toBe(149);
  });

  it('SPD5: a Character is clamped to the source player floor, and to uint16', () => {
    // `Player::getStepSpeed` clamps to PLAYER_MIN_SPEED = 10 before anything
    // else, which is why a Character can never reach the "do not walk" branch.
    expect(PLAYER_MIN_STEP_SPEED).toBe(10);
    expect(playerBaseStepSpeed(1, 0)).toBe(10);
    expect(playerBaseStepSpeed(1, -50)).toBe(10);
    // `baseSpeed` is a uint16_t in the source and min()'d against the max.
    expect(playerBaseStepSpeed(1_000_000)).toBe(65535);
  });

  it('SPD6: the curve’s DIVISOR floors at 1, which is not a claim about the step', () => {
    /**
     * CORRECTED in the Phase 3.6 blocker pass. This case used to be titled
     * "the curve never divides by zero, however slow the actor" and asserted
     * `stepDurationMs(1) === 150_000`. The first half was right about the
     * wrong thing and the second half was wrong outright:
     *
     *  - what `max(formula, 1.)` protects is the DIVISOR
     *    (`updateCalculatedStepSpeed`, `creature.hpp:1089-1097`). It says
     *    nothing about the duration that divisor produces;
     *  - 150,000 ms is not a duration the source can hold. `walk.duration` is
     *    a `uint16_t`, so at speed 1 on default ground Canary performs
     *    `static_cast<uint16_t>(150000.0)` — undefined behaviour, not 150,000.
     *
     * So the divisor is asserted directly, and the duration is asked on ground
     * the answer fits on. DOM1-DOM8 own the boundary itself.
     */
    // ln(262.29) = 5.5695, × 857.36 = 4775.1, − 4795.01 + 0.5 = −19.4 -> the
    // floor of 1 is what is left. Below −261.29 the branch is not taken at all.
    expect(calculatedStepSpeed(1)).toBe(1);
    expect(calculatedStepSpeed(0)).toBe(1);
    expect(calculatedStepSpeed(-1000)).toBe(1);
    // And a divisor of 1 means the duration IS the ground speed in seconds:
    // floor(1000 × 21 / 1) = 21000, already on the beat.
    expect(stepDurationMs(1, 21)).toBe(21_000);
    expect(stepDurationMs(0, 21)).toBe(21_000);
    expect(stepDurationMs(-1000, 21)).toBe(21_000);
    // Immobility is a MOVEMENT decision, not a duration: see SPC/STP for the
    // engine refusing to schedule a step at all below 1.
  });
});

/** A Rat, and a Character, reduced to what a movement case needs. */
const RAT: CreatureStats = {
  key: 'creature.rat',
  maxHealth: 20,
  experience: 5,
  attackIntervalMs: 2000,
  maxDamage: 8,
  defense: 5,
  armor: 1,
  mitigation: 0.07,
  stepSpeed: 67,
  gold: { chance: 1, min: 1, max: 4 },
};

const PROFILE: CombatProfile = {
  level: 1,
  maxHealth: 150,
  attackSkill: 10,
  attackValue: 9.6,
  attackFactor: 1,
  attackIntervalMs: 2000,
  defense: 4,
  armor: 4,
  supply: { healMin: 0, healMax: 0, useBelowPercent: 0 },
  stepSpeed: playerBaseStepSpeed(1),
};

const PLAN: RoomPlan = {
  creatures: { 'creature.rat': RAT },
  rooms: [{ number: 1, creatures: [{ key: 'creature.rat', count: 1 }], endless: true }],
};

function spatial(source: MapSource): SpatialPlan {
  const map = compileMap(source);
  const only = map.regions[0]!;
  return { map, regionFor: () => only };
}

function state(over: Partial<HuntState>): HuntState {
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

/** The first step the Character commits to, with its authoritative timing. */
function firstStep(
  source: MapSource,
  from: { x: number; y: number },
  target: { x: number; y: number },
) {
  const step = simulateHunt(
    state({
      position: at(from.x, from.y),
      creatures: [
        {
          key: 'creature.rat',
          health: RAT.maxHealth,
          nextAttackTick: 9999,
          id: 'creature.rat:only:c0:s0',
          position: at(target.x, target.y),
        },
      ],
    }),
    PROFILE,
    PLAN,
    2,
    createSeededRandom('grd'),
    undefined,
    spatial(source),
  );
  const move = step.events.find((event) => event.kind === 'move' && event.actor === 'character');
  if (!move || move.kind !== 'move') throw new Error('the Character never stepped');
  return move;
}

describe('§16 GRD — the ground an actor departs from', () => {
  const SIMPLE = ['#####', '#...#', '#####'] as const;

  it('GRD1: a tile that authors nothing uses the source fallback', () => {
    const map = compileMap(mapOf(SIMPLE, { '#': 'wall', '.': 'floor' }));
    expect(groundSpeedAt(map, at(1, 1))).toBe(150);
    expect(groundSpeedAt(map, at(2, 1))).toBe(150);
    // Off the map, and on another floor, answer the fallback rather than throw.
    expect(groundSpeedAt(map, at(99, 99))).toBe(150);
    expect(groundSpeedAt(map, at(1, 1, 6))).toBe(150);
  });

  it('GRD2: an authored ground speed compiles per tile', () => {
    // 50, 100, 150, 200 and 850 are real values from the client appearance
    // data at the pinned commit, not invented ones (source map §3.1).
    const map = compileMap(
      mapOf(['######', '#.fs~#', '######'], {
        '#': 'wall',
        '.': 'floor',
        f: { kind: 'floor', groundSpeed: 50 },
        s: { kind: 'floor', groundSpeed: 850 },
        '~': { kind: 'water', groundSpeed: 200 },
      }),
    );
    expect(groundSpeedAt(map, at(1, 1))).toBe(150);
    expect(groundSpeedAt(map, at(2, 1))).toBe(50);
    expect(groundSpeedAt(map, at(3, 1))).toBe(850);
    expect(groundSpeedAt(map, at(4, 1))).toBe(200);
    // The long spelling without a speed is exactly the short one.
    const plain = compileMap(mapOf(SIMPLE, { '#': { kind: 'wall' }, '.': { kind: 'floor' } }));
    expect(groundSpeedAt(plain, at(1, 1))).toBe(150);
  });

  it('GRD3: the leg is timed by the tile it LEAVES, not the one it enters', () => {
    /**
     * `Creature::setParent` caches `walk.groundSpeed` from the tile the
     * creature is placed on, and `getStepDuration` divides by that cache. So
     * the mud you are standing in is what slows the step OUT of it, and
     * stepping onto stone does not make that step fast.
     *
     * Two maps, mirror images. The Character starts on the same tile index in
     * both and walks the same direction; only which side is fast changes.
     *
     *   speed 110 on ground 50  -> 200 ms
     *   speed 110 on ground 850 -> 3100 ms
     */
    const fastThenSlow = mapOf(['######', '#fs..#', '######'], {
      '#': 'wall',
      '.': 'floor',
      f: { kind: 'floor', groundSpeed: 50 },
      s: { kind: 'floor', groundSpeed: 850 },
    });
    const slowThenFast = mapOf(['######', '#sf..#', '######'], {
      '#': 'wall',
      '.': 'floor',
      f: { kind: 'floor', groundSpeed: 50 },
      s: { kind: 'floor', groundSpeed: 850 },
    });

    // Departing (1,1) toward a Rat at (4,1): the step is east, onto (2,1).
    const leavingFast = firstStep(fastThenSlow, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(leavingFast.to).toEqual(at(2, 1));
    expect(leavingFast.arrivesAtMs - leavingFast.startsAtMs).toBe(200);

    const leavingSlow = firstStep(slowThenFast, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(leavingSlow.to).toEqual(at(2, 1));
    expect(leavingSlow.arrivesAtMs - leavingSlow.startsAtMs).toBe(3100);

    // Same destination tile in neither case decided it — the two runs step
    // onto tiles of OPPOSITE speed and the durations follow the origin.
    expect(groundSpeedAt(compileMap(fastThenSlow), at(2, 1))).toBe(850);
    expect(groundSpeedAt(compileMap(slowThenFast), at(2, 1))).toBe(50);
  });

  it('GRD4: a lower ground speed is a SHORTER step, a higher one longer', () => {
    // The duration is proportional to the ground speed — `1000 × groundSpeed
    // / calculatedStepSpeed` — so the number reads backwards on purpose.
    const speed = playerBaseStepSpeed(1);
    expect(stepDurationMs(speed, 50)).toBe(200);
    expect(stepDurationMs(speed, 100)).toBe(400);
    expect(stepDurationMs(speed, 150)).toBe(550);
    expect(stepDurationMs(speed, 200)).toBe(750);
    expect(stepDurationMs(speed, 850)).toBe(3100);
    // Monotonic across the whole authored range, not just at those points.
    let previous = 0;
    for (let ground = 50; ground <= 900; ground += 25) {
      const duration = stepDurationMs(speed, ground);
      expect(duration).toBeGreaterThanOrEqual(previous);
      previous = duration;
    }
  });

  it('GRD5: the lookup is a compiled array, not a parse', () => {
    const map = compileMap(
      mapOf(['####', '#.f#', '####'], {
        '#': 'wall',
        '.': 'floor',
        f: { kind: 'floor', groundSpeed: 100 },
      }),
    );
    // One Uint16 per tile, dense, indexed exactly like `flags` and `kind`.
    expect(map.groundSpeed).toBeInstanceOf(Uint16Array);
    expect(map.groundSpeed).toHaveLength(map.width * map.height);
    expect(map.groundSpeed[1 * map.width + 2]).toBe(100);
    // Even a wall carries a value, so the read is an index and never a branch.
    expect(map.groundSpeed[0]).toBe(150);
  });

  it('GRD6: an impossible ground speed is refused at build time, by symbol', () => {
    const bad = (groundSpeed: unknown) =>
      compileMap(
        mapOf(['####', '#.f#', '####'], {
          '#': 'wall',
          '.': 'floor',
          f: { kind: 'floor', groundSpeed: groundSpeed as number },
        }),
      );
    for (const value of [
      0,
      -1,
      -150,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_GROUND_SPEED + 1,
    ]) {
      expect(() => bad(value), String(value)).toThrow(MapError);
      expect(() => bad(value), String(value)).toThrow(/legend 'f' has groundSpeed/);
    }
    // Those are REPRESENTATION failures: a number `uint16_t iType.speed`
    // (`items.cpp:230`) could not have held. The largest it CAN hold is
    // MAX_GROUND_SPEED, and that is where this case used to stop — asserting
    // that 65535 compiled. It does not, and DOM6 is why: a ground speed the
    // source can store is not automatically one an actor can walk. The two
    // refusals are deliberately different sentences.
    expect(() => bad(MAX_GROUND_SPEED)).toThrow(/nobody could walk/);
    expect(() => bad(MAX_GROUND_SPEED + 1)).toThrow(/whole number from 1 to/);
  });

  it('GRD7: the diagonal factor multiplies the ALREADY-ROUNDED base', () => {
    /**
     * The source multiplies the cached `walk.duration`, which has already been
     * rounded up to the beat (`creature.cpp:1700-1703`). Doing it the other
     * way round is a different number, and this pins which one:
     *
     *   speed 110, ground 150 -> base 550   -> diagonal 1650
     *   rounding AFTER the multiply would be ceil(539 × 3 / 50) × 50 = 1650
     *   speed 110, ground 100 -> base 400   -> diagonal 1200
     *   rounding after would be ceil(359 × 3 / 50) × 50 = 1100  <- different
     */
    expect(stepDurationMs(110, 150) * DIAGONAL_STEP_FACTOR).toBe(1650);
    expect(stepDurationMs(110, 100) * DIAGONAL_STEP_FACTOR).toBe(1200);
    const roundedAfterTheMultiply = Math.ceil((Math.floor((1000 * 100) / 278) * 3) / 50) * 50;
    expect(roundedAfterTheMultiply).toBe(1100);
    expect(stepDurationMs(110, 100) * DIAGONAL_STEP_FACTOR).not.toBe(roundedAfterTheMultiply);
  });
});

describe('§16 BRK — the staircase 50 ms quantization makes', () => {
  it('BRK1: more raw speed inside one plateau changes nothing', () => {
    // Levels 1 through 8 on default ground are all 550 ms: the calculated
    // speed climbs 278 -> 294 while floor(150000 / c) stays inside 500..549.
    for (let level = 1; level <= 8; level += 1) {
      expect(stepDurationMs(playerBaseStepSpeed(level)), `level ${level}`).toBe(550);
    }
  });

  it('BRK2: crossing a breakpoint changes it, and by a whole beat', () => {
    // Level 10 (speed 119) still costs 550: ln(380.29) = 5.94093, × 857.36 =
    // 5093.51, − 4795.01 + 0.5 = 299.0 -> 299, floor(150000 / 299) = 501 ->
    // 550. Level 11 (speed 120) is the first that drops: 301 -> floor(150000
    // / 301) = 498 -> 500. The bands on default ground begin at levels
    // 1, 11, 26, 46, 72, 110, 169 and 271.
    const durations = new Map<number, number>();
    for (let level = 1; level <= 60; level += 1) {
      durations.set(level, stepDurationMs(playerBaseStepSpeed(level)));
    }
    const drops = [...durations.entries()].filter(
      ([level, duration]) => level > 1 && duration < durations.get(level - 1)!,
    );
    // A staircase: several distinct steps, each exactly one beat or more.
    expect(drops.map(([level]) => level)).toEqual([11, 26, 46]);
    expect(drops.length).toBeGreaterThan(1);
    for (const [level, duration] of drops) {
      const previous = durations.get(level - 1)!;
      expect((previous - duration) % 50, `level ${level}`).toBe(0);
    }
    // And the whole range really does move: 550 at level 1, 400 by level 50.
    expect(durations.get(1)).toBe(550);
    expect(durations.get(50)).toBe(400);
  });

  it('BRK3: the same Character sits on different steps on different ground', () => {
    // Level 8 has not moved off 550 on default ground, but on faster ground
    // it has ALREADY crossed a breakpoint that level 1 had not:
    //   level 1, ground 100 -> floor(100000/278) = 359 -> 400
    //   level 8, ground 100 -> floor(100000/294) = 340 -> 350
    expect(stepDurationMs(playerBaseStepSpeed(1), 150)).toBe(550);
    expect(stepDurationMs(playerBaseStepSpeed(8), 150)).toBe(550);
    expect(stepDurationMs(playerBaseStepSpeed(1), 100)).toBe(400);
    expect(stepDurationMs(playerBaseStepSpeed(8), 100)).toBe(350);

    // And slow ground keeps limiting a high-level Character: level 200 is
    // still 1350 ms a step on ground 850. (850 is a real authored value but
    // NOT the slowest: the pinned appearance data also carries 1000 and 1200,
    // which the source map's §3.1 table originally omitted — corrected there.)
    expect(stepDurationMs(playerBaseStepSpeed(200), 850)).toBe(1350);
    expect(stepDurationMs(playerBaseStepSpeed(200), 150)).toBe(250);

    // The floor of the whole system is ONE BEAT. That is what "bugging speed"
    // bottoms out at — not a state, just the quantization running out of room.
    expect(stepDurationMs(playerBaseStepSpeed(500), 50)).toBe(50);
    expect(stepDurationMs(playerBaseStepSpeed(5000), 50)).toBe(50);
  });
});

describe('§16 PTH — the route is still chosen the source’s way', () => {
  // PTH CONTINUES Phase 3.5's numbering rather than restarting it: that phase
  // owns PTH1-PTH15 and an id means one case, across the whole project.
  it('PTH16: ground speed is not a term in the A* cost', () => {
    /**
     * Two legal routes from (1,2) to a goal beside (5,2): straight across the
     * middle, or a detour along the top. The middle is mud (ground 850) and
     * the detour is stone (ground 50), so the detour is far FASTER in real
     * travel time — and the source's A* does not know that. `getMapWalkCost`
     * is topology only, `getTileWalkCost` adds creatures and fields, and
     * neither reads `ItemType::speed`.
     *
     * Ground speed decides how long a step TAKES; it is not what a route COSTS.
     */
    const source = mapOf(['#######', '#fffff#', '#mmmmm#', '#######'], {
      '#': 'wall',
      f: { kind: 'floor', groundSpeed: 50 },
      m: { kind: 'floor', groundSpeed: 850 },
    });
    const map = compileMap(source);
    const target = at(5, 2);
    const nothingBlocked = () => false;
    const goals = meleeGoals(map, target, nothingBlocked);
    const first = stepToward(map, at(1, 2), goals, nothingBlocked);

    // The cheapest route by the source's cost stays on the mud row: a straight
    // cardinal run. Going up to the fast row and back costs two extra steps.
    expect(first).toEqual(at(2, 2));
    // Prove the temptation was real: the fast row would have been quicker.
    expect(stepDurationMs(110, 850)).toBeGreaterThan(stepDurationMs(110, 50) * 3);
  });
});

/**
 * §16 DOM — the supported movement domain.
 *
 * Added by the Phase 3.6 blocker correction. Everything above says what a step
 * costs; this group says where that answer is the SOURCE'S answer and what
 * happens outside, because `Creature::getStepDuration` returns a `uint16_t`
 * and Phase 3.6 originally asserted a 150,000 ms step against its 65,535 ms.
 *
 * The numbers here are worked out from the source arithmetic by hand, the same
 * rule the rest of the file follows.
 */
describe('§16 DOM — where the source’s answer is still the source’s', () => {
  it('DOM1: the ceiling is the source’s uint16, and it binds in TWO places', () => {
    /**
     * Verified at the pinned commit rather than assumed, because "the cached
     * value only" is the tempting reading and it is wrong:
     *
     *   walk.duration = static_cast<uint16_t>(ceil(duration / SERVER_BEAT) * SERVER_BEAT);
     *   auto duration = walk.duration;                    // uint16_t
     *   if (diagonal) duration *= WALK_DIAGONAL_EXTRA_COST;
     *   return duration;                                  // uint16_t
     *
     * The first narrows a `double` — undefined behaviour above the range. The
     * second narrows the PRODUCT back into the same 16 bits, a defined modular
     * wrap. Both are the ceiling, and each has its own sentence.
     */
    expect(MAX_STEP_DURATION_MS).toBe(65535);

    const cardinalRefusal = (): number => stepDurationMs(1, 66);
    const diagonalRefusal = (): number => stepDurationMs(1, 22, DIAGONAL_STEP_FACTOR);
    expect(cardinalRefusal).toThrow(StepDurationError);
    expect(diagonalRefusal).toThrow(StepDurationError);
    expect(cardinalRefusal).toThrow(/66000 ms cardinal step/);
    expect(diagonalRefusal).toThrow(/66000 ms step \(22000 ms × 3\)/);
  });

  it('DOM2: the CARDINAL boundary is exact, to the beat', () => {
    // At speed 1 the curve's divisor is 1 (SPD6), so the cardinal duration is
    // 1000 × groundSpeed exactly and the boundary can be read off:
    //   ground 65 -> 65,000 ms, inside 65,535
    //   ground 66 -> 66,000 ms, outside it
    expect(stepDurationMs(1, 65)).toBe(65_000);
    expect(() => stepDurationMs(1, 66)).toThrow(StepDurationError);
    // Every duration is a whole beat, so the largest step the source can
    // express is 65,500 — the last multiple of 50 inside 65,535 — and the next
    // one is already outside. A level-1 Character on ground 18,209 reaches it:
    //   floor(18,209,000 / 278) = 65,500 -> 65,500 (an exact multiple already)
    //   floor(18,210,000 / 278) = 65,503 -> 65,550
    expect(65_500 % BEAT_MS).toBe(0);
    expect(65_500 + BEAT_MS).toBeGreaterThan(MAX_STEP_DURATION_MS);
    expect(stepDurationMs(SLOWEST_CHARACTER_STEP_SPEED, 18_209)).toBe(65_500);
    expect(() => stepDurationMs(SLOWEST_CHARACTER_STEP_SPEED, 18_210)).toThrow(StepDurationError);
  });

  it('DOM3: the DIAGONAL boundary is a different, tighter one', () => {
    // A cardinal that fits can still have a diagonal that does not — this is
    // the case the reviewer asked to be checked rather than assumed:
    //   ground 21 -> 21,000 cardinal, 63,000 diagonal    both inside
    //   ground 22 -> 22,000 cardinal, 66,000 diagonal    cardinal ONLY
    expect(stepDurationMs(1, 21)).toBe(21_000);
    expect(stepDurationMs(1, 21, DIAGONAL_STEP_FACTOR)).toBe(63_000);
    expect(stepDurationMs(1, 22)).toBe(22_000);
    expect(() => stepDurationMs(1, 22, DIAGONAL_STEP_FACTOR)).toThrow(StepDurationError);
    // The tighter bound is exactly a third of the looser one, rounded to the
    // beat: 21,845 is the largest third, and 21,800 the largest one on a beat.
    expect(21_800 * DIAGONAL_STEP_FACTOR).toBeLessThanOrEqual(MAX_STEP_DURATION_MS);
    expect(21_850 * DIAGONAL_STEP_FACTOR).toBeGreaterThan(MAX_STEP_DURATION_MS);
  });

  it('DOM4: outside the domain it REFUSES — it does not clamp and does not wrap', () => {
    /**
     * The two numbers a lazy fix would have produced, and neither is returned:
     *
     *  - a clamp gives 65,535 ms, which the source never produces;
     *  - the source's own narrowing gives (21850 × 3) mod 65536 = 14 ms, a
     *    diagonal EIGHT HUNDRED times faster than cardinal. Reproducing it
     *    would be copying a defect and calling it fidelity.
     */
    let thrown: unknown;
    try {
      stepDurationMs(SLOWEST_CHARACTER_STEP_SPEED, 6061, DIAGONAL_STEP_FACTOR);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StepDurationError);
    const error = thrown as StepDurationError;
    // It carries the TRUE duration, unnarrowed, so a reader can see the size
    // of the problem: ground 6061 at speed 110 is 21,850 ms × 3.
    expect(error.durationMs).toBe(65_550);
    expect(error.stepSpeed).toBe(110);
    expect(error.groundSpeed).toBe(6061);
    expect(error.stepCost).toBe(DIAGONAL_STEP_FACTOR);
    // Not the clamp, and not the wrap.
    expect(error.durationMs).not.toBe(MAX_STEP_DURATION_MS);
    expect(error.durationMs % 65_536).toBe(14);
    expect(supportedStepDurationMs(110, 6061, DIAGONAL_STEP_FACTOR)).toBeNull();
  });

  it('DOM5: asking is the same arithmetic as demanding, minus the refusal', () => {
    // One implementation, two faces. `supportedStepDurationMs` answers null
    // exactly where `stepDurationMs` throws, and the identical number where it
    // does not — so content can ask the question without catching anything and
    // the limit still lives in one place.
    for (const speed of [1, 10, 15, 67, 110, 300, 1000, 65_535]) {
      for (const ground of [1, 21, 22, 65, 66, 150, 850, 1200, 6060, 6061, MAX_GROUND_SPEED]) {
        for (const cost of [1, DIAGONAL_STEP_FACTOR]) {
          const asked = supportedStepDurationMs(speed, ground, cost);
          if (asked === null) {
            expect(() => stepDurationMs(speed, ground, cost), `${speed}/${ground}/${cost}`).toThrow(
              StepDurationError,
            );
          } else {
            expect(stepDurationMs(speed, ground, cost), `${speed}/${ground}/${cost}`).toBe(asked);
            expect(asked).toBeLessThanOrEqual(MAX_STEP_DURATION_MS);
          }
        }
      }
    }
  });

  it('DOM6: a ground speed nobody could walk is refused when the MAP compiles', () => {
    const withGround = (groundSpeed: number) =>
      compileMap(
        mapOf(['####', '#.f#', '####'], {
          '#': 'wall',
          '.': 'floor',
          f: { kind: 'floor', groundSpeed },
        }),
      );
    /**
     * The yardstick is the slowest Character the game can produce — level 1 at
     * the vocation base, speed 110, divisor 278 — taking the most expensive
     * step there is:
     *
     *   ground 6060 -> floor(6,060,000 / 278) = 21,798 -> 21,800 × 3 = 65,400
     *   ground 6061 -> floor(6,061,000 / 278) = 21,802 -> 21,850 × 3 = 65,550
     *
     * so 6060 compiles and 6061 does not. Ground no Character can walk is
     * ground nobody can, and a map is the last moment that is cheap to say.
     */
    expect(SLOWEST_CHARACTER_STEP_SPEED).toBe(110);
    expect(() => withGround(6060)).not.toThrow();
    expect(() => withGround(6061)).toThrow(MapError);
    expect(() => withGround(6061)).toThrow(/nobody could walk/);
    // And the check is the SAME authority the engine uses, not a second rule.
    expect(supportedStepDurationMs(SLOWEST_CHARACTER_STEP_SPEED, 6060, DIAGONAL_STEP_FACTOR)).toBe(
      65_400,
    );
    expect(
      supportedStepDurationMs(SLOWEST_CHARACTER_STEP_SPEED, 6061, DIAGONAL_STEP_FACTOR),
    ).toBeNull();
    // The Content context cannot import the engine (§5.2), so it states the
    // REPRESENTATION bound itself. This is the only thing holding the two
    // copies of that one number together, and it is not a movement rule:
    // 65535 is what a `uint16_t` ground speed can be, and 6061 is what an
    // actor can walk. Content owns the first; the engine owns the second.
    expect(CONTENT_MAX_GROUND_SPEED).toBe(MAX_GROUND_SPEED);
  });

  it('DOM7: the beat floor is an ADAPT, and the source’s alternative is a freeze', () => {
    /**
     * At the FAST end the source's arithmetic reaches zero:
     *
     *   speed 1000 -> divisor 1326;  floor(1000 × 1 / 1326) = 0
     *
     * and `walk.duration = 0` makes `needRecache()` (`creature.hpp:1081`)
     * permanently true, so `getStepDuration` keeps returning 0,
     * `getEventStepTicks` returns 0 and `addEventWalk` declines to schedule
     * anything: that creature stops walking for good. Ground speed 1 is real —
     * 120 appearances carry it — so this is reachable, not hypothetical.
     *
     * Global Idle issues one beat instead. A step is not a state; refusing to
     * move forever is not a speed. DELIBERATE DIVERGENCE, recorded as ADAPT in
     * the source map, and it is a floor rather than a ceiling so it can never
     * hide an unrepresentable number.
     */
    expect(calculatedStepSpeed(1000)).toBe(1326);
    expect(Math.floor((1000 * 1) / 1326)).toBe(0);
    expect(stepDurationMs(1000, 1)).toBe(BEAT_MS);
    // And one beat is genuinely the floor, from every direction.
    for (const speed of [600, 1000, 5000, 65_535]) {
      expect(stepDurationMs(speed, 1), `speed ${speed}`).toBe(BEAT_MS);
    }
  });

  it('DOM8: every ground the client data authors is inside the domain', () => {
    /**
     * The refusal must be unreachable from real content, or it is a bug rather
     * than a guard. Every `bank.waypoints` value in the pinned
     * `data/items/appearances.dat` (source map §3.1), against every Character
     * level from 1 to 2000, cardinal and diagonal.
     */
    const authored = [
      1, 50, 70, 90, 95, 100, 110, 115, 120, 121, 125, 130, 140, 150, 160, 170, 180, 200, 250, 260,
      300, 350, 400, 450, 500, 800, 850, 1000, 1200,
    ];
    let worst = 0;
    for (const ground of authored) {
      for (let level = 1; level <= 2000; level += 1) {
        const speed = playerBaseStepSpeed(level);
        for (const cost of [1, DIAGONAL_STEP_FACTOR]) {
          const duration = supportedStepDurationMs(speed, ground, cost);
          expect(duration, `ground ${ground}, level ${level}, cost ${cost}`).not.toBeNull();
          worst = Math.max(worst, duration!);
        }
      }
    }
    // The worst case in the whole reachable space is a level-1 Character
    // taking a diagonal on the slowest authored ground: 4350 × 3.
    expect(worst).toBe(13_050);
    expect(stepDurationMs(playerBaseStepSpeed(1), 1200, DIAGONAL_STEP_FACTOR)).toBe(13_050);
    // 1200 is the real maximum; 850 is NOT, which §3.1 of the source map
    // originally said and this case is the reason it was corrected.
    expect(Math.max(...authored)).toBe(1200);
  });
});
