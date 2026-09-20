// §14.6 — I1 to I4. ADR-017's two mechanisms.
//
// NOTE ON NAMING: these are the idempotency TESTS I1-I4 of §14.6. The
// invariants I1-I16 of DOMAIN_MODEL.md share the letter and are a different
// namespace, as §14 states at its head.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdempotencyPort,
  fingerprintOf,
  settlementOperationId,
  claimSettlement,
  withTransaction,
} from '@global-idle/domain';
import { accountId as toAccountId } from '@global-idle/shared';
import { T0, createClient, seedAccount, truncateAll } from '../support/db.js';

const prisma = createClient();
const port = createIdempotencyPort((body) => withTransaction(prisma, body));

beforeEach(async () => {
  await truncateAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('§14.6 idempotency', () => {
  it('I1: same principal, namespace, key and fingerprint returns the original result', async () => {
    const account = await seedAccount(prisma);
    const identity = {
      principalId: toAccountId(account),
      commandNamespace: 'character.create',
      clientKey: 'key-1',
    };
    const fingerprint = fingerprintOf({ vocation: 'KNIGHT', name: 'Bjorn' });

    let executions = 0;
    const body = async () => {
      executions += 1;
      return { characterId: `char-${executions}` };
    };

    const first = await port.execute(identity, fingerprint, T0, body);
    expect(first).toEqual({ outcome: 'executed', result: { characterId: 'char-1' } });

    // A replay returns the ORIGINAL result and does not run the body again.
    const second = await port.execute(identity, fingerprint, T0, body);
    expect(second).toEqual({ outcome: 'replayed', result: { characterId: 'char-1' } });
    expect(executions).toBe(1);

    // Field ORDER must not matter: a client that serialises differently on a
    // retry has not changed its request.
    const reordered = fingerprintOf({ name: 'Bjorn', vocation: 'KNIGHT' });
    expect(reordered).toBe(fingerprint);
    const third = await port.execute(identity, reordered, T0, body);
    expect(third.outcome).toBe('replayed');
    expect(executions).toBe(1);
  });

  it('I2: same scope with a different fingerprint is rejected, executes nothing, overwrites nothing', async () => {
    const account = await seedAccount(prisma);
    const identity = {
      principalId: toAccountId(account),
      commandNamespace: 'character.create',
      clientKey: 'key-2',
    };

    let executions = 0;
    const body = async () => {
      executions += 1;
      return { value: executions };
    };

    await port.execute(identity, fingerprintOf({ vocation: 'KNIGHT' }), T0, body);
    expect(executions).toBe(1);

    const conflict = await port.execute(identity, fingerprintOf({ vocation: 'DRUID' }), T0, body);
    expect(conflict).toEqual({ outcome: 'conflict' });
    // It did not execute...
    expect(executions).toBe(1);
    // ...and it did not overwrite.
    const stored = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        principalId_commandNamespace_clientKey: {
          principalId: account,
          commandNamespace: 'character.create',
          clientKey: 'key-2',
        },
      },
    });
    expect(stored.fingerprint).toBe(fingerprintOf({ vocation: 'KNIGHT' }));
    expect(stored.result).toEqual({ value: 1 });
  });

  it('I3: the same client key on different accounts does not collide or leak', async () => {
    const alice = await seedAccount(prisma);
    const bob = await seedAccount(prisma, { at: new Date(T0.getTime() + 1) });
    const sharedKey = 'the-same-client-key';

    const aliceResult = await port.execute(
      { principalId: toAccountId(alice), commandNamespace: 'ns', clientKey: sharedKey },
      fingerprintOf({ who: 'alice' }),
      T0,
      async () => ({ owner: 'alice' }),
    );
    const bobResult = await port.execute(
      { principalId: toAccountId(bob), commandNamespace: 'ns', clientKey: sharedKey },
      fingerprintOf({ who: 'bob' }),
      T0,
      async () => ({ owner: 'bob' }),
    );

    // Both EXECUTED — uniqueness is over the full identity, never the client
    // key alone. If the key alone were the scope, bob would have been told
    // "conflict" and, worse, could have replayed alice's result.
    expect(aliceResult).toEqual({ outcome: 'executed', result: { owner: 'alice' } });
    expect(bobResult).toEqual({ outcome: 'executed', result: { owner: 'bob' } });

    // And the namespace separates them too.
    const otherNamespace = await port.execute(
      { principalId: toAccountId(alice), commandNamespace: 'other', clientKey: sharedKey },
      fingerprintOf({ who: 'alice' }),
      T0,
      async () => ({ owner: 'alice-other' }),
    );
    expect(otherNamespace.outcome).toBe('executed');
    expect(await prisma.idempotencyRecord.count()).toBe(3);
  });

  it('I4: a deterministic settlement operation id cannot double-apply', async () => {
    const operationId = settlementOperationId('activity-xyz', 7);
    // Deterministic: same activity, same checkpoint, same id.
    expect(settlementOperationId('activity-xyz', 7)).toBe(operationId);
    expect(settlementOperationId('activity-xyz', 8)).not.toBe(operationId);

    const first = await withTransaction(prisma, (tx) =>
      claimSettlement(tx, operationId, 'stamina', T0),
    );
    expect(first).toBe(true);

    // A retry after a lost response finds the id already claimed and applies
    // nothing (§7.6, §8.3).
    const replay = await withTransaction(prisma, (tx) =>
      claimSettlement(tx, operationId, 'stamina', T0),
    );
    expect(replay).toBe(false);
    expect(await prisma.settlementOperation.count()).toBe(1);

    // Concurrent retries: exactly one wins.
    const races = await Promise.all(
      Array.from({ length: 5 }, () =>
        withTransaction(prisma, (tx) =>
          claimSettlement(tx, settlementOperationId('activity-race', 1), 'stamina', T0),
        ).catch(() => false),
      ),
    );
    expect(races.filter(Boolean)).toHaveLength(1);
  });
});
