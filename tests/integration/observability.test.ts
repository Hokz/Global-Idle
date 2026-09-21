// Observability, proven through the REAL flows (§12.2, §12.3).
//
// A metric that is registered and never incremented, and an event type that is
// declared and never emitted, both look identical to a test that only checks
// `/metrics` for a name or calls the logging helper directly. So nothing here
// calls the port: every case performs the actual domain operation and then
// asserts what the adapter recorded.
//
// These cases are additional to the §14 matrix and deliberately carry no
// matrix ids.
import type { Registry } from 'prom-client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  claimSettlement,
  createIdempotencyPort,
  createMetrics,
  createMetricsPort,
  economy,
  fingerprintOf,
  identity,
  setObservability,
  settlementOperationId,
  withTransaction,
  type DomainLogEvent,
  type Metrics,
} from '@global-idle/domain';
import {
  accountId as toAccountId,
  activityId as toActivityId,
  characterId as toCharacterId,
  contentVersion as toContentVersion,
  operationId as toOperationId,
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

let registry: Registry;
let metrics: Metrics;
let events: DomainLogEvent[];
let restore: () => void;

/** The real adapter, reading the real registry — so these cases prove the
 *  prom-client wiring as well as the port. */
async function counter(name: string): Promise<number> {
  const found = (await registry.getMetricsAsJSON()).find((metric) => metric.name === name);
  const values = (found?.values ?? []) as { value: number }[];
  return values.reduce((total, entry) => total + entry.value, 0);
}

async function histogramCount(name: string): Promise<number> {
  const found = (await registry.getMetricsAsJSON()).find((metric) => metric.name === name);
  const values = (found?.values ?? []) as { metricName?: string; value: number }[];
  return values.find((entry) => entry.metricName === `${name}_count`)?.value ?? 0;
}

const kinds = () => events.map((event) => event.kind);
const eventOf = <K extends DomainLogEvent['kind']>(kind: K) =>
  events.find((event) => event.kind === kind) as Extract<DomainLogEvent, { kind: K }> | undefined;

beforeEach(async () => {
  await truncateAll(prisma);
  await seedBundle(prisma, 'v1');

  metrics = createMetrics({ defaultMetrics: false });
  registry = metrics.registry;
  events = [];
  restore = setObservability({
    metrics: createMetricsPort(metrics),
    events: (event) => events.push(event),
  });
});

afterEach(() => {
  restore();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function startHunt(account: string, characters: string[], session = 'session-1') {
  return withTransaction(prisma, (tx) =>
    activity.startSessionBound(tx, {
      accountId: toAccountId(account),
      activityTypeKey: activity.HUNT,
      contentVersion: toContentVersion('v1'),
      participants: characters.map(toCharacterId),
      claimHolderSessionId: toSessionId(session),
      rngSeed: 'seed',
      at: T0,
    }),
  );
}

describe('§12.3 metrics are incremented by the behaviour they observe', () => {
  it('counts an occupancy conflict when a claim is refused, and nothing else', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const other = await seedAccount(prisma, { at: new Date(T0.getTime() + 1) });

    await startHunt(account, [knight]);
    expect(await counter('occupancy_conflicts_total')).toBe(0);

    // The SAME Character, claimed by a second activity on another account.
    await expectDomainError(startHunt(other, [knight], 'session-2'), 'OccupancyConflict');
    expect(await counter('occupancy_conflicts_total')).toBe(1);

    // An unrelated failure must NOT be counted as a conflict: an unknown
    // activity type never reaches the claim at all.
    await expectDomainError(
      withTransaction(prisma, (tx) =>
        activity.startSessionBound(tx, {
          accountId: toAccountId(other),
          activityTypeKey: 'not-a-registered-type' as never,
          contentVersion: toContentVersion('v1'),
          participants: [toCharacterId(knight)],
          claimHolderSessionId: toSessionId('session-3'),
          rngSeed: 'seed',
          at: T0,
        }),
      ),
      'ActivityTypeUnknown',
    );
    expect(await counter('occupancy_conflicts_total')).toBe(1);
  });

  it('observes settlement duration on every settlement, and counts only real failures', async () => {
    const operationId = settlementOperationId('activity-1', 1);

    const applied = await withTransaction(prisma, (tx) =>
      claimSettlement(tx, operationId, 'test', T0),
    );
    expect(applied).toBe(true);
    expect(await histogramCount('settlement_duration_seconds')).toBe(1);
    expect(await counter('settlement_failures_total')).toBe(0);

    // A replay is a settlement that RAN and did nothing — observed, and not a
    // failure. That distinction is the whole point of §7.6.
    const replayed = await withTransaction(prisma, (tx) =>
      claimSettlement(tx, operationId, 'test', T0),
    );
    expect(replayed).toBe(false);
    expect(await histogramCount('settlement_duration_seconds')).toBe(2);
    expect(await counter('settlement_failures_total')).toBe(0);
  });

  it('counts a settlement that actually fails', async () => {
    await expect(
      withTransaction(prisma, (tx) =>
        // A NOT NULL violation on the settlement statement itself: the
        // operation genuinely failed rather than being refused upstream.
        claimSettlement(tx, null as unknown as ReturnType<typeof toOperationId>, 'test', T0),
      ),
    ).rejects.toThrow();

    expect(await counter('settlement_failures_total')).toBe(1);
    expect(await histogramCount('settlement_duration_seconds')).toBe(1);
  });

  it('counts an idempotent replay, and separately an incompatible key reuse', async () => {
    const account = await seedAccount(prisma);
    const port = createIdempotencyPort((body) => withTransaction(prisma, body));
    const identityKey = {
      principalId: toAccountId(account),
      commandNamespace: 'test',
      clientKey: 'key-1',
    };
    const fingerprint = fingerprintOf({ amount: 1 });

    const first = await port.execute(identityKey, fingerprint, T0, async () => 'value');
    expect(first.outcome).toBe('executed');
    expect(await counter('idempotency_replays_total')).toBe(0);
    expect(await counter('idempotency_conflicts_total')).toBe(0);

    const second = await port.execute(identityKey, fingerprint, T0, async () => 'value');
    expect(second.outcome).toBe('replayed');
    expect(await counter('idempotency_replays_total')).toBe(1);
    expect(await counter('idempotency_conflicts_total')).toBe(0);

    // The same key with a DIFFERENT request. Rejected, and counted as the
    // client-behaviour signal it is — not as a replay.
    const conflicting = await port.execute(
      identityKey,
      fingerprintOf({ amount: 2 }),
      T0,
      async () => 'other',
    );
    expect(conflicting.outcome).toBe('conflict');
    expect(await counter('idempotency_conflicts_total')).toBe(1);
    expect(await counter('idempotency_replays_total')).toBe(1);
  });
});

describe('§12.2 always-logged events are emitted by the flows that cause them', () => {
  it('emits economy.operation with its operation id when a posting commits', async () => {
    const account = await seedAccount(prisma);

    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        accountId: toAccountId(account),
        currency: 'GOLD',
        amount: 250n,
        reasonCode: 'TEST_CREDIT',
        operationId: toOperationId('op-economy-1'),
        at: T0,
      }),
    );

    expect(kinds()).toContain('economy.operation');
    expect(eventOf('economy.operation')).toMatchObject({
      accountId: account,
      currency: 'GOLD',
      amount: '250',
      reasonCode: 'TEST_CREDIT',
      operationId: 'op-economy-1',
    });
  });

  it('emits occupancy.acquired and occupancy.released around a real activity', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const druid = await seedCharacter(prisma, account, 'DRUID');

    const id = await startHunt(account, [knight, druid]);
    expect(eventOf('occupancy.acquired')).toMatchObject({
      activityId: id,
      characterIds: [knight, druid].sort(),
    });
    expect(kinds()).not.toContain('occupancy.released');

    events = [];
    await withTransaction(prisma, (tx) => activity.endActivity(tx, toActivityId(id), T0));
    expect(eventOf('occupancy.released')).toMatchObject({ activityId: id, released: 2 });
  });

  it('emits activity.transition on start, grace and end', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');

    const id = await startHunt(account, [knight]);
    expect(eventOf('activity.transition')).toMatchObject({
      activityId: id,
      family: 'SESSION_BOUND',
      to: 'ONLINE_ACTIVE',
    });

    events = [];
    await withTransaction(prisma, (tx) =>
      activity.pauseForGrace(tx, toActivityId(id), new Date(T0.getTime() + 60_000)),
    );
    expect(eventOf('activity.transition')).toMatchObject({ to: 'RECONNECT_GRACE_PAUSED' });

    events = [];
    await withTransaction(prisma, (tx) => activity.endActivity(tx, toActivityId(id), T0));
    expect(eventOf('activity.transition')).toMatchObject({ to: 'ACTIVITY_ENDED' });
  });

  it('emits session.evicted only when a previous holder actually loses the claim', async () => {
    const account = await seedAccount(prisma);
    const knight = await seedCharacter(prisma, account, 'KNIGHT');
    const id = await startHunt(account, [knight], 'session-1');

    events = [];
    await withTransaction(prisma, (tx) =>
      activity.transferClaim(
        tx,
        toActivityId(id),
        toSessionId('session-1'),
        toSessionId('session-2'),
      ),
    );
    expect(eventOf('session.evicted')).toMatchObject({
      accountId: account,
      previousSessionId: 'session-1',
      newSessionId: 'session-2',
    });

    // Re-asserting the same holder evicts nobody.
    events = [];
    await withTransaction(prisma, (tx) =>
      activity.transferClaim(
        tx,
        toActivityId(id),
        toSessionId('session-2'),
        toSessionId('session-2'),
      ),
    );
    expect(kinds()).not.toContain('session.evicted');
  });

  it('emits entitlement.transition on grant and on revoke', async () => {
    const account = await seedAccount(prisma);

    const entitlementId = await withTransaction(prisma, (tx) =>
      identity.grant(tx, {
        accountId: toAccountId(account),
        kind: 'PREMIUM',
        validFrom: T0,
        validUntil: null,
        reason: 'test',
      }),
    );
    expect(eventOf('entitlement.transition')).toMatchObject({
      accountId: account,
      entitlementId,
      transition: 'GRANTED',
    });

    events = [];
    await withTransaction(prisma, (tx) =>
      identity.revoke(tx, entitlementId, new Date(T0.getTime() + 1_000), 'test'),
    );
    expect(eventOf('entitlement.transition')).toMatchObject({
      accountId: account,
      entitlementId,
      transition: 'REVOKED',
    });
  });

  it('emits nothing for a transaction that rolls back', async () => {
    const account = await seedAccount(prisma);

    await expect(
      withTransaction(prisma, async (tx) => {
        await economy.post(tx, {
          accountId: toAccountId(account),
          currency: 'GOLD',
          amount: 100n,
          reasonCode: 'TEST_CREDIT',
          operationId: toOperationId('op-rolled-back'),
          at: T0,
        });
        throw new Error('rolled back on purpose');
      }),
    ).rejects.toThrow(/rolled back on purpose/);

    // The write is gone, and so is the line that would have claimed it
    // happened. A "success" event for a vanished row is worse than silence.
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(events).toEqual([]);
  });
});
