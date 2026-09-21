// §14.4 — A1 to A6. The account activity claim holder (§6.3.2, ADR-008).
//
// The claim is authoritative in PostgreSQL; Redis only fronts it. Every case
// here is about that asymmetry.
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { activity, withTransaction } from '@global-idle/domain';
import {
  accountId as toAccountId,
  activityId as toActivityId,
  characterId as toCharacterId,
  contentVersion as toContentVersion,
  minutes,
  sessionId as toSessionId,
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

async function startHunt(accountId: string, characters: string[], session: string) {
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

beforeEach(async () => {
  await truncateAll(prisma);
  await seedBundle(prisma, 'v1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('§14.4 activity claim', () => {
  it('A1: only one authoritative Account Activity claim exists at a time', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const druid = await seedCharacter(prisma, account, 'DRUID');

    await startHunt(account, [knight], 'session-1');
    // A second non-terminal session-bound activity for the same account is
    // refused by the partial unique index (I9) — not by application code.
    await expect(startHunt(account, [druid], 'session-2')).rejects.toThrow();

    const live = await prisma.sessionBoundActivity.count({
      where: { accountId: account, state: { in: ['ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED'] } },
    });
    expect(live).toBe(1);
  });

  it('A2: claim transfer is atomic — no instant with two holders', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const hunt = await startHunt(account, [knight], 'session-1');

    // Five newest-connection-wins transfers racing from the same expected
    // holder. Exactly one can swap; the rest see zero rows updated.
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        withTransaction(prisma, (tx) =>
          activity.transferClaim(
            tx,
            toActivityId(hunt),
            toSessionId('session-1'),
            toSessionId(`session-new-${index}`),
          ),
        ).then(
          () => 'transferred' as const,
          () => 'held' as const,
        ),
      ),
    );

    expect(outcomes.filter((o) => o === 'transferred')).toHaveLength(1);

    // And there is exactly one holder afterwards — the row itself can only
    // carry one value, which is the point of putting it there.
    const holder = await withTransaction(prisma, (tx) =>
      activity.currentHolder(tx, toActivityId(hunt)),
    );
    expect(holder).toMatch(/^session-new-\d$/);
  });

  it('A3: a paused activity reserves its claim', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const hunt = await startHunt(account, [knight], 'session-1');

    await withTransaction(prisma, (tx) =>
      activity.pauseForGrace(tx, toActivityId(hunt), at(minutes(5))),
    );

    const row = await prisma.sessionBoundActivity.findUniqueOrThrow({
      where: { activityId: hunt },
    });
    expect(row.state).toBe('RECONNECT_GRACE_PAUSED');
    // The holder is KEPT: grace is a reservation, not a release.
    expect(row.claimHolderSessionId).toBe('session-1');
    expect(await prisma.occupancyClaim.count({ where: { activityId: hunt } })).toBe(1);

    // And it still counts against I9: the account cannot start another.
    const druid = await seedCharacter(prisma, account, 'DRUID');
    await expect(startHunt(account, [druid], 'session-2')).rejects.toThrow();
  });

  it('A4: claimHolderSessionId survives a process restart and a full Redis flush', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const hunt = await startHunt(account, [knight], 'session-durable');

    const redis = new Redis(process.env['REDIS_URL'] as string);
    try {
      // Redis fronts the claim; it is not the claim.
      await redis.set(`activity:claim:${account}`, 'session-durable');
      await redis.set(`session:presence:session-durable`, '1');
      expect(await redis.get(`activity:claim:${account}`)).toBe('session-durable');

      await redis.flushall();
      expect(await redis.get(`activity:claim:${account}`)).toBeNull();

      // A brand-new client stands in for a restarted process: nothing cached,
      // nothing in memory.
      const afterRestart = createClient();
      try {
        const holder = await withTransaction(afterRestart, (tx) =>
          activity.currentHolder(tx, toActivityId(hunt)),
        );
        expect(holder).toBe('session-durable');

        const row = await afterRestart.sessionBoundActivity.findUniqueOrThrow({
          where: { activityId: hunt },
        });
        expect(row.state).toBe('ONLINE_ACTIVE');
      } finally {
        await afterRestart.$disconnect();
      }
    } finally {
      await redis.quit();
    }
  });

  it('A5: compare-and-swap with a stale expected holder affects zero rows and returns ActivityClaimHeld', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const hunt = await startHunt(account, [knight], 'session-1');

    await withTransaction(prisma, (tx) =>
      activity.transferClaim(
        tx,
        toActivityId(hunt),
        toSessionId('session-1'),
        toSessionId('session-2'),
      ),
    );

    // The stale expectation no longer matches, so the swap touches nothing.
    await expectDomainError(
      withTransaction(prisma, (tx) =>
        activity.transferClaim(
          tx,
          toActivityId(hunt),
          toSessionId('session-1'),
          toSessionId('session-3'),
        ),
      ),
      'ActivityClaimHeld',
    );

    // The holder is unchanged: the loser did not overwrite the winner.
    expect(
      await withTransaction(prisma, (tx) => activity.currentHolder(tx, toActivityId(hunt))),
    ).toBe('session-2');

    // A terminal activity cannot be claimed at all.
    await withTransaction(prisma, (tx) => activity.endActivity(tx, toActivityId(hunt), at(1)));
    await expectDomainError(
      withTransaction(prisma, (tx) =>
        activity.transferClaim(
          tx,
          toActivityId(hunt),
          toSessionId('session-2'),
          toSessionId('session-4'),
        ),
      ),
      'ActivityClaimHeld',
    );
  });

  it('A6: staleness is decided from graceExpiresAt, not from absent presence', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const hunt = await startHunt(account, [knight], 'session-1');
    const graceEnds = at(minutes(5));
    await withTransaction(prisma, (tx) =>
      activity.pauseForGrace(tx, toActivityId(hunt), graceEnds),
    );

    // Presence is GONE, and that alone means nothing: a holder with no live
    // presence is not stale, because that is exactly what grace is for.
    const redis = new Redis(process.env['REDIS_URL'] as string);
    try {
      await redis.flushall();
      expect(await redis.get(`session:presence:session-1`)).toBeNull();

      // Inside the window, decided from the timestamp: not stale.
      expect(activity.isGraceExpired(graceEnds, at(minutes(4)))).toBe(false);
      expect(
        await withTransaction(prisma, (tx) => activity.findExpiredGrace(tx, at(minutes(4)))),
      ).toEqual([]);

      // At and after the deadline: stale.
      expect(activity.isGraceExpired(graceEnds, graceEnds)).toBe(true);
      expect(activity.isGraceExpired(graceEnds, at(minutes(6)))).toBe(true);
      const expired = await withTransaction(prisma, (tx) =>
        activity.findExpiredGrace(tx, at(minutes(6))),
      );
      expect(expired.map((row) => row.activityId)).toEqual([hunt]);

      // An activity with no deadline is never stale by this rule.
      expect(activity.isGraceExpired(null, at(minutes(600)))).toBe(false);
    } finally {
      await redis.quit();
    }
  });
});
