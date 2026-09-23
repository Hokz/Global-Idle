/**
 * Phase 3.6 §16 — THR, VER and DET. Movement fidelity, where it is felt.
 *
 * The unit cases pin the arithmetic. These drive the real domain and database
 * path, because the claim this phase exists for is a GAMEPLAY one: a faster
 * Character, or faster ground, finishes more of a Hunt in the same
 * authoritative time. A formula that nothing consumes proves nothing.
 *
 * The corridor these run on is published beside the real content, never on it
 * (spec §12): the prototype Sewers has no sourced tile metadata yet.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { playerBaseStepSpeed, stepDurationMs } from '@global-idle/game-engine';
import { createClient, databaseUrl, truncateAll } from '../support/db.js';
import { advanceOnce, play, publishContent, startHunt } from '../support/phase2.js';
import { LANE_HUNT, withLane } from '../support/phase3-6.js';
import { REPO_ROOT } from '../support/repo.js';

const prisma = createClient();
const T0 = new Date('2026-04-20T07:00:00.000Z');
const RUNNER = join(REPO_ROOT, 'tests', 'support', 'restart-runner.mjs');

/** Enough Character that a Rat dies quickly and TRAVEL is the long pole. */
const STRONG = 4_000_000n;

let directory: string;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-p36-'));
});

afterAll(async () => {
  await prisma.$disconnect();
});

interface LaneRun {
  readonly cycles: number;
  readonly tilesWalked: number;
  readonly legDurations: readonly number[];
  readonly tick: number;
}

/**
 * Run the lane for `minutes` of authoritative time and report what it did.
 *
 * `cycle` counts finished encounters — both Rats dead and the next pair
 * spawned — so it is an integer count of work completed rather than a
 * balance number that a retune would move.
 */
async function runLane(
  published: Published,
  options: { readonly baseXp: bigint; readonly minutes: number },
): Promise<LaneRun> {
  const { version, resolver } = published;
  const hunt = await startHunt(prisma, resolver, version, T0, {
    huntKey: LANE_HUNT,
    baseXp: options.baseXp,
  });
  const played = await play(prisma, resolver, hunt.activityId, T0, options.minutes * 60_000);
  const run = await prisma.huntRun.findUniqueOrThrow({
    where: { activityId: String(hunt.activityId) },
  });
  const legs = played.events
    .filter((event) => event.kind === 'move' && event.actor === 'character')
    .map((event) => (event.kind === 'move' ? event.arrivesAtMs - event.startsAtMs : 0));
  return { cycles: run.cycle, tilesWalked: legs.length, legDurations: legs, tick: run.tick };
}

/** The distinct step durations the Character actually used. */
const bands = (run: LaneRun) => [...new Set(run.legDurations)].sort((a, b) => a - b);

describe('§16 THR — movement fidelity changes what a Hunt produces', () => {
  it('THR1: faster ground finishes more of the same Hunt in the same time', async () => {
    // Identical Character, identical seed, identical creatures, identical
    // geometry, identical elapsed time. The ONLY difference is the ground.
    const slow = await runLane(await lane(150), { baseXp: STRONG, minutes: 12 });
    const fast = await runLane(await lane(50), { baseXp: STRONG, minutes: 12 });

    // The legs really are the durations the curve predicts, and nothing else.
    const speed = playerBaseStepSpeed(await levelOf(STRONG));
    expect(bands(slow)).toEqual([stepDurationMs(speed, 150)]);
    expect(bands(fast)).toEqual([stepDurationMs(speed, 50)]);
    expect(bands(fast)[0]).toBeLessThan(bands(slow)[0]!);

    // And that shows up as WORK DONE: more crossings of the lane, more
    // encounters finished. A structural count, not a tuned number.
    expect(slow.cycles).toBeGreaterThan(0);
    expect(fast.cycles).toBeGreaterThan(slow.cycles);
    expect(fast.tilesWalked).toBeGreaterThan(slow.tilesWalked);
  });

  it('THR2: a higher-level Character moves faster, and covers more ground', async () => {
    // Same lane, same ground, same seed: only the Character's level differs,
    // and with it `110 + (level - 1)`.
    // One bundle, two Characters: the content is byte-identical, so its hash
    // is too, and only the level can explain a difference.
    const published = await lane(150);
    const low = await runLane(published, { baseXp: 0n, minutes: 12 });
    const high = await runLane(published, { baseXp: STRONG, minutes: 12 });

    // The isolated claim: the LEGS are shorter, which is player speed alone.
    // (A higher level also kills faster; that is why the leg duration is
    // asserted directly rather than inferred from the throughput below.)
    const lowSpeed = playerBaseStepSpeed(1);
    const highSpeed = playerBaseStepSpeed(await levelOf(STRONG));
    expect(highSpeed).toBeGreaterThan(lowSpeed);
    expect(bands(low)).toEqual([stepDurationMs(lowSpeed, 150)]);
    expect(bands(high)).toEqual([stepDurationMs(highSpeed, 150)]);
    expect(bands(high)[0]).toBeLessThan(bands(low)[0]!);

    // And the throughput claim: more tiles crossed in the same wall of time.
    expect(high.tilesWalked).toBeGreaterThan(low.tilesWalked);
  });
});

describe('§16 VER — a run keeps the ground it started on', () => {
  it('VER1: a new bundle with different ground does not retime a running Activity', async () => {
    const first = await publishContent(prisma, directory, T0, withLane(150));
    const hunt = await startHunt(prisma, resolver_(first), first.version, T0, {
      huntKey: LANE_HUNT,
      baseXp: STRONG,
    });
    const before = await advanceOnce(prisma, resolver_(first), hunt.activityId, at(30));
    expect(before?.space?.movement ?? null).not.toBeNull();

    // A SECOND bundle: same map key, same geometry, faster ground.
    const second = await publishContent(
      prisma,
      directory,
      new Date(T0.getTime() + 1000),
      withLane(50),
    );
    expect(second.version).not.toBe(first.version);

    // The running Activity pinned V1, so its legs keep V1's timing.
    const after = await play(prisma, resolver_(second), hunt.activityId, at(30), 4 * 60_000);
    const legs = after.events
      .filter((event) => event.kind === 'move' && event.actor === 'character')
      .map((event) => (event.kind === 'move' ? event.arrivesAtMs - event.startsAtMs : 0));
    expect(legs.length).toBeGreaterThan(0);
    const speed = playerBaseStepSpeed(await levelOf(STRONG));
    expect([...new Set(legs)]).toEqual([stepDurationMs(speed, 150)]);
    expect(stepDurationMs(speed, 50)).toBeLessThan(stepDurationMs(speed, 150));

    // A run STARTED after the publish gets the new ground.
    const fresh = await startHunt(prisma, resolver_(second), second.version, at(60), {
      huntKey: LANE_HUNT,
      baseXp: STRONG,
    });
    const freshPlay = await play(prisma, resolver_(second), fresh.activityId, at(60), 2 * 60_000);
    const freshLegs = freshPlay.events
      .filter((event) => event.kind === 'move' && event.actor === 'character')
      .map((event) => (event.kind === 'move' ? event.arrivesAtMs - event.startsAtMs : 0));
    expect([...new Set(freshLegs)]).toEqual([stepDurationMs(speed, 50)]);
  });
});

describe('§16 DET — a variable-duration leg survives everything', () => {
  it('DET1: a restart mid-step on SLOW ground resumes the same leg', async () => {
    await expectRestartKeepsTheLeg(850);
  });

  it('DET2: a restart mid-step on FAST ground resumes the same leg', async () => {
    await expectRestartKeepsTheLeg(50);
  });

  it('DET3: settlement partitioning still cannot change a mixed-ground run', async () => {
    // Phase 3.5's RNGC invariant, re-asserted with ground speeds in play: the
    // durable result of the same elapsed time must not depend on how that
    // time was cut into checkpoints.
    const partitions = [[60], Array.from({ length: 60 }, () => 1), [3, 7, 1, 12, 4, 19, 14]];
    const states: unknown[] = [];
    for (const partition of partitions) {
      await truncateAll(prisma);
      const { version, resolver } = await publishContent(prisma, directory, T0, withLane(50));
      const hunt = await startHunt(prisma, resolver, version, T0, {
        huntKey: LANE_HUNT,
        baseXp: STRONG,
      });
      let now = T0;
      for (const seconds of partition) {
        now = new Date(now.getTime() + seconds * 1000);
        await advanceOnce(prisma, resolver, hunt.activityId, now);
      }
      const run = await prisma.huntRun.findUniqueOrThrow({
        where: { activityId: String(hunt.activityId) },
      });
      states.push({
        tick: run.tick,
        room: run.room,
        cycle: run.cycle,
        health: run.characterHealth,
        creatures: run.creatures,
        position: run.position,
        rngState: run.rngState,
      });
    }
    expect(states[1]).toEqual(states[0]);
    expect(states[2]).toEqual(states[0]);
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const resolver_ = (published: Published) => published.resolver;

interface Published {
  readonly version: string;
  readonly resolver: ContentBundleResolver;
}

/** Publish the lane at one ground speed. The version is a CONTENT HASH, so
 *  two lanes with the same ground are the same bundle and publish once. */
const lane = (groundSpeed: number | undefined): Promise<Published> =>
  publishContent(prisma, directory, T0, withLane(groundSpeed));

/** The level the domain will derive from this much experience. */
async function levelOf(baseXp: bigint): Promise<number> {
  const { hunt } = await import('@global-idle/domain');
  return hunt.levelForXp(baseXp);
}

/**
 * Stop mid-step, come back in a NEW PROCESS, and land on the same tile at the
 * same millisecond — with a duration that only this ground produces.
 */
async function expectRestartKeepsTheLeg(groundSpeed: number): Promise<void> {
  const published = await lane(groundSpeed);
  const speed = playerBaseStepSpeed(await levelOf(STRONG));
  const expected = stepDurationMs(speed, groundSpeed);

  /** Settle one second at a time until a step is caught in flight. */
  const untilMidStep = async (activityId: Parameters<typeof advanceOnce>[2]) => {
    for (let second = 1; second <= 40; second += 1) {
      await advanceOnce(prisma, published.resolver, activityId, at(second));
      const run = await prisma.huntRun.findUniqueOrThrow({
        where: { activityId: String(activityId) },
      });
      const stored = run.position as {
        movement?: { to: unknown; startsAtMs: number; arrivesAtMs: number };
      } | null;
      if (stored?.movement) return { second, movement: stored.movement };
    }
    throw new Error('no step was in flight at any settlement boundary');
  };

  /** Everything the two runs must agree on afterwards. */
  const durable = async (activityId: Parameters<typeof advanceOnce>[2]) => {
    const run = await prisma.huntRun.findUniqueOrThrow({
      where: { activityId: String(activityId) },
    });
    return {
      tick: run.tick,
      room: run.room,
      cycle: run.cycle,
      health: run.characterHealth,
      creatures: run.creatures,
      position: run.position,
      rngState: run.rngState,
    };
  };

  // Two identical runs of the same lane, same seed, same Character.
  const stayed = await startHunt(prisma, published.resolver, published.version, T0, {
    huntKey: LANE_HUNT,
    baseXp: STRONG,
  });
  const restarted = await startHunt(prisma, published.resolver, published.version, T0, {
    huntKey: LANE_HUNT,
    baseXp: STRONG,
  });

  const caught = await untilMidStep(stayed.activityId);
  const mirrored = await untilMidStep(restarted.activityId);
  expect(mirrored.second).toBe(caught.second);

  // The leg in flight is one only THIS ground produces.
  expect(caught.movement.arrivesAtMs - caught.movement.startsAtMs).toBe(expected);
  expect(expected).not.toBe(stepDurationMs(speed, 150));

  // One run carries on in this process; the other is picked up by a brand new
  // one, which has no generator, no resolver cache and no module state.
  const finish = at(caught.second + 20).toISOString();
  await advanceOnce(prisma, published.resolver, stayed.activityId, new Date(finish));
  const out = execFileSync(
    process.execPath,
    [RUNNER, databaseUrl(), directory, String(restarted.activityId), finish],
    { encoding: 'utf8', cwd: REPO_ROOT },
  );
  expect(JSON.parse(out).tick).toBeGreaterThan(caught.second);

  expect(await durable(restarted.activityId)).toEqual(await durable(stayed.activityId));
}
