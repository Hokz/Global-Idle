// Phase 2 §12 — AU25 to AU28: the four mandatory active-use timer cases of
// `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §7.
//
// Phase 2 ships no player-facing timed effect — no XP boost, no Imbuement —
// so there is nothing yet to OWN a timer, and inventing an owner column for a
// feature that does not exist would be a schema decision made by the wrong
// phase. What exists is the settlement path, and these cases drive it with a
// real `ActiveUseTimer` row through the real Hunt: `advance` is told which
// timers ride this run, and it decides WHEN they burn.
//
// The rule it implements, in one line: a timer burns exactly the span the
// simulation covered, and stops being qualifying the moment the run stops.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTimerPort,
  hunt as huntContext,
  remainingAt,
  withTransaction,
} from '@global-idle/domain';
import { hours, minutes, operationId as toOperationId, seconds } from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import {
  advanceOnce,
  kills,
  playUntil,
  publishContent,
  readRun,
  startHunt,
} from '../support/phase2.js';

const prisma = createClient();
const T0 = new Date('2026-03-02T09:00:00.000Z');
/** Twelve hours of active use, which is what an Imbuement will carry (§6). */
const TWELVE_HOURS = hours(12);

let directory: string;
let version: string;
let resolver: ContentBundleResolver;

beforeEach(async () => {
  await truncateAll(prisma);
  await prisma.activeUseTimer.deleteMany({});
  directory = await mkdtemp(join(tmpdir(), 'global-idle-au-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedTimer(id: string, at: Date, remaining = TWELVE_HOURS) {
  await prisma.activeUseTimer.create({
    data: { id, remainingMs: remaining, qualifyingSince: null, updatedAt: at },
  });
  return id;
}

const readTimer = (id: string) => prisma.activeUseTimer.findUniqueOrThrow({ where: { id } });

describe('§12 AU — active-use timers', () => {
  it('AU25: offline wall-clock does not consume', async () => {
    const timerId = await seedTimer('timer-offline', T0);
    const hunt = await startHunt(prisma, resolver, version, T0);

    // The Hunt runs for a while with the timer attached, then the Character
    // leaves. Everything after that is offline wall clock.
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
      { timerIds: [timerId] },
    );
    const burned = TWELVE_HOURS - (await readTimer(timerId)).remainingMs;
    expect(burned).toBeGreaterThan(0);

    await withTransaction(prisma, (tx) =>
      huntContext.endRun(tx, hunt.activityId, 'LEFT', played.at),
    );

    // Six hours pass with nobody connected. The timer is not qualifying, so
    // the COMPUTED read is the stored value — time passing is not use.
    const offline = new Date(played.at.getTime() + hours(6));
    await advanceOnce(prisma, resolver, hunt.activityId, offline, { timerIds: [timerId] });

    const row = await readTimer(timerId);
    expect(row.qualifyingSince).toBeNull();
    expect(TWELVE_HOURS - row.remainingMs).toBe(burned);
    expect(
      remainingAt(
        { remaining: row.remainingMs as never, qualifyingSince: row.qualifyingSince },
        offline,
      ),
    ).toBe(row.remainingMs);
  });

  it('AU26: reconnect grace does not consume', async () => {
    const timerId = await seedTimer('timer-grace', T0);
    const hunt = await startHunt(prisma, resolver, version, T0);

    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
      { timerIds: [timerId] },
    );

    // The connection goes quiet. The pausing read still settles the span that
    // WAS proven live, and then the timer stops qualifying.
    const quiet = new Date(played.at.getTime() + minutes(2));
    const paused = await advanceOnce(prisma, resolver, hunt.activityId, quiet, {
      seen: false,
      timerIds: [timerId],
    });
    expect(paused?.connection).toBe('RECONNECT_GRACE_PAUSED');

    const atPause = await readTimer(timerId);
    expect(atPause.qualifyingSince).toBeNull();

    // Four minutes of grace, then a reconnect. Not one millisecond of the
    // pause is billed — including on the far side of it, which is the failure
    // a checkpoint-only implementation has: the marker sits through the pause
    // and the whole span is collected by the settlement that follows.
    const back = new Date(quiet.getTime() + minutes(4));
    const resumed = await advanceOnce(prisma, resolver, hunt.activityId, back, {
      timerIds: [timerId],
    });
    expect(resumed?.connection).toBe('ONLINE_ACTIVE');
    expect((await readTimer(timerId)).remainingMs).toBe(atPause.remainingMs);

    // And the next connected settlement bills only ITS span, not the gap.
    const after = new Date(back.getTime() + seconds(20));
    await advanceOnce(prisma, resolver, hunt.activityId, after, { timerIds: [timerId] });
    const burned = atPause.remainingMs - (await readTimer(timerId)).remainingMs;
    expect(burned).toBeGreaterThan(0);
    expect(burned).toBeLessThanOrEqual(seconds(20));
  });

  it('AU27: qualifying active use does consume', async () => {
    const timerId = await seedTimer('timer-active', T0);
    const hunt = await startHunt(prisma, resolver, version, T0);

    const at = new Date(T0.getTime() + seconds(20));
    await advanceOnce(prisma, resolver, hunt.activityId, at, { timerIds: [timerId] });

    const run = await readRun(prisma, hunt.activityId);
    const row = await readTimer(timerId);

    // The timer burned EXACTLY the simulated span — the ticks the run
    // advanced, not the wall clock the request arrived on. With a tick of one
    // second those are the same number, which is the point: the timer and the
    // simulation cannot drift apart.
    expect(TWELVE_HOURS - row.remainingMs).toBe(run.tick * 1000);
    expect(row.qualifyingSince).toEqual(run.simulatedThrough);

    // It keeps burning while the Hunt keeps running.
    const later = new Date(at.getTime() + seconds(20));
    await advanceOnce(prisma, resolver, hunt.activityId, later, { timerIds: [timerId] });
    const after = await readRun(prisma, hunt.activityId);
    expect(TWELVE_HOURS - (await readTimer(timerId)).remainingMs).toBe(after.tick * 1000);

    // A timer that is NOT attached to the run burns nothing at all.
    const bystander = await seedTimer('timer-bystander', T0);
    await advanceOnce(prisma, resolver, hunt.activityId, new Date(later.getTime() + seconds(20)), {
      timerIds: [timerId],
    });
    expect((await readTimer(bystander)).remainingMs).toBe(TWELVE_HOURS);
  });

  it('AU28: a retry or a restart does not double-consume', async () => {
    const timerId = await seedTimer('timer-retry', T0);
    const hunt = await startHunt(prisma, resolver, version, T0);

    const at = new Date(T0.getTime() + seconds(30));
    await advanceOnce(prisma, resolver, hunt.activityId, at, { timerIds: [timerId] });
    const settled = await readRun(prisma, hunt.activityId);
    const afterFirst = (await readTimer(timerId)).remainingMs;
    expect(afterFirst).toBeLessThan(TWELVE_HOURS);

    // The same checkpoint, replayed: the run's position is rewound as a crash
    // between the settlement and its commit would leave it, but the operation
    // the checkpoint claimed is still there.
    await prisma.huntRun.update({
      where: { activityId: String(hunt.activityId) },
      data: {
        simulatedThrough: new Date(settled.simulatedThrough.getTime() - seconds(30)),
        checkpointSequence: settled.checkpointSequence - 1,
      },
    });
    await advanceOnce(prisma, resolver, hunt.activityId, at, { timerIds: [timerId] });
    expect((await readTimer(timerId)).remainingMs).toBe(afterFirst);

    // And the settlement primitive says the same thing on its own: replaying
    // one operation id applies nothing a second time.
    const timers = createTimerPort();
    const op = toOperationId('au28-direct');
    const first = await withTransaction(prisma, (tx) =>
      timers.settleCheckpoint(tx, timerId, new Date(at.getTime() + minutes(5)), op),
    );
    const second = await withTransaction(prisma, (tx) =>
      timers.settleCheckpoint(tx, timerId, new Date(at.getTime() + minutes(5)), op),
    );
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });
});
