// §14.7 — R1 to R3. Redis holds nothing that matters (§11.1, §11.2).
//
// These cases are deliberately destructive: they flush the whole instance and
// lose every scheduled job, then assert that the system's answers are
// unchanged. If any of them starts failing, something durable has been moved
// into Redis, and that is exactly what they exist to catch.
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  UndocumentedRedisKey,
  REDIS_KEY_FAMILIES,
  activity,
  activityClaimKey,
  character,
  contentCacheKey,
  createRedisPort,
  economy,
  identity,
  rateLimitKey,
  sessionPresenceKey,
  withTransaction,
} from '@global-idle/domain';
import {
  accountId as toAccountId,
  activityId as toActivityId,
  contentVersion as toContentVersion,
  operationId as toOperationId,
  sessionId as toSessionId,
} from '@global-idle/shared';
import {
  ORIGIN_LEVEL,
  T0,
  T_HUNT_KEY,
  createClient,
  seedBundle,
  truncateAll,
} from '../support/db.js';
import { createMaintenanceQueue, scheduleGraceExpiryCheck } from '../../apps/worker/src/queues.js';

const prisma = createClient();
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const port = createRedisPort(redis);

const at = (m: number) => new Date(T0.getTime() + m * 60_000);

/** A whole account's worth of durable state, created through domain services
 *  — the same paths a user's actions would take (§11.3). */
async function seedDurableState() {
  const accountId = await withTransaction(prisma, async (tx) => {
    const id = await identity.createAccount(tx, { at: T0, rosterCapacity: 5 });
    await identity.grant(tx, {
      accountId: id,
      kind: 'PREMIUM',
      validFrom: T0,
      validUntil: null,
      reason: 'test',
    });
    return id;
  });

  const knight = await withTransaction(prisma, (tx) =>
    character.createCharacter(tx, {
      accountId,
      vocation: 'KNIGHT',
      name: 'Knight',
      baseLevel: ORIGIN_LEVEL,
      at: T0,
    }),
  );
  const druid = await withTransaction(prisma, (tx) =>
    character.createCharacter(tx, {
      accountId,
      vocation: 'DRUID',
      name: 'Druid',
      baseLevel: ORIGIN_LEVEL,
      at: T0,
    }),
  );

  const activityId = await withTransaction(prisma, (tx) =>
    activity.startSessionBound(tx, {
      accountId,
      activityTypeKey: activity.HUNT,
      contentKey: T_HUNT_KEY,
      contentVersion: toContentVersion('v1'),
      participants: [knight, druid],
      claimHolderSessionId: toSessionId('session-1'),
      rngSeed: 'seed',
      at: T0,
    }),
  );

  return { accountId, knight, druid, activityId };
}

/** Everything PostgreSQL knows, in one object, so "unchanged" is a single
 *  comparison rather than a list of assertions that can quietly go stale. */
async function durableSnapshot(accountId: string) {
  const [account, characters, stamina, entitlements, activities, participants, claims, balance] =
    await Promise.all([
      prisma.account.findUnique({ where: { id: accountId } }),
      prisma.character.findMany({ where: { accountId }, orderBy: { vocation: 'asc' } }),
      prisma.characterStamina.findMany({ orderBy: { characterId: 'asc' } }),
      prisma.entitlement.findMany({ where: { accountId } }),
      prisma.activity.findMany({ where: { accountId } }),
      prisma.activityParticipant.findMany({ orderBy: { characterId: 'asc' } }),
      prisma.occupancyClaim.findMany({ orderBy: { characterId: 'asc' } }),
      prisma.currencyBalance.findMany({ where: { accountId } }),
    ]);
  const ledger = await prisma.ledgerEntry.findMany({
    where: { accountId },
    orderBy: { id: 'asc' },
  });
  return {
    account,
    characters,
    stamina,
    entitlements,
    activities,
    participants,
    claims,
    balance,
    ledger,
  };
}

beforeEach(async () => {
  await truncateAll(prisma);
  await redis.flushall();
  await seedBundle(prisma, 'v1');
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe('§14.7 redis', () => {
  it('R1: a total Redis flush loses no durable state', async () => {
    const { accountId, activityId } = await seedDurableState();
    // Currency too, because it is the durable state whose loss would be least
    // forgivable (ADR-003).
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(accountId)),
        currency: 'GOLD',
        amount: 500n,
        reasonCode: 'TEST_CREDIT',
        operationId: toOperationId('redis-r1-credit'),
        at: T0,
      }),
    );

    const before = await durableSnapshot(accountId);

    // Populate EVERY documented key family, so the flush below is total in
    // practice and not merely in principle.
    await port.set(sessionPresenceKey('session-1'), 'online');
    await port.set(activityClaimKey(accountId), JSON.stringify({ activityId }));
    await port.set(rateLimitKey(`account:${accountId}`), '7');
    await port.set(contentCacheKey('v1'), JSON.stringify({ definitions: [] }));
    const queue = createMaintenanceQueue(redis);
    await scheduleGraceExpiryCheck(queue, activityId, at(5), T0);
    expect(await redis.dbsize()).toBeGreaterThan(0);

    await redis.flushall();

    // Nothing is left in Redis...
    expect(await redis.dbsize()).toBe(0);
    // ...and nothing durable moved.
    expect(await durableSnapshot(accountId)).toEqual(before);

    // The claim is still authoritative, read straight from PostgreSQL.
    const holder = await withTransaction(prisma, (tx) =>
      activity.currentHolder(tx, toActivityId(activityId)),
    );
    expect(holder).toBe('session-1');
    await queue.close();
  });

  it('R2: caches and runtime state rebuild from PostgreSQL', async () => {
    const { accountId, activityId } = await seedDurableState();
    const account = toAccountId(accountId);

    // A read through the cache answers from PostgreSQL and fronts the answer.
    const first = await withTransaction(prisma, (tx) => activity.readClaim(port, tx, account));
    expect(first).toEqual({ activityId, claimHolderSessionId: 'session-1' });
    expect(await redis.get(activityClaimKey(accountId))).not.toBeNull();

    // Flush everything. The cache is gone; the answer is not.
    await redis.flushall();
    expect(await redis.get(activityClaimKey(accountId))).toBeNull();

    const rebuilt = await withTransaction(prisma, (tx) => activity.readClaim(port, tx, account));
    expect(rebuilt).toEqual(first);
    // ...and the fast path is warm again, rebuilt from the durable source.
    expect(await redis.get(activityClaimKey(accountId))).not.toBeNull();

    // The cache FRONTS the claim; it never decides it. After a transfer the
    // fronted value is dropped, and the next read is the new truth.
    await withTransaction(prisma, (tx) =>
      activity.transferClaim(
        tx,
        toActivityId(activityId),
        toSessionId('session-1'),
        toSessionId('session-2'),
      ),
    );
    await activity.invalidateClaim(port, account);
    const afterTransfer = await withTransaction(prisma, (tx) =>
      activity.readClaim(port, tx, account),
    );
    expect(afterTransfer?.claimHolderSessionId).toBe('session-2');

    // Every family has a documented rebuild path, and that is enforced rather
    // than documented: a key outside the table cannot be written at all.
    expect(REDIS_KEY_FAMILIES.map((family) => family.prefix)).toEqual([
      'session:presence',
      'activity:claim',
      'bull',
      'ratelimit',
      'cache:content',
    ]);
    for (const family of REDIS_KEY_FAMILIES) {
      expect(family.ifFlushed.length).toBeGreaterThan(0);
    }
    await expect(port.set('durable:balance:123', '999')).rejects.toBeInstanceOf(
      UndocumentedRedisKey,
    );
  });

  it('R3: a lost scheduled job delays a decision but does not change one', async () => {
    const lost = await seedDurableState();
    await withTransaction(prisma, (tx) =>
      activity.pauseForGrace(tx, toActivityId(lost.activityId), at(5)),
    );

    // The prompt path: a delayed job really is enqueued, so this case is about
    // a job that was lost rather than one that was never wired up.
    const queue = createMaintenanceQueue(redis);
    await scheduleGraceExpiryCheck(queue, lost.activityId, at(5), T0);
    expect(await queue.getJobCountByTypes('delayed')).toBe(1);

    // Now LOSE it. No worker ever consumes it, and the queue is wiped.
    await redis.flushall();
    expect(await queue.getJobCountByTypes('delayed')).toBe(0);

    // Before the deadline the sweeper decides nothing: expiry comes from the
    // persisted timestamp, not from a job having fired.
    expect((await activity.sweepExpiredGrace(prisma, at(1))).ended).toEqual([]);
    expect(
      (
        await prisma.sessionBoundActivity.findUniqueOrThrow({
          where: { activityId: lost.activityId },
        })
      ).state,
    ).toBe('RECONNECT_GRACE_PAUSED');

    // After it, the sweeper reaches the decision the lost job would have.
    expect((await activity.sweepExpiredGrace(prisma, at(10))).ended).toEqual([lost.activityId]);

    // The CONTROL: the same activity on another account, whose job fired on
    // time. Same terminal state, reached earlier — a delay, not a different
    // outcome.
    await truncateAll(prisma);
    await seedBundle(prisma, 'v1');
    const onTime = await seedDurableState();
    await withTransaction(prisma, (tx) =>
      activity.pauseForGrace(tx, toActivityId(onTime.activityId), at(5)),
    );
    expect((await activity.sweepExpiredGrace(prisma, at(5))).ended).toEqual([onTime.activityId]);

    const settled = await prisma.sessionBoundActivity.findUniqueOrThrow({
      where: { activityId: onTime.activityId },
    });
    expect(settled.state).toBe('ACTIVITY_ENDED');
    expect(settled.graceExpiresAt).toBeNull();
    // Claims released, roster snapshot retained (O14).
    expect(await prisma.occupancyClaim.count()).toBe(0);
    expect(await prisma.activityParticipant.count()).toBe(2);

    // At-least-once delivery: running it again changes nothing.
    expect((await activity.sweepExpiredGrace(prisma, at(20))).ended).toEqual([]);
    expect(await prisma.occupancyClaim.count()).toBe(0);
    expect(await prisma.activityParticipant.count()).toBe(2);
    await queue.close();
  });
});
