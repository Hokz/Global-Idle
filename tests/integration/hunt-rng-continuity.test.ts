/**
 * Cross-phase §21 — RNGC1 to RNGC10. Settlement boundaries are not gameplay.
 *
 * WHAT THIS GROUP IS ABOUT. A Hunt used to build its generators from
 * `${activity.rngSeed}:${run.tick}` on every settlement. Each settlement was
 * therefore reproducible — and the NUMBER of settlements was an input. Sixty
 * one-second advances restarted the stream sixty times; one sixty-second
 * advance ran it once; from the same durable state and the same authoritative
 * elapsed time they produced different damage, different Gold and different
 * loot. The client chooses when to POST `/hunt/advance`, so the client was
 * choosing the luck.
 *
 * These cases drive the REAL path — `advance`, the row, a later settlement —
 * because that is where the defect lived. Every one of them fails at
 * `f795892`, before the streams became durable.
 *
 * WHY SIXTY SECONDS. One settlement simulates at most `LIVENESS_WINDOW`
 * (90 s): time nobody was proven connected for is not simulated, which is
 * Phase 2 behaviour these cases must not change. Sixty seconds is the largest
 * round span that a SINGLE settlement can cover, so "one long settlement" is
 * a thing that can actually happen.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '@global-idle/domain';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { createClient, databaseUrl, truncateAll } from '../support/db.js';
import { advanceOnce, publishContent, startHunt } from '../support/phase2.js';
import { REPO_ROOT } from '../support/repo.js';

const prisma = createClient();
const T0 = new Date('2026-04-02T08:00:00.000Z');
const RUNNER = join(REPO_ROOT, 'tests', 'support', 'restart-runner.mjs');

/** Enough Character that sixty seconds is a fight, not an approach. */
const BASE_XP = 300_000n;

let directory: string;
let version: string;
let resolver: ContentBundleResolver;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-rngc-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Everything durable that a settlement can move.
 *
 * Deliberately the WHOLE row plus the things it writes elsewhere. A case that
 * compared only XP would pass while HP, loot and the actors' tiles diverged —
 * which is exactly the shape of the bug being fixed.
 */
async function durableState(activityId: string, characterId: string) {
  const run = await prisma.huntRun.findUniqueOrThrow({ where: { activityId } });
  const character = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { baseXp: true, baseLevel: true },
  });
  const stamina = await prisma.characterStamina.findUniqueOrThrow({ where: { characterId } });
  const items = await prisma.itemInstance.findMany({
    where: { characterId },
    orderBy: [{ definitionKey: 'asc' }, { location: 'asc' }, { id: 'asc' }],
    select: {
      definitionKey: true,
      quantity: true,
      location: true,
      slot: true,
      slotIndex: true,
      rarity: true,
      affixes: true,
    },
  });
  const gold = await prisma.currencyBalance.findMany({
    where: { characterId },
    orderBy: [{ custody: 'asc' }, { currency: 'asc' }],
    select: { custody: true, currency: true, amount: true },
  });
  return {
    tick: run.tick,
    room: run.room,
    cycle: run.cycle,
    characterHealth: run.characterHealth,
    characterNextAttackTick: run.characterNextAttackTick,
    supplyCharges: run.supplyCharges,
    creatures: run.creatures,
    position: run.position,
    sessionXp: String(run.sessionXp),
    sessionGold: String(run.sessionGold),
    endedReason: run.endedReason,
    rngState: run.rngState,
    baseXp: String(character.baseXp),
    baseLevel: character.baseLevel,
    staminaRemainingMs: stamina.remainingMs,
    items: items.map((item) => ({ ...item })),
    gold: gold.map((row) => ({ ...row, amount: String(row.amount) })),
  };
}

type Durable = Awaited<ReturnType<typeof durableState>>;

/** The stream positions, without the rest of the row. */
const streamsOf = (state: Durable) =>
  state.rngState as unknown as {
    version: number;
    combat: { drawCount: number; a: number };
    loot: { drawCount: number; a: number };
    identity: { drawCount: number; a: number };
  } | null;

/**
 * Settle `parts` seconds of authoritative time, one advance per part.
 *
 * Every run this returns starts from the same seed, the same content and the
 * same Character, so the ONLY difference between two of them is where the
 * settlement boundaries fell.
 */
async function settleIn(parts: readonly number[]) {
  const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: BASE_XP });
  let now = T0;
  for (const seconds of parts) {
    now = new Date(now.getTime() + seconds * 1000);
    await advanceOnce(prisma, resolver, hunt.activityId, now);
  }
  return {
    hunt,
    state: await durableState(String(hunt.activityId), hunt.characterId),
  };
}

const ONCE = [60];
const EVERY_SECOND = Array.from({ length: 60 }, () => 1);
const EVERY_TWO = Array.from({ length: 30 }, () => 2);
const RAGGED = [3, 7, 1, 12, 4, 19, 14];

describe('§21 RNGC — the settlement boundary is not a gameplay input', () => {
  it('RNGC1: one settlement and two settlements produce the same run', async () => {
    const long = await settleIn([60]);
    const split = await settleIn([25, 35]);

    // The span has to be a FIGHT, or the case proves nothing about combat.
    expect(long.state.tick).toBe(60);
    expect(BigInt(long.state.sessionXp)).toBeGreaterThan(0n);
    expect(streamsOf(long.state)?.combat.drawCount).toBeGreaterThan(0);

    expect(split.state).toEqual(long.state);
  });

  it('RNGC2: sixty one-second settlements equal one sixty-second settlement', async () => {
    const long = await settleIn(ONCE);
    const short = await settleIn(EVERY_SECOND);
    expect(short.state).toEqual(long.state);
  });

  it('RNGC3: any partition of the same span lands on the same run', async () => {
    const reference = await settleIn(ONCE);
    for (const partition of [EVERY_SECOND, EVERY_TWO, RAGGED]) {
      expect(partition.reduce((total, part) => total + part, 0)).toBe(60);
      const run = await settleIn(partition);
      expect(
        run.state,
        `partition [${partition.join(', ')}] diverged from one 60-second settlement`,
      ).toEqual(reference.state);
    }
  });

  it('RNGC4: physical loot is identical, item for item', async () => {
    const long = await settleIn(ONCE);
    const short = await settleIn(EVERY_SECOND);

    // Loot has to have HAPPENED, or "identical" is a statement about nothing.
    const drops = streamsOf(long.state);
    expect(drops?.loot.drawCount ?? 0).toBeGreaterThan(0);
    expect(long.state.items.length).toBeGreaterThan(0);

    expect(short.state.items).toEqual(long.state.items);
    expect(short.state.gold).toEqual(long.state.gold);
  });

  it('RNGC5: tiles and steps in flight are identical too', async () => {
    const long = await settleIn(ONCE);
    const ragged = await settleIn(RAGGED);
    expect(long.state.position).not.toBeNull();
    expect(ragged.state.position).toEqual(long.state.position);
    expect(ragged.state.creatures).toEqual(long.state.creatures);
    expect(ragged.state.room).toBe(long.state.room);
    expect(ragged.state.cycle).toBe(long.state.cycle);
  });

  it('RNGC6: a settlement with no whole tick consumes no randomness', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: BASE_XP });
    await advanceOnce(prisma, resolver, hunt.activityId, new Date(T0.getTime() + 10_000));
    const settled = await durableState(String(hunt.activityId), hunt.characterId);
    const before = streamsOf(settled);
    expect(before).not.toBeNull();

    // 400 ms later: no whole tick has elapsed, so there is nothing to simulate.
    await advanceOnce(prisma, resolver, hunt.activityId, new Date(T0.getTime() + 10_400));
    const after = await durableState(String(hunt.activityId), hunt.characterId);
    expect(after.tick).toBe(settled.tick);
    expect(streamsOf(after)).toEqual(before);
  });

  it('RNGC7: a rolled-back settlement leaves the stream where it was', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: BASE_XP });
    await advanceOnce(prisma, resolver, hunt.activityId, new Date(T0.getTime() + 20_000));
    const before = await durableState(String(hunt.activityId), hunt.characterId);

    // Simulate, then fail the transaction AFTER the work is done. Nothing it
    // touched may survive — the RNG position least of all, because a consumed
    // stream that outlived its rollback would hand the retry a different fight.
    const boom = new Error('rolled back on purpose');
    await expect(
      withTransaction(prisma, async (tx) => {
        const { hunt: huntContext } = await import('@global-idle/domain');
        await huntContext.advance(tx, {
          activityId: hunt.activityId,
          resolver,
          now: new Date(T0.getTime() + 40_000),
          seen: true,
        });
        throw boom;
      }),
    ).rejects.toThrow('rolled back on purpose');

    const rolledBack = await durableState(String(hunt.activityId), hunt.characterId);
    expect(rolledBack).toEqual(before);

    // The retry now produces exactly what the first attempt would have.
    await advanceOnce(prisma, resolver, hunt.activityId, new Date(T0.getTime() + 40_000));
    const retried = await durableState(String(hunt.activityId), hunt.characterId);

    const straight = await settleIn([20, 20]);
    expect({ ...retried, items: [], gold: [] }).toEqual({
      ...straight.state,
      items: [],
      gold: [],
    });
  });

  it('RNGC8: a FRESH PROCESS continues the stored stream', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: BASE_XP });
    await advanceOnce(prisma, resolver, hunt.activityId, new Date(T0.getTime() + 30_000));

    const out = execFileSync(
      process.execPath,
      [
        RUNNER,
        databaseUrl(),
        directory,
        String(hunt.activityId),
        new Date(T0.getTime() + 60_000).toISOString(),
      ],
      { encoding: 'utf8', cwd: REPO_ROOT },
    );
    expect(JSON.parse(out).tick).toBe(60);

    const restarted = await durableState(String(hunt.activityId), hunt.characterId);
    const sameProcess = await settleIn([30, 30]);
    expect({ ...restarted, items: [], gold: [] }).toEqual({
      ...sameProcess.state,
      items: [],
      gold: [],
    });
  });

  it('RNGC9: combat and physical loot remain separate streams', async () => {
    const { state } = await settleIn(ONCE);
    const streams = streamsOf(state);
    expect(streams?.version).toBe(1);
    // Three streams, three positions. If loot rolls were being taken from the
    // combat stream, adding a drop table would move every hit.
    expect(streams?.combat.drawCount).toBeGreaterThan(0);
    expect(streams?.loot.drawCount).toBeGreaterThan(0);
    expect(streams?.combat.a).not.toBe(streams?.loot.a);
    expect(streams?.loot.a).not.toBe(streams?.identity.a);
  });

  it('RNGC10: a row with no stored stream is seeded once, then continues', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: BASE_XP });
    // A row written before the streams were durable.
    expect(
      (await prisma.huntRun.findUniqueOrThrow({ where: { activityId: String(hunt.activityId) } }))
        .rngState,
    ).toBeNull();

    await advanceOnce(prisma, resolver, hunt.activityId, new Date(T0.getTime() + 30_000));
    const first = streamsOf(await durableState(String(hunt.activityId), hunt.characterId));
    expect(first).not.toBeNull();
    expect(first?.combat.drawCount).toBeGreaterThan(0);

    await advanceOnce(prisma, resolver, hunt.activityId, new Date(T0.getTime() + 60_000));
    const second = streamsOf(await durableState(String(hunt.activityId), hunt.characterId));
    // CONTINUED, not reseeded: the count only ever goes up.
    expect(second?.combat.drawCount).toBeGreaterThan(first!.combat.drawCount);

    // And a stored state this engine cannot read is refused rather than
    // silently replaced by a fresh stream.
    await prisma.huntRun.update({
      where: { activityId: String(hunt.activityId) },
      data: { rngState: { version: 99, combat: {}, loot: {}, identity: {} } as never },
    });
    await expect(
      advanceOnce(prisma, resolver, hunt.activityId, new Date(T0.getTime() + 90_000)),
    ).rejects.toThrow(/rngState is version 99/);
  });
});
