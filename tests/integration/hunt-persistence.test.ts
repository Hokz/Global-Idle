// Phase 2 §12 — PS1 to PS5: reload and restart safety.
//
// "The durable state is a POSITION, not a process" is the load-bearing claim
// of the whole design (P2-D1). These five cases are what makes it a claim
// rather than an aspiration: a reload reconstructs the run from rows alone, a
// BRAND NEW process resumes into the same future, and a settlement replayed
// from the same persisted tick produces byte-identical results.
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeededRandom, simulateHunt, type HuntState } from '@global-idle/game-engine';
import { hunt as huntContext, withTransaction } from '@global-idle/domain';
import { minutes, seconds } from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { createClient, databaseUrl, truncateAll } from '../support/db.js';
import {
  advanceOnce,
  kills,
  play,
  playUntil,
  publishContent,
  readCharacter,
  readLedger,
  readRun,
  startHunt,
} from '../support/phase2.js';
import { REPO_ROOT } from '../support/repo.js';

const prisma = createClient();
const T0 = new Date('2026-03-05T09:00:00.000Z');
const RUNNER = join(REPO_ROOT, 'tests', 'support', 'restart-runner.mjs');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-ps-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** One settlement, in a process this one did not warm. */
function advanceInFreshProcess(activityId: string, now: Date): Record<string, unknown> {
  const out = execFileSync(
    process.execPath,
    [RUNNER, databaseUrl(), directory, activityId, now.toISOString()],
    { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(out) as Record<string, unknown>;
}

describe('§12 PS — persistence', () => {
  it('PS1: a reload reconstructs the run from durable state alone', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(prisma, resolver, hunt.activityId, T0, (state) =>
      state.events.some((event) => event.kind === 'room-cleared'),
    );
    const stored = await readRun(prisma, hunt.activityId);

    // A reload knows nothing: no run id, no room, no tick, no seed. It has a
    // Character, and everything else comes back from rows.
    const claim = await prisma.occupancyClaim.findUniqueOrThrow({
      where: { characterId: hunt.characterId },
    });
    expect(claim.activityId).toBe(String(hunt.activityId));

    const view = await advanceOnce(prisma, resolver, hunt.activityId, played.at);
    expect(view!.room).toBe(stored.room);
    expect(view!.cycle).toBe(stored.cycle);
    expect(view!.tick).toBe(stored.tick);
    expect(view!.health).toBe(stored.characterHealth);
    expect(view!.supplyCharges).toBe(stored.supplyCharges);
    expect(view!.sessionXp).toBe(stored.sessionXp.toString());
    // Including the living encounter, which is the part a client cannot
    // recompute and must not be asked to remember.
    expect(view!.creatures.map((creature) => creature.health)).toEqual(
      (stored.creatures as { health: number }[]).map((creature) => creature.health),
    );
  });

  it('PS2: a process restart resumes the same run', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await play(prisma, resolver, hunt.activityId, T0, minutes(4));
    const before = await readRun(prisma, hunt.activityId);

    // A different node, a different connection, a different everything.
    const view = advanceInFreshProcess(
      String(hunt.activityId),
      new Date(played.at.getTime() + seconds(20)),
    );

    expect(view['activityId']).toBe(String(hunt.activityId));
    expect(view['connection']).toBe('ONLINE_ACTIVE');
    expect(view['endedReason']).toBeNull();

    const after = await readRun(prisma, hunt.activityId);
    // It CONTINUED — it did not restart the run, and it did not replay it.
    expect(after.tick).toBe(before.tick + 20);
    expect(after.room).toBeGreaterThanOrEqual(before.room);
    expect(after.sessionXp).toBeGreaterThanOrEqual(before.sessionXp);
  }, 120_000);

  it('PS3: the same persisted position produces the same future', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await play(prisma, resolver, hunt.activityId, T0, minutes(3));
    const stored = await readRun(prisma, hunt.activityId);
    const seed = (
      await prisma.sessionBoundActivity.findUniqueOrThrow({
        where: { activityId: String(hunt.activityId) },
      })
    ).rngSeed;

    // The seed a settlement uses includes the TICK it starts at, so a
    // settlement is a pure function of the persisted position. Replaying it
    // from the row — which is all a restart has — reproduces it exactly.
    const state: HuntState = {
      tick: stored.tick,
      room: stored.room,
      cycle: stored.cycle,
      health: stored.characterHealth,
      supplyCharges: stored.supplyCharges,
      creatures: stored.creatures as never,
      characterNextAttackTick: stored.characterNextAttackTick,
      ended: null,
    };
    const { plan, profile } = await withTransaction(prisma, async () => {
      const bundle = await resolver.resolve(version);
      const character = await readCharacter(prisma, hunt.characterId);
      return huntContext.buildHuntPlan(
        bundle,
        'hunt.rookgaard.sewers',
        huntContext.levelForXp(character.baseXp),
      );
    });

    const first = simulateHunt(
      state,
      profile,
      plan,
      30,
      createSeededRandom(`${seed}:${state.tick}`),
    );
    const second = simulateHunt(
      state,
      profile,
      plan,
      30,
      createSeededRandom(`${seed}:${state.tick}`),
    );
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // ...and the real settlement lands on exactly that state.
    const view = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(stored.simulatedThrough.getTime() + seconds(30)),
    );
    expect(view!.tick).toBe(first.state.tick);
    expect(view!.room).toBe(first.state.room);
    expect(view!.cycle).toBe(first.state.cycle);
    expect(view!.health).toBe(first.state.health);
    expect(view!.supplyCharges).toBe(first.state.supplyCharges);
  });

  it('PS4: a restart in the middle of a checkpoint duplicates nothing', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 3);

    const at = new Date(T0.getTime() + minutes(25));
    await advanceOnce(prisma, resolver, hunt.activityId, at);
    const settled = await readRun(prisma, hunt.activityId);
    const xp = (await readCharacter(prisma, hunt.characterId)).baseXp;
    const entries = await readLedger(prisma, hunt.accountId);

    // The crash: the position is rewound to before the checkpoint, but the
    // operation it claimed is committed. A fresh process picks it up.
    await prisma.huntRun.update({
      where: { activityId: String(hunt.activityId) },
      data: {
        simulatedThrough: new Date(settled.simulatedThrough.getTime() - seconds(20)),
        checkpointSequence: settled.checkpointSequence - 1,
      },
    });
    advanceInFreshProcess(String(hunt.activityId), at);

    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(xp);
    const after = await readLedger(prisma, hunt.accountId);
    expect(after.length).toBe(entries.length);
    expect(after.reduce((total, entry) => total + entry.amount, 0n)).toBe(
      entries.reduce((total, entry) => total + entry.amount, 0n),
    );
  }, 120_000);

  it('PS5: rooms, rewards and the ledger stay consistent across a restart', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => state.events.filter((event) => event.kind === 'room-cleared').length >= 2,
    );

    const cleared = played.events.filter((event) => event.kind === 'room-cleared').length;
    const killed = kills(played.events);
    const run = await readRun(prisma, hunt.activityId);

    // Room advancement is the count of clears, and the XP is the count of
    // kills. Neither is a number the client sent, and neither can drift from
    // the event stream that produced it.
    expect(run.room).toBe(1 + cleared);
    expect(run.sessionXp).toBe(BigInt(killed) * 5n);
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(run.sessionXp);
    expect((await readLedger(prisma, hunt.accountId)).reduce((t, e) => t + e.amount, 0n)).toBe(
      run.sessionGold,
    );

    // Restart, keep playing, and the same three agree again.
    advanceInFreshProcess(String(hunt.activityId), new Date(played.at.getTime() + seconds(20)));
    const more = await play(
      prisma,
      resolver,
      hunt.activityId,
      new Date(played.at.getTime() + seconds(40)),
      minutes(10),
    );

    const final = await readRun(prisma, hunt.activityId);
    const total = cleared + more.events.filter((event) => event.kind === 'room-cleared').length;
    expect(final.room).toBeLessThanOrEqual(1 + total);
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(final.sessionXp);
    expect((await readLedger(prisma, hunt.accountId)).reduce((t, e) => t + e.amount, 0n)).toBe(
      final.sessionGold,
    );
    expect(more.view!.connection).toBe('ONLINE_ACTIVE');
  }, 120_000);
});
