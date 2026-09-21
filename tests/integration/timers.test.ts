// §14.5 — the durable half: T1, T2, T3, T10, T15, T16.
//
// These are the cases that only a real database can answer: a timer that
// survives a restart, an operation id that cannot double-apply, and a registry
// reconciled against persisted rows.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeClock,
  activity,
  createTimerPort,
  remainingAt,
  settlementOperationId,
  withTransaction,
} from '@global-idle/domain';
import { durationMs, minutes, newId } from '@global-idle/shared';
import {
  T0,
  createClient,
  seedAccount,
  seedActivityRoot,
  seedBundle,
  seedCharacter,
  seedParticipant,
  truncateAll,
} from '../support/db.js';

const prisma = createClient();
const timers = createTimerPort();

async function makeTimer(remaining: number): Promise<string> {
  const id = newId<'TimerId'>(T0);
  await prisma.activeUseTimer.create({
    data: { id, remainingMs: remaining, qualifyingSince: null, updatedAt: T0 },
  });
  return id;
}

beforeEach(async () => {
  await truncateAll(prisma);
  await seedBundle(prisma, 'v1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('§14.5 timers and stamina (durable)', () => {
  it('T1: FakeClock produces deterministic settlement', async () => {
    const run = async () => {
      await truncateAll(prisma);
      const clock = new FakeClock(T0);
      const timer = await makeTimer(minutes(60));
      await withTransaction(prisma, (tx) => timers.enterQualifying(tx, timer, clock.now()));
      clock.advance(minutes(17));
      return withTransaction(prisma, (tx) =>
        timers.leaveQualifying(tx, timer, clock.now(), settlementOperationId(timer, 1)),
      );
    };

    const first = await run();
    const second = await run();
    const third = await run();
    expect(first).toBe(minutes(17));
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('T2: repeated settlement with the same operation id does not double-consume', async () => {
    const clock = new FakeClock(T0);
    const timer = await makeTimer(minutes(60));
    const op = settlementOperationId(timer, 1);

    await withTransaction(prisma, (tx) => timers.enterQualifying(tx, timer, clock.now()));
    clock.advance(minutes(10));

    const first = await withTransaction(prisma, (tx) =>
      timers.settleCheckpoint(tx, timer, clock.now(), op),
    );
    expect(first).toBe(minutes(10));

    // Replaying the same operation id applies NOTHING, even though more time
    // has passed — the id is the guard, not the clock.
    clock.advance(minutes(10));
    const replay = await withTransaction(prisma, (tx) =>
      timers.settleCheckpoint(tx, timer, clock.now(), op),
    );
    expect(replay).toBe(durationMs(0));

    const row = await prisma.activeUseTimer.findUniqueOrThrow({ where: { id: timer } });
    expect(row.remainingMs).toBe(minutes(50));
  });

  it('T3: restart from the durable qualifyingSince yields the same result', async () => {
    const clock = new FakeClock(T0);
    const timer = await makeTimer(minutes(60));
    await withTransaction(prisma, (tx) => timers.enterQualifying(tx, timer, clock.now()));

    // Simulate a crash: nothing in memory survives. Both fields are durable,
    // so a fresh port resettles from qualifyingSince and reaches the same
    // answer a process that never died would have reached.
    const afterCrash = createTimerPort();
    clock.advance(minutes(25));

    const stored = await prisma.activeUseTimer.findUniqueOrThrow({ where: { id: timer } });
    const computedBeforeSettling = remainingAt(
      { remaining: durationMs(stored.remainingMs), qualifyingSince: stored.qualifyingSince },
      clock.now(),
    );

    const settled = await withTransaction(prisma, (tx) =>
      afterCrash.leaveQualifying(tx, timer, clock.now(), settlementOperationId(timer, 1)),
    );
    expect(settled).toBe(minutes(25));

    const after = await prisma.activeUseTimer.findUniqueOrThrow({ where: { id: timer } });
    expect(after.remainingMs).toBe(minutes(35));
    // The computed read agreed with the settlement all along (§7.3).
    expect(computedBeforeSettling).toBe(minutes(35));
  });

  it('T10: crash and retry produce neither double-consume nor double-recover', async () => {
    const clock = new FakeClock(T0);
    const timer = await makeTimer(minutes(60));
    const op = settlementOperationId(timer, 1);

    await withTransaction(prisma, (tx) => timers.enterQualifying(tx, timer, clock.now()));
    clock.advance(minutes(20));

    // Five concurrent retries of the same settlement — the shape of a lost
    // response retried by a client and a worker at once.
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        withTransaction(prisma, (tx) => timers.settleCheckpoint(tx, timer, clock.now(), op)).catch(
          () => durationMs(-1),
        ),
      ),
    );

    const applied = outcomes.filter((value) => value === minutes(20));
    expect(applied).toHaveLength(1);

    const row = await prisma.activeUseTimer.findUniqueOrThrow({ where: { id: timer } });
    expect(row.remainingMs).toBe(minutes(40));
    expect(await prisma.settlementOperation.count()).toBe(1);
  });

  it('T15: two Characters in one activity hold independent activation state', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const paladin = await seedCharacter(prisma, account, 'PALADIN');
    const hunt = await seedActivityRoot(prisma, account, { family: 'SESSION_BOUND' });
    await prisma.sessionBoundActivity.create({
      data: {
        activityId: hunt,
        accountId: account,
        family: 'SESSION_BOUND',
        state: 'ONLINE_ACTIVE',
        rngSeed: 'seed-t15',
      },
    });
    await seedParticipant(prisma, hunt, knight, 'SESSION_BOUND', 0);
    await seedParticipant(prisma, hunt, paladin, 'SESSION_BOUND', 1);

    // Both start unactivated: null is the durable "not yet" marker (ADR-014).
    const before = await prisma.activityParticipant.findMany({ where: { activityId: hunt } });
    expect(before.every((row) => row.staminaActivatedAt === null)).toBe(true);

    // Activate ONLY the Knight.
    const activatedAt = new Date(T0.getTime() + minutes(5));
    await prisma.activityParticipant.update({
      where: { activityId_characterId: { activityId: hunt, characterId: knight } },
      data: { staminaActivatedAt: activatedAt },
    });

    const knightRow = await prisma.activityParticipant.findUniqueOrThrow({
      where: { activityId_characterId: { activityId: hunt, characterId: knight } },
    });
    const paladinRow = await prisma.activityParticipant.findUniqueOrThrow({
      where: { activityId_characterId: { activityId: hunt, characterId: paladin } },
    });

    // The other participant's row was NOT written by the first one's activation.
    expect(knightRow.staminaActivatedAt).toEqual(activatedAt);
    expect(paladinRow.staminaActivatedAt).toBeNull();

    // And each settles on its own marker, so the modes differ within one
    // activity.
    const { character } = await import('@global-idle/domain');
    expect(
      character.deriveStaminaMode({
        claim: {
          stamina: 'STAMINA_CONSUMING',
          sessionState: 'ONLINE_ACTIVE',
          staminaActivatedAt: knightRow.staminaActivatedAt,
        },
      }),
    ).toBe('CONSUMING');
    expect(
      character.deriveStaminaMode({
        claim: {
          stamina: 'STAMINA_CONSUMING',
          sessionState: 'ONLINE_ACTIVE',
          staminaActivatedAt: paladinRow.staminaActivatedAt,
        },
      }),
    ).toBe('NEUTRAL');
  });

  it('T16: registry and database reconciliation refuses an unknown or reclassified type', async () => {
    const account = await seedAccount(prisma);

    // A database holding only known types, with the families the registry
    // says, passes.
    await seedActivityRoot(prisma, account, { family: 'SESSION_BOUND', activityTypeKey: 'hunt' });
    await withTransaction(prisma, (tx) => activity.assertRegistryMatchesDatabase(tx));

    // A persisted key the registry does not know: the process refuses to
    // start. Removing a type that has persisted rows is a fail-fast event.
    const unknown = newId<'ActivityId'>(new Date(T0.getTime() + 1));
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Activity" ("id","accountId","activityTypeKey","family","contentVersion","contentKey","createdAt")
       VALUES ($1,$2,'dungeon','SESSION_BOUND','v1','dungeon.rookgaard.doublet',$3)`,
      unknown,
      account,
      T0,
    );
    await expect(
      withTransaction(prisma, (tx) => activity.assertRegistryMatchesDatabase(tx)),
    ).rejects.toThrow(/not in the registry/);
    await prisma.$executeRawUnsafe(`DELETE FROM "Activity" WHERE id = $1`, unknown);

    // A persisted family the registry disagrees with: likewise refused. A
    // key's family is immutable — a change of lifecycle is a new key.
    const reclassified = newId<'ActivityId'>(new Date(T0.getTime() + 2));
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Activity" ("id","accountId","activityTypeKey","family","contentVersion","contentKey","createdAt")
       VALUES ($1,$2,'hunt','WALL_CLOCK','v1','hunt.rookgaard.sewers',$3)`,
      reclassified,
      account,
      T0,
    );
    await expect(
      withTransaction(prisma, (tx) => activity.assertRegistryMatchesDatabase(tx)),
    ).rejects.toThrow(/registry says SESSION_BOUND|family is immutable/);
  });
});
