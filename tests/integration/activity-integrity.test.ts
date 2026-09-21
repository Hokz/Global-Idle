// §14.2 — D10 to D18. Activity root / subtype / participant integrity
// (§6.3.1, §6.3.3), proved against a real PostgreSQL.
//
// Several of these states are UNREPRESENTABLE through the typed client, so
// they are attempted with raw SQL. That is the point: the assertion is that
// the DATABASE refuses them, not that an ORM declined to build the query.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  T0,
  createClient,
  seedAccount,
  seedActivityRoot,
  seedBundle,
  seedCharacter,
  seedClaim,
  seedParticipant,
  truncateAll,
} from '../support/db.js';
import { newId } from '@global-idle/shared';
import { run } from '../support/repo.js';

const prisma = createClient();
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

beforeEach(async () => {
  await truncateAll(prisma);
  await seedBundle(prisma, 'v1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Insert a subtype row directly, so invalid combinations can be attempted. */
async function insertSessionBound(
  activityId: string,
  accountId: string,
  family: string,
  state = 'ONLINE_ACTIVE',
): Promise<number> {
  return prisma.$executeRawUnsafe(
    `INSERT INTO "SessionBoundActivity"
       ("activityId", "accountId", "family", "state", "claimHolderSessionId", "graceExpiresAt", "rngSeed")
     VALUES ($1, $2, $3::"ActivityFamily", $4::"SessionBoundState", NULL, NULL, 'seed')`,
    activityId,
    accountId,
    family,
    state,
  );
}

async function insertSkillTraining(
  activityId: string,
  family: string,
  traineeCharacterId: string,
  status = 'ACCRUING',
): Promise<number> {
  return prisma.$executeRawUnsafe(
    `INSERT INTO "SkillTrainingActivity"
       ("activityId", "family", "traineeCharacterId", "status", "startedAt", "lastSettledAt", "endedAt")
     VALUES ($1, $2::"ActivityFamily", $3, $4::"SkillTrainingStatus", $5, $5, NULL)`,
    activityId,
    family,
    traineeCharacterId,
    status,
    T0,
  );
}

describe('§14.2 activity integrity', () => {
  it('D10: two non-terminal session-bound activities on one account cannot coexist', async () => {
    const account = await seedAccount(prisma);
    const first = await seedActivityRoot(prisma, account, { family: 'SESSION_BOUND' });
    await insertSessionBound(first, account, 'SESSION_BOUND', 'ONLINE_ACTIVE');

    // A second, while the first is non-terminal, is refused BY THE INDEX.
    const second = await seedActivityRoot(prisma, account, {
      family: 'SESSION_BOUND',
      at: at(1),
    });
    await expect(
      insertSessionBound(second, account, 'SESSION_BOUND', 'ONLINE_ACTIVE'),
    ).rejects.toThrow();
    await expect(
      insertSessionBound(second, account, 'SESSION_BOUND', 'RECONNECT_GRACE_PAUSED'),
    ).rejects.toThrow();

    // Ending the first frees the account for a new one.
    await prisma.sessionBoundActivity.update({
      where: { activityId: first },
      data: { state: 'ACTIVITY_ENDED' },
    });
    await expect(
      insertSessionBound(second, account, 'SESSION_BOUND', 'ONLINE_ACTIVE'),
    ).resolves.toBeDefined();

    // And a terminal row does not block a third either.
    const third = await seedActivityRoot(prisma, account, { family: 'SESSION_BOUND', at: at(2) });
    await expect(
      insertSessionBound(third, account, 'SESSION_BOUND', 'ONLINE_ACTIVE'),
    ).rejects.toThrow();
  });

  it('D11: an occupancy claim naming a non-participant is refused', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const druid = await seedCharacter(prisma, account, 'DRUID');
    const activity = await seedActivityRoot(prisma, account, { family: 'SESSION_BOUND' });
    await insertSessionBound(activity, account, 'SESSION_BOUND');
    await seedParticipant(prisma, activity, knight, 'SESSION_BOUND', 0);

    // The participant may be claimed...
    await expect(seedClaim(prisma, activity, knight)).resolves.toBeUndefined();

    // ...and a Character who is not a participant of THIS activity cannot be.
    await expect(seedClaim(prisma, activity, druid)).rejects.toThrow();
  });

  it('D12: a second participant on a wall-clock activity is refused', async () => {
    const account = await seedAccount(prisma);
    const druid = await seedCharacter(prisma, account, 'DRUID');
    const monk = await seedCharacter(prisma, account, 'MONK');
    const training = await seedActivityRoot(prisma, account, { family: 'WALL_CLOCK' });

    await seedParticipant(prisma, training, druid, 'WALL_CLOCK', 0);
    await expect(seedParticipant(prisma, training, monk, 'WALL_CLOCK', 1)).rejects.toThrow();

    // A session-bound activity accepts several.
    const hunt = await seedActivityRoot(prisma, account, { family: 'SESSION_BOUND', at: at(1) });
    await insertSessionBound(hunt, account, 'SESSION_BOUND');
    await seedParticipant(prisma, hunt, druid, 'SESSION_BOUND', 0);
    await expect(seedParticipant(prisma, hunt, monk, 'SESSION_BOUND', 1)).resolves.toBeUndefined();
  });

  it('D13: the generated migration SQL carries every declared constraint', () => {
    const result = run('pnpm', ['--filter', '@global-idle/domain', 'run', 'migrate:check']);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    for (const invariant of [
      /D13 generated SQL enforces I1/,
      /D13 generated SQL enforces I9/,
      /D13 generated SQL enforces at most one participant on a wall-clock activity/,
      /D13 generated SQL enforces §6\.3\.3 — a session-bound subtype/,
      /D13 generated SQL enforces §6\.3\.3 — a wall-clock subtype/,
      /D13 generated SQL enforces I2/,
      /D13 generated SQL enforces I6/,
    ]) {
      expect(output).toMatch(invariant);
    }
  }, 300_000);

  it('D14: a Skill Training activity with no participant cannot be inserted', async () => {
    const account = await seedAccount(prisma);
    const druid = await seedCharacter(prisma, account, 'DRUID');
    const training = await seedActivityRoot(prisma, account, { family: 'WALL_CLOCK' });

    // No participant row yet: the composite FK has nothing to point at. This
    // is the "at least one" half of exactly-one (§6.3.1).
    await expect(insertSkillTraining(training, 'WALL_CLOCK', druid)).rejects.toThrow();

    // With the participant written first — §8.1's order — it commits.
    await seedParticipant(prisma, training, druid, 'WALL_CLOCK', 0);
    await expect(insertSkillTraining(training, 'WALL_CLOCK', druid)).resolves.toBeDefined();
  });

  it('D15: a wrong-family subtype is unrepresentable', async () => {
    const account = await seedAccount(prisma);
    const druid = await seedCharacter(prisma, account, 'DRUID');

    // A SessionBoundActivity on a WALL_CLOCK root, both ways round:
    const wallClockRoot = await seedActivityRoot(prisma, account, { family: 'WALL_CLOCK' });
    //   family = its own constant -> the composite FK rejects it (root disagrees)
    await expect(insertSessionBound(wallClockRoot, account, 'SESSION_BOUND')).rejects.toThrow();
    //   family = the root's value  -> the CHECK rejects it
    await expect(insertSessionBound(wallClockRoot, account, 'WALL_CLOCK')).rejects.toThrow();

    // And a SkillTrainingActivity on a SESSION_BOUND root:
    const sessionRoot = await seedActivityRoot(prisma, account, {
      family: 'SESSION_BOUND',
      at: at(1),
    });
    await seedParticipant(prisma, sessionRoot, druid, 'SESSION_BOUND', 0);
    await expect(insertSkillTraining(sessionRoot, 'WALL_CLOCK', druid)).rejects.toThrow();
    await expect(insertSkillTraining(sessionRoot, 'SESSION_BOUND', druid)).rejects.toThrow();
  });

  it('D16: both subtypes on one root is unrepresentable', async () => {
    const account = await seedAccount(prisma);
    const druid = await seedCharacter(prisma, account, 'DRUID');

    // From a session-bound root: the session-bound subtype exists, and the
    // wall-clock one cannot join it.
    const sessionRoot = await seedActivityRoot(prisma, account, { family: 'SESSION_BOUND' });
    await insertSessionBound(sessionRoot, account, 'SESSION_BOUND');
    await seedParticipant(prisma, sessionRoot, druid, 'SESSION_BOUND', 0);
    await expect(insertSkillTraining(sessionRoot, 'WALL_CLOCK', druid)).rejects.toThrow();

    // From a wall-clock root, the mirror image.
    const wallRoot = await seedActivityRoot(prisma, account, { family: 'WALL_CLOCK', at: at(1) });
    await seedParticipant(prisma, wallRoot, druid, 'WALL_CLOCK', 0);
    await insertSkillTraining(wallRoot, 'WALL_CLOCK', druid);
    await expect(insertSessionBound(wallRoot, account, 'SESSION_BOUND')).rejects.toThrow();
  });

  it('D17: a valid SESSION_BOUND activity is accepted', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const paladin = await seedCharacter(prisma, account, 'PALADIN');

    // §8.1's order: root, subtype, participants, claims — one transaction.
    await prisma.$transaction(async (tx) => {
      const id = newId<'ActivityId'>(T0);
      await tx.activity.create({
        data: {
          id,
          accountId: account,
          activityTypeKey: 'hunt',
          family: 'SESSION_BOUND',
          contentVersion: 'v1',
          contentKey: 'hunt.rookgaard.sewers',
          createdAt: T0,
        },
      });
      await tx.sessionBoundActivity.create({
        data: {
          activityId: id,
          accountId: account,
          family: 'SESSION_BOUND',
          state: 'ONLINE_ACTIVE',
          claimHolderSessionId: 'session-1',
          rngSeed: 'seed-d17',
        },
      });
      for (const [slotIndex, characterId] of [knight, paladin].entries()) {
        await tx.activityParticipant.create({
          data: {
            activityId: id,
            characterId,
            family: 'SESSION_BOUND',
            slotIndex,
            staminaActivatedAt: null,
          },
        });
        await tx.occupancyClaim.create({ data: { characterId, activityId: id, acquiredAt: T0 } });
      }
    });

    expect(await prisma.activity.count()).toBe(1);
    expect(await prisma.sessionBoundActivity.count()).toBe(1);
    expect(await prisma.activityParticipant.count()).toBe(2);
    expect(await prisma.occupancyClaim.count()).toBe(2);
    // staminaActivatedAt is the durable "not yet activated" marker (ADR-014).
    const participants = await prisma.activityParticipant.findMany();
    expect(participants.every((p) => p.staminaActivatedAt === null)).toBe(true);
  });

  it('D18: a valid WALL_CLOCK activity is accepted', async () => {
    const account = await seedAccount(prisma);
    const druid = await seedCharacter(prisma, account, 'DRUID');

    await prisma.$transaction(async (tx) => {
      const id = newId<'ActivityId'>(T0);
      await tx.activity.create({
        data: {
          id,
          accountId: account,
          activityTypeKey: 'skill-training',
          family: 'WALL_CLOCK',
          contentVersion: 'v1',
          contentKey: 'hunt.rookgaard.sewers',
          createdAt: T0,
        },
      });
      // The participant is written BEFORE the subtype, because the subtype's
      // foreign key requires it to exist (§8.1).
      await tx.activityParticipant.create({
        data: {
          activityId: id,
          characterId: druid,
          family: 'WALL_CLOCK',
          slotIndex: 0,
          staminaActivatedAt: null,
        },
      });
      await tx.skillTrainingActivity.create({
        data: {
          activityId: id,
          family: 'WALL_CLOCK',
          traineeCharacterId: druid,
          status: 'ACCRUING',
          startedAt: T0,
          lastSettledAt: T0,
        },
      });
      await tx.occupancyClaim.create({
        data: { characterId: druid, activityId: id, acquiredAt: T0 },
      });
    });

    const training = await prisma.skillTrainingActivity.findFirstOrThrow();
    expect(training.traineeCharacterId).toBe(druid);
    expect(await prisma.activityParticipant.count()).toBe(1);
    expect(await prisma.occupancyClaim.count()).toBe(1);
  });
});
