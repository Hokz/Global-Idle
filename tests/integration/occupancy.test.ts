// §14.3 — O1 to O15. Occupancy claims and restart reconciliation.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { activity, withTransaction } from '@global-idle/domain';
import {
  accountId as toAccountId,
  activityId as toActivityId,
  characterId as toCharacterId,
  contentVersion as toContentVersion,
  sessionId as toSessionId,
  minutes,
} from '@global-idle/shared';
import {
  T0,
  createClient,
  expectDomainError,
  seedAccount,
  seedBundle,
  seedCharacter,
  truncateAll,
} from '../support/db.js';

const prisma = createClient();
const at = (ms: number) => new Date(T0.getTime() + ms);

async function startHunt(accountId: string, characters: string[], session = 'session-1') {
  return withTransaction(prisma, (tx) =>
    activity.startSessionBound(tx, {
      accountId: toAccountId(accountId),
      activityTypeKey: activity.HUNT,
      contentVersion: toContentVersion('v1'),
      participants: characters.map(toCharacterId),
      claimHolderSessionId: toSessionId(session),
      rngSeed: 'seed',
      at: T0,
    }),
  );
}

async function startTraining(accountId: string, trainee: string) {
  return withTransaction(prisma, (tx) =>
    activity.startSkillTraining(tx, {
      accountId: toAccountId(accountId),
      activityTypeKey: activity.SKILL_TRAINING,
      contentVersion: toContentVersion('v1'),
      trainee: toCharacterId(trainee),
      at: T0,
    }),
  );
}

beforeEach(async () => {
  await truncateAll(prisma);
  await seedBundle(prisma, 'v1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('§14.3 occupancy', () => {
  it('O1: one Character cannot acquire two occupancy claims', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    await startHunt(account, [knight]);

    // A second activity for the same Character is refused (I13, ADR-013).
    await expectDomainError(startTraining(account, knight), 'OccupancyConflict');
    expect(await prisma.occupancyClaim.count({ where: { characterId: knight } })).toBe(1);
  });

  it('O2: different Characters acquire claims concurrently without conflict', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const druid = await seedCharacter(prisma, account, 'DRUID');
    const monk = await seedCharacter(prisma, account, 'MONK');

    const results = await Promise.all([
      startTraining(account, knight).then(
        () => 'ok',
        () => 'failed',
      ),
      startTraining(account, druid).then(
        () => 'ok',
        () => 'failed',
      ),
      startTraining(account, monk).then(
        () => 'ok',
        () => 'failed',
      ),
    ]);
    expect(results).toEqual(['ok', 'ok', 'ok']);
    expect(await prisma.occupancyClaim.count()).toBe(3);
  });

  it('O3: party acquisition is all-or-nothing', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const druid = await seedCharacter(prisma, account, 'DRUID');
    const paladin = await seedCharacter(prisma, account, 'PALADIN');

    // The Druid is already busy, so the whole party start must fail.
    await startTraining(account, druid);
    await expectDomainError(startHunt(account, [knight, druid, paladin]), 'OccupancyConflict');

    // Only the Druid's original claim survives.
    const claims = await prisma.occupancyClaim.findMany();
    expect(claims.map((c) => c.characterId)).toEqual([druid]);
  });

  it('O4: a failed party acquisition leaves no partial claim', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const druid = await seedCharacter(prisma, account, 'DRUID');
    await startTraining(account, druid);

    const before = await prisma.activity.count();
    await expect(startHunt(account, [knight, druid])).rejects.toThrow();

    // No claim, no participant rows, and no Activity row: the transaction
    // rolled the WHOLE start back.
    expect(await prisma.occupancyClaim.count({ where: { characterId: knight } })).toBe(0);
    expect(await prisma.activityParticipant.count({ where: { characterId: knight } })).toBe(0);
    expect(await prisma.activity.count()).toBe(before);
  });

  it('O5: same Character — Skill Training while hunting is rejected', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    await startHunt(account, [knight]);
    await expectDomainError(startTraining(account, knight), 'OccupancyConflict');
  });

  it('O6: different Characters — one hunting, one training, both succeed', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const druid = await seedCharacter(prisma, account, 'DRUID');

    await startHunt(account, [knight]);
    await expect(startTraining(account, druid)).resolves.toBeDefined();

    expect(await prisma.occupancyClaim.count()).toBe(2);
  });

  it('O7: reconnect grace reserves claims rather than releasing them', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const huntId = await startHunt(account, [knight]);

    await withTransaction(prisma, (tx) =>
      activity.pauseForGrace(tx, toActivityId(huntId), at(minutes(5))),
    );

    // The activity still exists, so the Character is still busy.
    expect(await prisma.occupancyClaim.count({ where: { activityId: huntId } })).toBe(1);
    const reserved = await withTransaction(prisma, (tx) => activity.reserveForGrace(tx, huntId));
    expect(reserved).toBe(1);

    // And the sweeper does not touch it: a paused activity is LIVE.
    const released = await withTransaction(prisma, (tx) => activity.reconcileStranded(tx));
    expect(released).toEqual([]);
  });

  it('O8: restart reconciliation releases only genuinely stranded claims', async () => {
    const account = await seedAccount(prisma);
    const live = await seedCharacter(prisma, account, 'KNIGHT');
    const ended = await seedCharacter(prisma, account, 'DRUID');

    await startHunt(account, [live]);
    const endedHunt = await startTraining(account, ended);
    await withTransaction(prisma, (tx) => activity.endActivity(tx, toActivityId(endedHunt), T0));

    // Ending already released that claim, so nothing is stranded...
    let released = await withTransaction(prisma, (tx) => activity.reconcileStranded(tx));
    expect(released).toEqual([]);

    // ...and a claim re-created against a terminal activity IS stranded.
    await prisma.occupancyClaim.create({
      data: { characterId: ended, activityId: endedHunt, acquiredAt: T0 },
    });
    released = await withTransaction(prisma, (tx) => activity.reconcileStranded(tx));
    expect(released.map((r) => r.characterId)).toEqual([ended]);
    expect(await prisma.occupancyClaim.count({ where: { characterId: live } })).toBe(1);
  });

  it('O9: concurrent party starts on overlapping Characters do not deadlock', async () => {
    const account = await seedAccount(prisma);
    const a = await seedCharacter(prisma, account, 'KNIGHT');
    const b = await seedCharacter(prisma, account, 'DRUID');
    const c = await seedCharacter(prisma, account, 'PALADIN');

    // Two parties naming the same Characters in OPPOSITE orders. Characters
    // are locked ascending (§8.5), so the orders converge and neither waits on
    // the other's lock.
    const outcomes = await Promise.all([
      startHunt(account, [a, b, c], 'session-a').then(
        () => 'ok',
        () => 'rejected',
      ),
      startHunt(account, [c, b, a], 'session-b').then(
        () => 'ok',
        () => 'rejected',
      ),
    ]);

    // Exactly one wins; the other is rejected, not deadlocked.
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(await prisma.occupancyClaim.count()).toBe(3);
  }, 60_000);

  it('O10: reconciliation preserves a live Skill Training claim whose training is ACCRUING', async () => {
    const account = await seedAccount(prisma);
    const druid = await seedCharacter(prisma, account, 'DRUID');
    const training = await startTraining(account, druid);

    const status = await prisma.skillTrainingActivity.findUniqueOrThrow({
      where: { activityId: training },
    });
    expect(status.status).toBe('ACCRUING');

    const released = await withTransaction(prisma, (tx) => activity.reconcileStranded(tx));
    expect(released).toEqual([]);
    expect(await prisma.occupancyClaim.count({ where: { characterId: druid } })).toBe(1);
  });

  it('O11: reconciliation releases a claim whose training is ENDED, EXHAUSTED or CANCELLED', async () => {
    const account = await seedAccount(prisma);
    for (const [vocation, terminal] of [
      ['DRUID', 'ENDED'],
      ['MONK', 'EXHAUSTED'],
      ['SORCERER', 'CANCELLED'],
    ] as const) {
      const character = await seedCharacter(prisma, account, vocation);
      const training = await startTraining(account, character);
      // Move it to terminal WITHOUT releasing, which is the state a crash
      // between the transition and the release would leave.
      await prisma.skillTrainingActivity.update({
        where: { activityId: training },
        data: { status: terminal, endedAt: T0 },
      });

      const released = await withTransaction(prisma, (tx) => activity.reconcileStranded(tx));
      expect(released.map((r) => r.characterId)).toEqual([character]);
      expect(released[0]?.reason).toBe('activity-terminal');
      expect(await prisma.occupancyClaim.count({ where: { characterId: character } })).toBe(0);
    }
  });

  it('O12: reconciliation releases a claim whose named activity row is absent', async () => {
    const account = await seedAccount(prisma);
    const druid = await seedCharacter(prisma, account, 'DRUID');
    const training = await startTraining(account, druid);

    // First: the orphan is UNREPRESENTABLE through the ordinary path. The
    // claim's composite FK to ActivityParticipant, and that row's FK to
    // Activity, mean the Activity cannot be deleted out from under a claim.
    await expect(prisma.activity.delete({ where: { id: training } })).rejects.toThrow();

    // Second: prove the sweeper's rule anyway, by constructing the state with
    // FK triggers disabled for this transaction only. A reconciliation path
    // that is never exercised is a reconciliation path nobody can trust.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(`DELETE FROM "Activity" WHERE id = $1`, training);
    });

    const released = await withTransaction(prisma, (tx) => activity.reconcileStranded(tx));
    expect(released.map((r) => r.characterId)).toEqual([druid]);
    expect(released[0]?.reason).toBe('activity-absent');
    expect(await prisma.occupancyClaim.count()).toBe(0);
  });

  it('O13: the reconciliation rule is total over every Skill Training status', async () => {
    // Enumerate from the PERSISTED enum, not from a list written here. A
    // status added to the database without a reconciliation rule fails this
    // test rather than being silently unhandled.
    const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT unnest(enum_range(NULL::"SkillTrainingStatus"))::text AS value`,
    );
    const statuses = rows.map((row) => row.value);
    expect(statuses.sort()).toEqual(['ACCRUING', 'CANCELLED', 'ENDED', 'EXHAUSTED']);

    for (const status of statuses) {
      // Every status must classify without throwing...
      const live = activity.isSkillTrainingLive(status as never);
      expect(typeof live).toBe('boolean');
      // ...and exactly ACCRUING is live.
      expect(live).toBe(status === 'ACCRUING');
    }

    // The same totality for the session-bound side.
    const sessionRows = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT unnest(enum_range(NULL::"SessionBoundState"))::text AS value`,
    );
    for (const state of sessionRows.map((r) => r.value)) {
      expect(activity.isSessionBoundLive(state as never)).toBe(state !== 'ACTIVITY_ENDED');
    }
  });

  it('O14: ending releases occupancy and preserves the roster snapshot', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const paladin = await seedCharacter(prisma, account, 'PALADIN');
    const hunt = await startHunt(account, [knight, paladin]);

    const before = await prisma.activityParticipant.findMany({
      where: { activityId: hunt },
      orderBy: { slotIndex: 'asc' },
    });
    expect(before).toHaveLength(2);

    const result = await withTransaction(prisma, (tx) =>
      activity.endActivity(tx, toActivityId(hunt), at(minutes(30))),
    );
    expect(result.claimsReleased).toBe(2);
    expect(result.participantsRetained).toBe(2);

    // Claims gone...
    expect(await prisma.occupancyClaim.count({ where: { activityId: hunt } })).toBe(0);
    // ...snapshot intact, slot order and activation markers included.
    const after = await prisma.activityParticipant.findMany({
      where: { activityId: hunt },
      orderBy: { slotIndex: 'asc' },
    });
    expect(after).toEqual(before);
    // ...and the Activity still pins its bundle.
    const root = await prisma.activity.findUniqueOrThrow({ where: { id: hunt } });
    expect(root.contentVersion).toBe('v1');

    // Every terminal Skill Training status behaves the same way.
    const druid = await seedCharacter(prisma, account, 'DRUID');
    const training = await startTraining(account, druid);
    const ended = await withTransaction(prisma, (tx) =>
      activity.endActivity(tx, toActivityId(training), at(minutes(40)), 'EXHAUSTED'),
    );
    expect(ended.claimsReleased).toBe(1);
    expect(ended.participantsRetained).toBe(1);
  });

  it('O15: the startup integrity sweep refuses an invalid Activity and never repairs it', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    await startHunt(account, [knight]);

    // A database of valid activities passes.
    await withTransaction(prisma, (tx) => activity.assertActivityIntegrity(tx));

    // A root with NO SUBTYPE: refused.
    const orphanRoot = await prisma.activity.create({
      data: {
        id: 'orphan-root',
        accountId: account,
        activityTypeKey: 'hunt',
        family: 'SESSION_BOUND',
        contentVersion: 'v1',
        createdAt: T0,
      },
    });
    await expect(
      withTransaction(prisma, (tx) => activity.assertActivityIntegrity(tx)),
    ).rejects.toThrow(/no subtype row|no participants/);

    // It NEVER repairs: the bad row is still there afterwards.
    expect(await prisma.activity.findUnique({ where: { id: orphanRoot.id } })).not.toBeNull();
    await prisma.activity.delete({ where: { id: orphanRoot.id } });

    // A session-bound root with an EMPTY ROSTER: also refused. No column can
    // make 1-4 participants mandatory the way one trainee can.
    const otherAccount = await seedAccount(prisma, { at: new Date(T0.getTime() + 99) });
    const rosterless = await prisma.activity.create({
      data: {
        id: 'rosterless',
        accountId: otherAccount,
        activityTypeKey: 'hunt',
        family: 'SESSION_BOUND',
        contentVersion: 'v1',
        createdAt: T0,
      },
    });
    await prisma.sessionBoundActivity.create({
      data: {
        activityId: rosterless.id,
        accountId: otherAccount,
        family: 'SESSION_BOUND',
        state: 'ONLINE_ACTIVE',
        rngSeed: 'seed',
      },
    });
    const findings = await withTransaction(prisma, (tx) => activity.findIntegrityViolations(tx));
    expect(findings.map((f) => f.activityId)).toContain(rosterless.id);
    await expect(
      withTransaction(prisma, (tx) => activity.assertActivityIntegrity(tx)),
    ).rejects.toThrow(/no participants/);
  });
});
