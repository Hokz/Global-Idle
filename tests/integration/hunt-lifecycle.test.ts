// Phase 2 §12 — DE1 to DE4 (death) and CX1 to CX6 (the connection lifecycle).
//
// §8 is the part of Phase 2 a player feels without being told: closing a
// laptop lid keeps the Hunt running, losing a connection pauses it for exactly
// five minutes, and saying goodbye ends it now. The server owns every deadline
// in that sentence; the client's opinion of elapsed time is never accepted.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hunt as huntContext } from '@global-idle/domain';
import { RECONNECT_GRACE, minutes, seconds } from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import {
  advanceOnce,
  kills,
  play,
  playUntil,
  publishContent,
  readRun,
  startHunt,
} from '../support/phase2.js';
import { call, createCharacter, enterHunt, signIn, startApp, type App } from '../support/phase1.js';

const prisma = createClient();
const T0 = new Date('2026-03-04T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-cx-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Put a run one bad tick away from death.
 *
 * Reaching zero honestly takes about ninety simulated minutes and a thousand
 * settlements, which is a balance measurement, not a test of what death DOES.
 * These four cases are about the latter, so the state is arranged and the
 * engine still decides.
 */
async function nearlyDead(activityId: string, health = 2) {
  await prisma.huntRun.update({
    where: { activityId },
    data: { characterHealth: health, supplyCharges: 0 },
  });
}

describe('§12 DE — death', () => {
  it('DE1: the Character dies when health reaches zero', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 1);
    await nearlyDead(String(hunt.activityId));

    const { view, events } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      new Date(T0.getTime() + minutes(10)),
      (state) => state.view?.endedReason === 'DIED',
      { budgetMs: minutes(30) },
    );

    expect(events.some((event) => event.kind === 'died')).toBe(true);
    expect(view!.health).toBe(0);
    // Health is clamped, never negative: the row is a state a client renders,
    // and "-3 of 150" is not one.
    expect((await readRun(prisma, hunt.activityId)).characterHealth).toBe(0);
  });

  it('DE2: a dead run advances no further', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 1);
    await nearlyDead(String(hunt.activityId));
    const died = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      new Date(T0.getTime() + minutes(10)),
      (state) => state.view?.endedReason === 'DIED',
      { budgetMs: minutes(30) },
    );

    const atDeath = await readRun(prisma, hunt.activityId);
    const xpAtDeath = atDeath.sessionXp;

    // An hour of reads after it. Not one tick, not one reward.
    const later = await play(
      prisma,
      resolver,
      hunt.activityId,
      new Date(died.at.getTime() + minutes(1)),
      minutes(60),
    );
    const after = await readRun(prisma, hunt.activityId);

    expect(after.tick).toBe(atDeath.tick);
    expect(after.sessionXp).toBe(xpAtDeath);
    expect(after.room).toBe(atDeath.room);
    expect(after.cycle).toBe(atDeath.cycle);
    expect(later.events).toEqual([]);
    expect(later.view?.connection).toBe('ACTIVITY_ENDED');
  });

  it('DE3: death ends the Activity and releases the occupancy claim', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 1);
    expect(
      await prisma.occupancyClaim.findUnique({ where: { characterId: hunt.characterId } }),
    ).not.toBeNull();

    await nearlyDead(String(hunt.activityId));
    await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      new Date(T0.getTime() + minutes(10)),
      (state) => state.view?.endedReason === 'DIED',
      { budgetMs: minutes(30) },
    );

    // The claim is GONE, not merely stale — the Character can start something
    // else immediately, which is the only observable that matters.
    expect(
      await prisma.occupancyClaim.findUnique({ where: { characterId: hunt.characterId } }),
    ).toBeNull();
    const bound = await prisma.sessionBoundActivity.findUniqueOrThrow({
      where: { activityId: String(hunt.activityId) },
    });
    expect(bound.state).toBe('ACTIVITY_ENDED');
    expect(bound.graceExpiresAt).toBeNull();

    // And a new Hunt can be entered at once, for the same Character.
    const again = await startHunt(prisma, resolver, version, new Date(T0.getTime() + minutes(20)), {
      accountId: hunt.accountId,
      name: 'second-run',
      vocation: 'KNIGHT',
    });
    expect(again.activityId).not.toBe(hunt.activityId);
  });

  it('DE4: the reason for the ending is durable', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 1);
    await nearlyDead(String(hunt.activityId));
    const died = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      new Date(T0.getTime() + minutes(10)),
      (state) => state.view?.endedReason === 'DIED',
      { budgetMs: minutes(30) },
    );

    const row = await readRun(prisma, hunt.activityId);
    expect(row.endedReason).toBe('DIED');
    expect(row.endedAt).not.toBeNull();

    // A day later, a fresh read still knows what happened and why. The three
    // reasons are distinguishable, which is what a client needs to say
    // "you died" rather than "the Hunt ended".
    const reread = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(died.at.getTime() + minutes(60 * 24)),
    );
    expect(reread!.endedReason).toBe('DIED');
    expect(reread!.connection).toBe('ACTIVITY_ENDED');
    expect(['DIED', 'LEFT', 'GRACE_EXPIRED']).toContain(reread!.endedReason);
  });
});

describe('§12 CX — the connection lifecycle', () => {
  it('CX1: a connected session advances', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const { view } = await play(prisma, resolver, hunt.activityId, T0, minutes(5));

    const run = await readRun(prisma, hunt.activityId);
    // Five minutes of connected Hunt is three hundred ticks, exactly: a tick
    // is a second and the server counts them, not the client.
    expect(run.tick).toBe(300);
    expect(view!.connection).toBe('ONLINE_ACTIVE');
    expect(run.simulatedThrough).toEqual(new Date(T0.getTime() + minutes(5)));
  });

  it('CX2: a backgrounded tab with a live connection keeps advancing', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);

    // NOTHING reads the run. Only heartbeats arrive — which is what a
    // backgrounded tab does, and the difference between a tab and a
    // connection is the whole of P2-D7.
    let now = T0;
    for (let beat = 0; beat < 15; beat += 1) {
      now = new Date(now.getTime() + seconds(20));
      await advanceOnce(prisma, resolver, hunt.activityId, now, { seen: true });
    }

    const run = await readRun(prisma, hunt.activityId);
    expect(run.tick).toBe(300);
    expect(run.endedReason).toBeNull();

    // A tab that stops heartbeating is a tab that is gone, however visible it
    // is: liveness is the heartbeat, not the tab.
    const silent = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(now.getTime() + minutes(2)),
      {
        seen: false,
      },
    );
    expect(silent!.connection).toBe('RECONNECT_GRACE_PAUSED');
  });

  it('CX3: an unexpected disconnect pauses, and preserves everything', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(prisma, resolver, hunt.activityId, T0, (state) =>
      state.events.some((event) => event.kind === 'room-cleared'),
    );
    const before = await readRun(prisma, hunt.activityId);

    const quiet = new Date(played.at.getTime() + minutes(2));
    const paused = await advanceOnce(prisma, resolver, hunt.activityId, quiet, { seen: false });
    expect(paused!.connection).toBe('RECONNECT_GRACE_PAUSED');
    const atPause = await readRun(prisma, hunt.activityId);

    // Four minutes of nothing. No ticks, no Stamina, no timers, no XP, no
    // Gold, no supplies — and the state is not merely frozen, it is INTACT.
    const later = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(quiet.getTime() + minutes(4)),
      {
        seen: false,
      },
    );
    const after = await readRun(prisma, hunt.activityId);

    expect(later!.connection).toBe('RECONNECT_GRACE_PAUSED');
    expect(after.tick).toBe(atPause.tick);
    expect(after.room).toBe(atPause.room);
    expect(after.cycle).toBe(atPause.cycle);
    expect(after.characterHealth).toBe(atPause.characterHealth);
    expect(after.supplyCharges).toBe(atPause.supplyCharges);
    expect(after.creatures).toEqual(atPause.creatures);
    expect(after.sessionXp).toBe(atPause.sessionXp);
    expect(after.sessionGold).toBe(atPause.sessionGold);
    expect(before.room).toBeGreaterThan(1);

    // The claim is HELD through the pause. Losing it would let another
    // session take the Character while its owner is reconnecting.
    expect(
      await prisma.occupancyClaim.findUnique({ where: { characterId: hunt.characterId } }),
    ).not.toBeNull();
  });

  it('CX4: reconnecting inside five minutes resumes the same run', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
    );

    const quiet = new Date(played.at.getTime() + minutes(2));
    const paused = await advanceOnce(prisma, resolver, hunt.activityId, quiet, { seen: false });
    const deadline = Date.parse(paused!.graceExpiresAt!);
    const atPause = await readRun(prisma, hunt.activityId);

    // Back with one second to spare.
    const back = new Date(deadline - seconds(1));
    const resumed = await advanceOnce(prisma, resolver, hunt.activityId, back, { seen: true });

    expect(resumed!.connection).toBe('ONLINE_ACTIVE');
    expect(resumed!.endedReason).toBeNull();
    // The SAME Activity at the SAME state — not a new run, not a rewound one.
    expect(resumed!.activityId).toBe(String(hunt.activityId));
    expect(resumed!.tick).toBe(atPause.tick);
    expect(resumed!.room).toBe(atPause.room);
    expect(resumed!.sessionXp).toBe(atPause.sessionXp.toString());

    // And it advances again from here, with the paused minutes costing
    // nothing: the next span is measured from the reconnect, not from before.
    const after = await play(
      prisma,
      resolver,
      hunt.activityId,
      new Date(back.getTime() + seconds(20)),
      minutes(1),
    );
    const run = await readRun(prisma, hunt.activityId);
    expect(run.tick).toBeGreaterThan(atPause.tick);
    expect(run.tick).toBeLessThanOrEqual(atPause.tick + 80);
    expect(after.view!.connection).toBe('ONLINE_ACTIVE');
  });

  it('CX5: past five minutes the grace expires and the claim is released', async () => {
    expect(RECONNECT_GRACE).toBe(minutes(5));

    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
    );

    const quiet = new Date(played.at.getTime() + minutes(2));
    const paused = await advanceOnce(prisma, resolver, hunt.activityId, quiet, { seen: false });
    const deadline = Date.parse(paused!.graceExpiresAt!);

    // One second the other side of the same deadline.
    const late = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(deadline + seconds(1)),
      {
        seen: true,
      },
    );

    expect(late!.connection).toBe('ACTIVITY_ENDED');
    expect(late!.endedReason).toBe('GRACE_EXPIRED');
    expect((await readRun(prisma, hunt.activityId)).endedReason).toBe('GRACE_EXPIRED');
    expect(
      await prisma.occupancyClaim.findUnique({ where: { characterId: hunt.characterId } }),
    ).toBeNull();

    // The DEADLINE is the server's, computed from the last moment anyone was
    // proven to be there — so arriving late with a cheerful heartbeat does not
    // extend it.
    expect(deadline).toBe(played.at.getTime() + huntContext.LIVENESS_WINDOW + RECONNECT_GRACE);
  });

  it('CX6: Leave and signing out end the run at once, with no grace', async () => {
    // Through the REAL routes, because "no grace" is a property of what the
    // HTTP layer does, not of what the domain could do if asked nicely.
    process.env['GLOBAL_IDLE_DEV_AUTH'] = '1';
    const { app, base } = await startApp({ CONTENT_BUNDLE_DIR: directory });
    try {
      const cookie = await signIn(base, 'cx6-leaver');
      const character = await createCharacter(base, cookie, 'Leaver');
      await enterHunt(base, cookie, character.id, 'hunt.rookgaard.sewers');

      const claim = await prisma.occupancyClaim.findUniqueOrThrow({
        where: { characterId: character.id },
      });
      const left = await call(base, `/api/characters/${character.id}/activity`, {
        method: 'DELETE',
        cookie,
      });
      expect(left.status).toBe(204);

      const run = await prisma.huntRun.findUniqueOrThrow({
        where: { activityId: claim.activityId },
      });
      expect(run.endedReason).toBe('LEFT');
      expect(
        await prisma.occupancyClaim.findUnique({ where: { characterId: character.id } }),
      ).toBeNull();
      // NO grace was reserved — a deliberate exit is not a lost connection.
      const bound = await prisma.sessionBoundActivity.findUniqueOrThrow({
        where: { activityId: claim.activityId },
      });
      expect(bound.state).toBe('ACTIVITY_ENDED');
      expect(bound.graceExpiresAt).toBeNull();

      // Signing out does the same for whatever the session still holds.
      const second = await signIn(base, 'cx6-quitter');
      const quitter = await createCharacter(base, second, 'Quitter');
      await enterHunt(base, second, quitter.id, 'hunt.rookgaard.sewers');
      const held = await prisma.occupancyClaim.findUniqueOrThrow({
        where: { characterId: quitter.id },
      });

      const out = await call(base, '/api/session', { method: 'DELETE', cookie: second });
      expect(out.status).toBe(204);
      expect(out.headers.get('set-cookie')).toContain('Max-Age=0');

      const quitRun = await prisma.huntRun.findUniqueOrThrow({
        where: { activityId: held.activityId },
      });
      expect(quitRun.endedReason).toBe('LEFT');
      expect(
        await prisma.occupancyClaim.findUnique({ where: { characterId: quitter.id } }),
      ).toBeNull();

      // Signing out without a session still clears the cookie rather than
      // failing: a sign-out that can 401 leaves the browser holding the
      // cookie it asked to drop.
      const anonymous = await call(base, '/api/session', { method: 'DELETE' });
      expect(anonymous.status).toBe(204);
    } finally {
      await (app as App).close();
    }
  });
});
