/**
 * Phase 3.6 §16 — CMP. The Hunt, the map and the creatures, together.
 *
 * `compileMap` proves a map is walkable by the slowest CHARACTER; it cannot
 * prove anything about creatures, because a map does not carry any. A Hunt
 * does. This group is about the boundary where those three facts first meet —
 * `buildHuntPlan` — and about the guarantee that the pure simulator is never
 * the component that discovers resolved content cannot be simulated.
 *
 * The arithmetic itself belongs to DOM1-DOM8 and is not re-derived here. What
 * is asserted here is WHERE the answer is demanded and WHAT it is demanded of.
 */
import { describe, expect, it } from 'vitest';
import {
  characterBaselineSchema,
  creatureSchema,
  mapSchema,
  type ResolvedBundle,
} from '@global-idle/game-data';
import { DomainError, hunt as huntContext } from '@global-idle/domain';
import {
  DIAGONAL_STEP_FACTOR,
  MAX_STEP_DURATION_MS,
  StepDurationError,
  calculatedStepSpeed,
  compileMap,
  playerBaseStepSpeed,
  stepDurationMs,
  supportedStepDurationMs,
} from '@global-idle/game-engine';

/**
 * The pair the pinned source makes real (source map §2.1, §5.1):
 * `monster.speed` 15 is the slowest thing that moves in the shipped monster
 * data, and `bank.waypoints` 1200 is the slowest authored ground in the
 * shipped appearance data. Neither is invented, and neither is rejected on its
 * own by anything.
 */
const SLOWEST_AUTHORED_SPEED = 15;
const SLOWEST_AUTHORED_GROUND = 1200;

const BASELINE = {
  key: 'character-baseline.origin',
  kind: 'character-baseline',
  references: [],
  label: 'Pre-vocation Character',
  maxHealth: 150,
  attackSkill: 10,
  attackFactor: 1,
  attackIntervalMs: 2000,
  unarmedAttackValue: 7,
  supplyUseBelowPercent: 40,
  baseSpeed: 110,
  sourceRef: 'Phase 3.6 CMP fixture; the real origin baseline’s numbers.',
};

const creature = (key: string, speed: number) => ({
  key,
  kind: 'creature',
  references: [],
  label: key,
  maxHealth: 20,
  experience: 5,
  attack: { intervalMs: 2000, maxDamage: 8 },
  defense: 5,
  armor: 1,
  mitigation: 0.07,
  speed,
  gold: { chance: 1, min: 1, max: 4 },
  loot: [],
  sourceRef: 'Phase 3.6 CMP fixture.',
});

/** A short corridor, one ground speed per authored symbol. */
const map = (key: string, legend: Record<string, unknown>, rows: readonly string[]) => ({
  key,
  kind: 'map',
  references: [],
  label: key,
  z: 7,
  rows,
  legend,
  entry: { x: 1, y: 1 },
  regions: [
    { id: 'only', rect: [1, 1, rows[0]!.length - 2, 1], room: 1, spawns: [{ x: 1, y: 1 }] },
  ],
  sourceRef: 'Phase 3.6 CMP fixture.',
});

const hunt = (
  key: string,
  mapKey: string,
  creatures: readonly { key: string; count: number }[],
) => ({
  key,
  kind: 'hunt',
  references: ['character-baseline.origin', mapKey, ...creatures.map((entry) => entry.key)],
  label: key,
  region: 'region.rookgaard',
  summary: 'Phase 3.6 CMP fixture.',
  primaryCreature: 'Rat',
  activityTypeKey: 'hunt',
  availability: 'AVAILABLE',
  characterBaseline: 'character-baseline.origin',
  map: mapKey,
  rooms: [{ number: 1, creatures: [...creatures], endless: true }],
});

/**
 * A resolved bundle, without a database.
 *
 * The version is unique per call because `mapFor` caches compiled maps by
 * `version:key` — two fixtures sharing a key would otherwise share a map and
 * quietly test the same thing twice.
 */
let versions = 0;
const bundleOf = (...definitions: readonly unknown[]): ResolvedBundle => {
  versions += 1;
  return {
    version: `vcmp${String(versions).padStart(4, '0')}`,
    checksum: 'cmp',
    definitions: new Map(
      definitions.map((definition) => [
        (definition as { key: string }).key,
        definition as ResolvedBundle['definitions'] extends ReadonlyMap<string, infer V>
          ? V
          : never,
      ]),
    ),
    unlockSets: [],
  };
};

const plan = (bundle: ResolvedBundle, huntKey: string, level = 1) =>
  huntContext.buildHuntPlan({
    bundle,
    huntKey,
    level,
    equipped: [],
    supplyCharges: 0,
    supplyHeal: null,
  });

describe('§16 CMP — a Hunt, its map and its creatures are simulatable together', () => {
  it('CMP1: a creature too slow for its own map’s ground is refused when the plan is built', () => {
    // Each part is valid on its own: the creature passes the creature schema,
    // the ground passes both the uint16 bound and `compileMap`'s slowest-
    // Character gate, and the Hunt references both correctly.
    expect(() =>
      compileMap({
        key: 'map.cmp',
        z: 7,
        rows: ['####', '#..#', '####'],
        legend: { '#': 'wall', '.': { kind: 'floor', groundSpeed: SLOWEST_AUTHORED_GROUND } },
        entry: { x: 1, y: 1 },
        regions: [{ id: 'only', rect: [1, 1, 2, 1], room: 1, spawns: [{ x: 1, y: 1 }] }],
      }),
    ).not.toThrow();

    const bundle = bundleOf(
      BASELINE,
      creature('creature.slow', SLOWEST_AUTHORED_SPEED),
      map(
        'map.heavy',
        { '#': 'wall', '.': { kind: 'floor', groundSpeed: SLOWEST_AUTHORED_GROUND } },
        ['######', '#....#', '######'],
      ),
      hunt('hunt.heavy', 'map.heavy', [{ key: 'creature.slow', count: 1 }]),
    );

    let thrown: unknown;
    try {
      plan(bundle, 'hunt.heavy');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    const error = thrown as DomainError;
    // Typed, not an opaque engine exception escaping the domain.
    expect(error.code).toBe('HuntNotSimulatable');
    // And it names everything an author needs to fix the content.
    expect(error.details).toMatchObject({
      actor: 'creature',
      huntKey: 'hunt.heavy',
      mapKey: 'map.heavy',
      creatureKey: 'creature.slow',
      creatureStepSpeed: SLOWEST_AUTHORED_SPEED,
      groundSpeed: SLOWEST_AUTHORED_GROUND,
      stepCost: DIAGONAL_STEP_FACTOR,
    });
    expect(error.message).toMatch(/DIAGONAL step/);
  });

  it('CMP2: the CARDINAL fits — it is the diagonal that does not', () => {
    // This is the case a cardinal-only check would wave through, and it is the
    // reason the composition check asks about the diagonal:
    //   speed 15 -> divisor 25;  floor(1,200,000 / 25) = 48,000 ms cardinal
    //   48,000 x 3 = 144,000 ms, which the source returns as 12,928.
    expect(supportedStepDurationMs(SLOWEST_AUTHORED_SPEED, SLOWEST_AUTHORED_GROUND, 1)).toBe(
      48_000,
    );
    expect(
      supportedStepDurationMs(
        SLOWEST_AUTHORED_SPEED,
        SLOWEST_AUTHORED_GROUND,
        DIAGONAL_STEP_FACTOR,
      ),
    ).toBeNull();

    // A ground the same creature CAN walk diagonally is accepted, so the
    // refusal above is about that pair and not about the creature.
    const walkable = bundleOf(
      BASELINE,
      creature('creature.slow', SLOWEST_AUTHORED_SPEED),
      map('map.light', { '#': 'wall', '.': { kind: 'floor', groundSpeed: 400 } }, [
        '######',
        '#....#',
        '######',
      ]),
      hunt('hunt.light', 'map.light', [{ key: 'creature.slow', count: 1 }]),
    );
    expect(supportedStepDurationMs(SLOWEST_AUTHORED_SPEED, 400, DIAGONAL_STEP_FACTOR)).toBe(48_000);
    expect(() => plan(walkable, 'hunt.light')).not.toThrow();
  });

  it('CMP3: real content is untouched — a Rat on the ground the game ships', () => {
    // The Rat is 67 and the shipped Sewers authors no ground at all, so every
    // tile is the source's 150 fallback: 900 ms a step, 2,700 diagonally.
    expect(supportedStepDurationMs(67, 150, DIAGONAL_STEP_FACTOR)).toBe(2_700);
    const bundle = bundleOf(
      BASELINE,
      creature('creature.rat', 67),
      map('map.sewers', { '#': 'wall', '.': 'floor', '~': 'water' }, [
        '######',
        '#..~.#',
        '######',
      ]),
      hunt('hunt.sewers', 'map.sewers', [{ key: 'creature.rat', count: 2 }]),
    );
    const built = plan(bundle, 'hunt.sewers');
    expect(built.space?.map.key).toBe('map.sewers');
    expect(built.plan.creatures['creature.rat']?.stepSpeed).toBe(67);
    // And the Character is not re-checked here, because `compileMap` already
    // refused any ground the slowest one could not walk — level 1 is the
    // slowest a Character can be, and it walks 1200 diagonally in 13,050 ms.
    expect(playerBaseStepSpeed(1)).toBe(110);
    expect(
      supportedStepDurationMs(
        playerBaseStepSpeed(1),
        SLOWEST_AUTHORED_GROUND,
        DIAGONAL_STEP_FACTOR,
      ),
    ).toBe(13_050);
  });

  it('CMP4: an IMMOBILE creature is valid on ground nothing could walk', () => {
    // `Creature::addEventWalk` refuses to schedule a walk below step speed 1,
    // so a creature authored at 0 never takes a step there is a duration for.
    // Asking the curve about it would invent a refusal the source does not
    // have — 113 shipped monsters are authored at exactly 0.
    const bundle = bundleOf(
      BASELINE,
      creature('creature.pillar', 0),
      map(
        'map.heavy2',
        { '#': 'wall', '.': { kind: 'floor', groundSpeed: SLOWEST_AUTHORED_GROUND } },
        ['######', '#....#', '######'],
      ),
      hunt('hunt.pillar', 'map.heavy2', [{ key: 'creature.pillar', count: 1 }]),
    );
    expect(() => plan(bundle, 'hunt.pillar')).not.toThrow();
    expect(plan(bundle, 'hunt.pillar').plan.creatures['creature.pillar']?.stepSpeed).toBe(0);
  });

  it('CMP5: the check is scoped to THIS Hunt’s creatures and THIS Hunt’s map', () => {
    // One bundle, two Hunts. The bad pair exists in the bundle — but the slow
    // creature is not in the other Hunt, and the heavy ground is not on the
    // other map. A global Cartesian product would condemn both.
    const bundle = bundleOf(
      BASELINE,
      creature('creature.slow', SLOWEST_AUTHORED_SPEED),
      creature('creature.rat', 67),
      map(
        'map.heavy3',
        { '#': 'wall', '.': { kind: 'floor', groundSpeed: SLOWEST_AUTHORED_GROUND } },
        ['######', '#....#', '######'],
      ),
      map('map.plain', { '#': 'wall', '.': 'floor' }, ['######', '#....#', '######']),
      hunt('hunt.bad', 'map.heavy3', [{ key: 'creature.slow', count: 1 }]),
      hunt('hunt.good', 'map.plain', [{ key: 'creature.rat', count: 1 }]),
      // The slow creature on the PLAIN map: fine, because that ground is light.
      hunt('hunt.slow-on-plain', 'map.plain', [{ key: 'creature.slow', count: 1 }]),
      // The Rat on the HEAVY map: fine, because that creature is fast enough.
      hunt('hunt.rat-on-heavy', 'map.heavy3', [{ key: 'creature.rat', count: 1 }]),
    );
    expect(() => plan(bundle, 'hunt.bad')).toThrow(/HuntNotSimulatable|cannot be simulated/);
    expect(() => plan(bundle, 'hunt.good')).not.toThrow();
    expect(() => plan(bundle, 'hunt.slow-on-plain')).not.toThrow();
    expect(() => plan(bundle, 'hunt.rat-on-heavy')).not.toThrow();
  });

  it('CMP6: repeated creatures and repeated ground speeds change nothing', () => {
    // The same creature in three rooms, and a map whose 60 floor tiles are two
    // distinct speeds written many times. The plan carries one creature entry,
    // and the map carries the two speeds once each: the check is over DISTINCT
    // values, so a bigger map is not a longer check.
    const rows = ['#'.repeat(32), `#${'fs'.repeat(15)}#`, '#'.repeat(32)];
    const legend = {
      '#': 'wall',
      f: { kind: 'floor', groundSpeed: 100 },
      s: { kind: 'floor', groundSpeed: 200 },
    };
    const wide = {
      ...map('map.striped', legend, rows),
      regions: [{ id: 'only', rect: [1, 1, 30, 1], room: 1, spawns: [{ x: 1, y: 1 }] }],
    };
    const bundle = bundleOf(BASELINE, creature('creature.rat', 67), wide, {
      ...hunt('hunt.striped', 'map.striped', [{ key: 'creature.rat', count: 1 }]),
      rooms: [
        { number: 1, creatures: [{ key: 'creature.rat', count: 1 }], endless: false },
        { number: 2, creatures: [{ key: 'creature.rat', count: 2 }], endless: false },
        { number: 3, creatures: [{ key: 'creature.rat', count: 3 }], endless: true },
      ],
    });
    const built = plan(bundle, 'hunt.striped');
    expect(Object.keys(built.plan.creatures)).toEqual(['creature.rat']);
    // Two speeds over sixty tiles, deduplicated and ordered by the compiler.
    expect(built.space?.map.groundSpeeds).toEqual([100, 200]);
    expect(built.space?.map.groundSpeed).toHaveLength(32 * 3);
    // A wall's fallback is NOT in the list: only speeds the rows actually use.
    expect(built.space?.map.groundSpeeds).not.toContain(150);
  });

  it('CMP7: a Hunt with no map is the Phase 2 encounter, and is not checked', () => {
    // Phase 2's abstract Hunt has no ground for anything to be too slow on.
    // It must keep building exactly as it did, whatever its creatures weigh.
    const abstract = hunt('hunt.abstract', 'map.unused', [{ key: 'creature.slow', count: 1 }]);
    const { map: _dropped, ...noMap } = abstract;
    const bundle = bundleOf(BASELINE, creature('creature.slow', SLOWEST_AUTHORED_SPEED), {
      ...noMap,
      references: ['character-baseline.origin', 'creature.slow'],
    });
    const built = plan(bundle, 'hunt.abstract');
    expect(built.space).toBeUndefined();
    expect(built.plan.creatures['creature.slow']?.stepSpeed).toBe(SLOWEST_AUTHORED_SPEED);
  });

  it('CMP10: the CHARACTER’s real speed is checked, not the map compiler’s yardstick', () => {
    /**
     * `compileMap` holds ground against `playerBaseStepSpeed(1)` = 110, which
     * is the PRODUCTION baseline and not a contract: `characterBaselineSchema`
     * accepts any positive `baseSpeed`, and `playerBaseStepSpeed` clamps only
     * at `PLAYER_MIN_SPEED`. So an authored baseline of 1 is a real Character
     * of step speed 10, and the map that compiled for 110 is not one it can
     * walk.
     *
     * By hand, from the source arithmetic:
     *   speed 10 -> ln(271.29) = 5.60335, × 857.36 = 4804.0
     *               4804.0 − 4795.01 + 0.5 = 9.49  ->  floor 9
     *               floor(1000 × 1200 / 9) = 133,333  ->  ceil to 133,350 ms
     *   133,350 is already past 65,535 CARDINAL, before the ×3 is applied.
     */
    const slowBaseline = { ...BASELINE, key: 'character-baseline.slow', baseSpeed: 1 };
    const heavyMap = map(
      'map.heavy5',
      { '#': 'wall', '.': { kind: 'floor', groundSpeed: SLOWEST_AUTHORED_GROUND } },
      ['######', '#....#', '######'],
    );
    const rat = creature('creature.rat', 67);

    // Each part is schema-valid. This is the premise, checked rather than
    // asserted: nothing upstream has any reason to refuse any of them.
    expect(characterBaselineSchema.safeParse(slowBaseline).success).toBe(true);
    expect(creatureSchema.safeParse(rat).success).toBe(true);
    expect(mapSchema.safeParse(heavyMap).success).toBe(true);
    // And the map compiles, because the compiler's yardstick is 110.
    expect(() => compileMap(mapSchema.parse(heavyMap) as never)).not.toThrow();

    // The arithmetic, from the engine rather than from this comment.
    expect(playerBaseStepSpeed(1, 1)).toBe(10);
    expect(calculatedStepSpeed(10)).toBe(9);
    expect(Math.ceil(Math.floor((1000 * SLOWEST_AUTHORED_GROUND) / 9) / 50) * 50).toBe(133_350);
    let cardinal: unknown;
    try {
      stepDurationMs(10, SLOWEST_AUTHORED_GROUND);
    } catch (error) {
      cardinal = error;
    }
    expect(cardinal).toBeInstanceOf(StepDurationError);
    expect((cardinal as StepDurationError).durationMs).toBe(133_350);
    expect(133_350).toBeGreaterThan(MAX_STEP_DURATION_MS);
    expect(supportedStepDurationMs(10, SLOWEST_AUTHORED_GROUND, DIAGONAL_STEP_FACTOR)).toBeNull();
    // The Rat on that same ground is FINE, which is why misattributing this
    // failure to the Rat would send an author to fix the wrong definition.
    // floor(1,200,000 / 172) = 6,976 -> 7,000 cardinal, 21,000 diagonal.
    expect(supportedStepDurationMs(67, SLOWEST_AUTHORED_GROUND, DIAGONAL_STEP_FACTOR)).toBe(21_000);

    const bundle = bundleOf(slowBaseline, rat, heavyMap, {
      ...hunt('hunt.slowchar', 'map.heavy5', [{ key: 'creature.rat', count: 1 }]),
      characterBaseline: 'character-baseline.slow',
      references: ['character-baseline.slow', 'map.heavy5', 'creature.rat'],
    });

    let built: unknown = 'not assigned';
    let thrown: unknown;
    try {
      built = plan(bundle, 'hunt.slowchar');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    const error = thrown as DomainError;
    expect(error.code).toBe('HuntNotSimulatable');
    // Reported as the CHARACTER, with the baseline and level that produced it.
    expect(error.details).toMatchObject({
      actor: 'character',
      huntKey: 'hunt.slowchar',
      mapKey: 'map.heavy5',
      characterStepSpeed: 10,
      characterBaseSpeed: 1,
      level: 1,
      groundSpeed: SLOWEST_AUTHORED_GROUND,
      stepCost: DIAGONAL_STEP_FACTOR,
    });
    expect(error.details).not.toHaveProperty('creatureKey');
    expect(error.message).toMatch(/the Character walks at step speed 10/);
    // No plan escaped, so nothing could have started an Activity with it.
    expect(built).toBe('not assigned');

    // The SAME map and the SAME Rat with the production baseline is fine —
    // the refusal is about that baseline, not about this Hunt's shape.
    const production = bundleOf(BASELINE, rat, heavyMap, {
      ...hunt('hunt.normalchar', 'map.heavy5', [{ key: 'creature.rat', count: 1 }]),
    });
    const ok = plan(production, 'hunt.normalchar');
    expect(ok.profile.stepSpeed).toBe(110);
    expect(ok.space?.map.groundSpeeds).toEqual([SLOWEST_AUTHORED_GROUND]);
    // Dense array, one distinct speed: the check is over the distinct values
    // and the compiled map is reused, so no settlement rescans tiles.
    expect(ok.space?.map.groundSpeed).toHaveLength(6 * 3);
    expect(plan(production, 'hunt.normalchar').space?.map).toBe(ok.space?.map);
  });

  it('CMP8: the refusal is the PLAN’s, so no simulation is ever attempted', () => {
    // The guarantee is about ordering, not just about throwing: nothing that
    // could start an Activity gets a plan back. `simulateHunt` is only ever
    // handed inputs that were proved simulatable, which is why it may keep
    // treating an unrepresentable step as the fault it is.
    const bundle = bundleOf(
      BASELINE,
      creature('creature.slow', SLOWEST_AUTHORED_SPEED),
      map(
        'map.heavy4',
        { '#': 'wall', '.': { kind: 'floor', groundSpeed: SLOWEST_AUTHORED_GROUND } },
        ['######', '#....#', '######'],
      ),
      hunt('hunt.heavy4', 'map.heavy4', [{ key: 'creature.slow', count: 1 }]),
    );
    let built: unknown = 'not assigned';
    expect(() => {
      built = plan(bundle, 'hunt.heavy4');
    }).toThrow(DomainError);
    expect(built).toBe('not assigned');
  });
});
