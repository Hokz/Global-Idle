// Phase 2 §12 — SIM1 to SIM10. The Hunt simulator, on its own.
//
// Nothing here touches a database, a clock or a network. `simulateHunt` is a
// pure function of (state, profile, plan, ticks, rng), which is the only
// reason a Hunt can be advanced on read, replayed after a rollback, and
// resumed after a restart into the same future the player left.
//
// The GOLDEN FILE is the part that survives a refactor: two fresh runs of a
// broken implementation agree with each other perfectly.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engine from '@global-idle/game-engine';
import {
  TICK_MS,
  createSeededRandom,
  initialState,
  maxMeleeHit,
  minMeleeHit,
  simulateHunt,
  type CombatProfile,
  type CreatureStats,
  type HuntState,
  type RoomPlan,
  type SeededRandom,
} from '@global-idle/game-engine';
import { HUNT_FIXTURE_INPUT, runHuntFixtureInFreshProcess } from '../support/engine.js';
import { canonicalJson, runHuntFixture } from '../support/engine-runner.mjs';
import { REPO_ROOT } from '../support/repo.js';

const GOLDEN = join(REPO_ROOT, 'tests', 'fixtures', 'engine', 'hunt-golden.json');
const CONTENT = join(REPO_ROOT, 'packages', 'game-data', 'content', 'rookgaard.json');

const {
  profile: FIXTURE_PROFILE,
  plan: FIXTURE_PLAN,
  charges: FIXTURE_CHARGES,
} = HUNT_FIXTURE_INPUT;

/**
 * The AUTHORED Sewers, read straight from the content file.
 *
 * SIM5 and SIM6 are about the ten rooms the game actually ships, so they read
 * them rather than a fixture that could drift away from the game. Everything
 * else uses the frozen fixture, which pins the engine independently of what
 * content says today.
 */
async function authoredSewers(): Promise<{
  profile: CombatProfile;
  plan: RoomPlan;
  charges: number;
}> {
  interface Authored {
    definitions: {
      key: string;
      rooms?: RoomPlan['rooms'];
      maxHealth?: number;
      experience?: number;
      attack?: { intervalMs: number; maxDamage: number };
      defense?: number;
      armor?: number;
      mitigation?: number;
      gold?: CreatureStats['gold'];
      attackSkill?: number;
      attackValue?: number;
      attackFactor?: number;
      attackIntervalMs?: number;
      supply?: { charges: number; healMin: number; healMax: number; useBelowPercent: number };
    }[];
  }
  const doc = JSON.parse(await readFile(CONTENT, 'utf8')) as Authored;
  const find = (key: string) => {
    const found = doc.definitions.find((definition) => definition.key === key);
    if (!found) throw new Error(`${key} is not in the authored content.`);
    return found;
  };
  const hunt = find('hunt.rookgaard.sewers');
  const rat = find('creature.rat');
  const authored = find('combat-profile.origin.rookgaard');
  if (!hunt.rooms || !authored.supply) throw new Error('The Sewers have no Phase 2 simulation.');

  return {
    plan: {
      rooms: hunt.rooms,
      creatures: {
        'creature.rat': {
          key: rat.key,
          maxHealth: rat.maxHealth!,
          experience: rat.experience!,
          attackIntervalMs: rat.attack!.intervalMs,
          maxDamage: rat.attack!.maxDamage,
          defense: rat.defense!,
          armor: rat.armor!,
          mitigation: rat.mitigation!,
          gold: rat.gold!,
        },
      },
    },
    profile: {
      level: 1,
      maxHealth: authored.maxHealth!,
      attackSkill: authored.attackSkill!,
      attackValue: authored.attackValue!,
      attackFactor: authored.attackFactor!,
      attackIntervalMs: authored.attackIntervalMs!,
      defense: authored.defense!,
      armor: authored.armor!,
      supply: {
        healMin: authored.supply.healMin,
        healMax: authored.supply.healMax,
        useBelowPercent: authored.supply.useBelowPercent,
      },
    },
    charges: authored.supply.charges,
  };
}

/**
 * A generator that plays back a SCRIPT of draws instead of a stream.
 *
 * This is how SIM8 can state the reduction chain's order as an arithmetic
 * fact: with every roll pinned, the only thing left that can move the answer
 * is the order the three reductions are applied in, and the bounds each one
 * draws from.
 */
function scriptedRandom(floats: readonly number[], ints: readonly number[]): SeededRandom {
  let f = 0;
  let i = 0;
  let draws = 0;
  return {
    seed: 'scripted',
    get drawCount() {
      return draws;
    },
    next() {
      draws += 1;
      const value = floats[f];
      f += 1;
      if (value === undefined) throw new Error(`the script ran out of floats at draw ${draws}`);
      return value;
    },
    nextInt(maxExclusive: number) {
      draws += 1;
      const value = ints[i];
      i += 1;
      if (value === undefined) throw new Error(`the script ran out of ints at draw ${draws}`);
      if (value >= maxExclusive)
        throw new Error(`scripted ${value} is out of range for ${maxExclusive}`);
      return value;
    },
    pick<T>(items: readonly T[]): T {
      draws += 1;
      return items[0] as T;
    },
  };
}

const fixtureRun = (ticks: number, seed = 'sim-seed', from?: HuntState) =>
  simulateHunt(
    from ?? initialState(FIXTURE_PROFILE, FIXTURE_PLAN, FIXTURE_CHARGES),
    FIXTURE_PROFILE,
    FIXTURE_PLAN,
    ticks,
    createSeededRandom(seed),
  );

describe('§12 SIM — the Hunt simulator', () => {
  it('SIM1: a tick is 1000 ms of simulated time, and splitting a span changes nothing', () => {
    expect(TICK_MS).toBe(1000);

    // ONE generator across both halves, because that is what a continuation
    // is: the engine does not re-seed mid-span. (The DOMAIN re-seeds per
    // settlement from `${seed}:${tick}`, which PS3 pins separately.)
    const rng = createSeededRandom('sim-split');
    const start = initialState(FIXTURE_PROFILE, FIXTURE_PLAN, FIXTURE_CHARGES);
    const first = simulateHunt(start, FIXTURE_PROFILE, FIXTURE_PLAN, 120, rng);
    const second = simulateHunt(first.state, FIXTURE_PROFILE, FIXTURE_PLAN, 180, rng);

    const whole = simulateHunt(
      start,
      FIXTURE_PROFILE,
      FIXTURE_PLAN,
      300,
      createSeededRandom('sim-split'),
    );

    expect(second.state).toEqual(whole.state);
    expect([...first.rewards, ...second.rewards]).toEqual(whole.rewards);
    expect([...first.events, ...second.events]).toEqual(whole.events);
    expect(first.drawsConsumed + second.drawsConsumed).toBe(whole.drawsConsumed);

    // Every tick advances the position by exactly one, so `simulatedThrough`
    // can be derived from the tick count rather than stored twice.
    expect(first.state.tick).toBe(120);
    expect(second.state.tick).toBe(300);
  });

  it('SIM2: the same seed produces the same run, and a different seed does not', async () => {
    const first = canonicalJson(runHuntFixture(engine, HUNT_FIXTURE_INPUT));
    const second = canonicalJson(runHuntFixture(engine, HUNT_FIXTURE_INPUT));

    // Byte-identical, not merely deep-equal.
    expect(second).toBe(first);

    // ...and identical to what was recorded when this engine was written.
    // Without the golden file the two runs above would agree with each other
    // however broken the simulator became.
    expect(first).toBe(await readFile(GOLDEN, 'utf8'));

    const other = canonicalJson(
      runHuntFixture(engine, { ...HUNT_FIXTURE_INPUT, seed: 'a-different-seed' }),
    );
    expect(other).not.toBe(first);
  });

  it('SIM3: Rat combat matches the transcribed formula, not an approximation of it', async () => {
    const { profile, plan } = await authoredSewers();
    const rat = plan.creatures['creature.rat']!;

    // round(0.085 * 1.0 * 9.6 * 10 + floor(1 / 5)) = round(8.16) = 8.
    expect(maxMeleeHit(profile)).toBe(8);
    expect(minMeleeHit(profile)).toBe(0);
    // The armed floor is level / 5, integer division — it starts to bite at 5.
    expect(minMeleeHit({ ...profile, level: 5 })).toBe(1);
    expect(maxMeleeHit({ ...profile, level: 5 })).toBe(9);
    expect(maxMeleeHit({ ...profile, attackValue: 0 })).toBe(0);

    // What the chain permits, computed from the transcribed steps rather than
    // observed: a top roll of 8, the Rat's smallest defence roll (2), its flat
    // armour point, then mitigation's truncation.
    const bestCase = Math.floor((8 - 2 - 1) * (1 - rat.mitigation / 100));
    expect(bestCase).toBe(4);

    // And the Rat against the tutorial profile: 8, defence [2, 4], armour
    // [2, 3], no mitigation.
    const worstTaken = 8 - 2 - 2;
    expect(worstTaken).toBe(4);

    const step = simulateHunt(
      initialState(profile, plan, 20),
      profile,
      plan,
      6000,
      createSeededRandom('sim-formula'),
    );
    const dealt = step.events.filter((event) => event.kind === 'hit').map((event) => event.damage);
    const taken = step.events
      .filter((event) => event.kind === 'taken')
      .map((event) => event.damage);

    expect(dealt.length).toBeGreaterThan(500);
    expect(taken.length).toBeGreaterThan(500);
    expect(Math.max(...dealt)).toBe(bestCase);
    expect(Math.max(...taken)).toBe(worstTaken);
    expect(Math.min(...dealt)).toBe(0);
    // A centred roll reduced by a centred block misses far more often than it
    // lands. If this ever stops being true the distribution has been swapped
    // for a uniform one.
    expect(dealt.filter((value) => value === 0).length).toBeGreaterThan(dealt.length / 2);
  });

  it('SIM4: a room clears when its last creature dies, and only then', () => {
    const step = fixtureRun(400);
    const cleared = step.events.filter((event) => event.kind === 'room-cleared');
    expect(cleared.length).toBeGreaterThan(0);

    const first = cleared[0]!;
    const kills = step.events.filter((event) => event.kind === 'kill' && event.tick <= first.tick);
    // Room 1 of the fixture holds exactly one Rat, and the clear lands on the
    // same tick as the kill that emptied it.
    expect(kills.length).toBe(1);
    expect(kills[0]!.tick).toBe(first.tick);
    expect(first.room).toBe(1);

    // A clear is worth exactly one reward per creature, no more.
    expect(step.rewards.filter((reward) => reward.tick <= first.tick).length).toBe(1);

    // Room 2 holds two, and does NOT clear on the first of them.
    const room2 = cleared[1];
    if (room2) {
      const inRoom2 = step.events.filter(
        (event) => event.kind === 'kill' && event.tick > first.tick && event.tick <= room2.tick,
      );
      expect(inRoom2.length).toBe(2);
    }
  });

  it('SIM5: the authored Sewers advance from room 1 to room 10 in order', async () => {
    const { profile, plan, charges } = await authoredSewers();
    expect(plan.rooms.map((room) => room.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const step = simulateHunt(
      initialState(profile, plan, charges),
      profile,
      plan,
      20_000,
      createSeededRandom('sim-rooms'),
    );
    const cleared = step.events.filter((event) => event.kind === 'room-cleared');

    // The first nine clears are rooms 1 to 9, in order, each exactly once, and
    // none of them touches the cycle.
    expect(cleared.slice(0, 9).map((event) => event.room)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(cleared.slice(0, 9).every((event) => event.cycle === 0)).toBe(true);

    // Nothing skips: a clear of room N is followed by a spawn for room N + 1.
    const ninth = cleared[8]!;
    const spawns = step.events.filter(
      (event) => event.kind === 'spawn' && event.tick <= ninth.tick,
    );
    expect(spawns.map((event) => event.room)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('SIM6: room 10 repeats forever and increments the cycle each time', async () => {
    const { profile, plan, charges } = await authoredSewers();
    const last = plan.rooms.at(-1)!;
    expect(last.number).toBe(10);
    expect(last.endless).toBe(true);
    expect(plan.rooms.filter((room) => room.endless).length).toBe(1);

    const step = simulateHunt(
      initialState(profile, plan, charges),
      profile,
      plan,
      20_000,
      createSeededRandom('sim-rooms'),
    );
    const endless = step.events
      .filter((event) => event.kind === 'room-cleared')
      .filter((event) => event.room === 10);

    expect(endless.length).toBeGreaterThanOrEqual(2);
    // 1, 2, 3, ... — every clear of the endless room advances the cycle by
    // exactly one, and the room number never moves past 10.
    expect(endless.map((event) => event.cycle)).toEqual(endless.map((_, index) => index + 1));
    expect(step.state.room).toBe(10);
    expect(step.state.cycle).toBe(endless.length);

    // The endless room re-spawns immediately rather than leaving a gap.
    const after = step.events.find(
      (event) => event.kind === 'spawn' && event.tick === endless[0]!.tick + 1,
    );
    expect(after).toBeDefined();
  });

  it('SIM7: a run that is not advancing advances nothing', () => {
    const start = initialState(FIXTURE_PROFILE, FIXTURE_PLAN, FIXTURE_CHARGES);

    // Zero ticks: the paused case the domain produces while a connection is in
    // reconnect grace. No ticks, no rewards, and — the part that matters — no
    // draws, so resuming continues the same stream rather than a shifted one.
    const idle = fixtureRun(0, 'sim-paused', start);
    expect(idle.state).toEqual(start);
    expect(idle.rewards).toEqual([]);
    expect(idle.events).toEqual([]);
    expect(idle.drawsConsumed).toBe(0);
    expect(idle.roomsCleared).toBe(0);
    expect(idle.suppliesUsed).toBe(0);

    // An ended run is inert even when handed a thousand ticks.
    const dead: HuntState = { ...start, ended: 'DIED', health: 0 };
    const after = fixtureRun(1000, 'sim-paused', dead);
    expect(after.state).toEqual(dead);
    expect(after.drawsConsumed).toBe(0);
  });

  it('SIM8: damage is reduced by defence, then armour, then mitigation', () => {
    // One Character swing, every roll pinned. Skill 120 and attack value 10
    // give a max hit of round(0.085 * 10 * 120) = 102: big enough that each
    // reduction is separable in the answer, and EVEN, so the centre of the
    // roll is a whole number rather than a rounding boundary. (At an odd
    // maximum the centred roll lands on x.5, where the probit's last unit in
    // the last place decides the integer — true of the distribution, useless
    // as a fixed point to reason from.)
    const profile: CombatProfile = {
      level: 1,
      maxHealth: 500,
      attackSkill: 120,
      attackValue: 10,
      attackFactor: 1,
      attackIntervalMs: 2000,
      defense: 0,
      armor: 0,
      supply: { healMin: 0, healMax: 0, useBelowPercent: 0 },
    };
    expect(maxMeleeHit(profile)).toBe(102);

    const dummy: CreatureStats = {
      key: 'creature.dummy',
      maxHealth: 1000,
      experience: 0,
      attackIntervalMs: 60_000,
      maxDamage: 0,
      defense: 10,
      armor: 10,
      mitigation: 50,
      gold: { chance: 0, min: 0, max: 0 },
    };
    const plan: RoomPlan = {
      rooms: [{ number: 1, creatures: [{ key: 'creature.dummy', count: 1 }], endless: true }],
      creatures: { 'creature.dummy': dummy },
    };

    // Draw 1 (float, the damage roll): 0.5 is the centre of the truncated
    // normal, so normal_random(0, 102) returns 0.5 * 102 = 51.
    // Draw 2 (int, DEFENCE): uniform_random(5, 10) -> 5 + nextInt(6) = 10.
    // Draw 3 (int, ARMOUR): armour 10 > 3, uniform_random(5, 9)
    //                       -> 5 + nextInt(5) = 9.
    // Then mitigation: 32 - 32 * 50 / 100 = 16.
    const rng = scriptedRandom([0.5], [5, 4]);
    const step = simulateHunt(initialState(profile, plan, 0), profile, plan, 1, rng);
    const hit = step.events.find((event) => event.kind === 'hit');

    expect(hit?.damage).toBe(16);
    expect(step.drawsConsumed).toBe(3);

    // The order is not free, and the two wrong ones are wrong in different
    // ways. Mitigation first halves 51 before either subtraction and lands on
    // 6. Armour first cannot even be scripted: its bound is uniform_random(5,
    // 9), so the first scripted integer (5) is out of range for it, which is
    // the same fact stated as a bound rather than as a total.
    const mitigationFirst = Math.floor(51 * 0.5) - 10 - 9;
    expect(mitigationFirst).toBe(6);
    expect(hit?.damage).not.toBe(mitigationFirst);

    // Armour of 1 to 3 is a flat point and consumes NO draw — the branch
    // Canary writes as `--damage`. The roll is still the centred 51, so the
    // whole reduction is that one point.
    const light: CreatureStats = { ...dummy, armor: 1, mitigation: 0, defense: 0 };
    const lightPlan: RoomPlan = {
      rooms: [{ number: 1, creatures: [{ key: 'creature.dummy', count: 1 }], endless: true }],
      creatures: { 'creature.dummy': light },
    };
    const lightStep = simulateHunt(
      initialState(profile, lightPlan, 0),
      profile,
      lightPlan,
      1,
      scriptedRandom([0.5], []),
    );
    expect(lightStep.events.find((event) => event.kind === 'hit')?.damage).toBe(51 - 1);
    expect(lightStep.drawsConsumed).toBe(1);
  });

  it('SIM9: the engine is pure — no clock, no global randomness, no mutation', async () => {
    const start = initialState(FIXTURE_PROFILE, FIXTURE_PLAN, FIXTURE_CHARGES);
    const snapshot = structuredClone(start);
    const step = fixtureRun(300, 'sim-pure', start);

    // The input is untouched, including the creature objects inside it — a
    // settlement that mutated its argument would corrupt the state a rollback
    // has to replay from.
    expect(start).toEqual(snapshot);
    expect(step.state).not.toBe(start);

    const mid = step.state;
    const midSnapshot = structuredClone(mid);
    fixtureRun(120, 'sim-pure-2', mid);
    expect(mid).toEqual(midSnapshot);

    // No source of non-determinism can be reached from the simulator at all.
    const sources = await Promise.all(
      ['hunt.ts', 'distributions.ts', 'random.ts'].map((file) =>
        readFile(join(REPO_ROOT, 'packages', 'game-engine', 'src', file), 'utf8'),
      ),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/Math\.random/);
      expect(source).not.toMatch(/Date\.now|new Date\(/);
      expect(source).not.toMatch(/process\.|require\(|from '(node:|fs|path)/);
    }
  });

  it('SIM10: draw ordering survives a process restart', async () => {
    const inProcess = canonicalJson(runHuntFixture(engine, HUNT_FIXTURE_INPUT));

    // A brand-new node, importing the BUILT engine: nothing this process
    // warmed, no shared generator, no module state.
    const restarted = await runHuntFixtureInFreshProcess(HUNT_FIXTURE_INPUT);

    expect(restarted).toBe(inProcess);
    expect(restarted).toBe(await readFile(GOLDEN, 'utf8'));

    // The tail of the stream is in the fixture for a reason: a change that
    // consumed one extra draw in the middle of the run would be invisible
    // whenever it happened not to move a rounded outcome.
    const parsed = JSON.parse(restarted) as { drawCount: number; tail: number[] };
    expect(parsed.tail).toHaveLength(5);
    expect(parsed.drawCount).toBeGreaterThan(HUNT_FIXTURE_INPUT.ticks);
  }, 180_000);
});
