// §14.2 — D1 to D9. The schema's load-bearing constraints, exercised against a
// real PostgreSQL. Every case asserts that the DATABASE refuses the invalid
// state, not that application code declined to create it.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAppRoleClient,
  createClient,
  seedAccount,
  seedCharacter,
  truncateAll,
  ORIGIN_LEVEL,
  T0,
} from '../support/db.js';
import { character, withTransaction } from '@global-idle/domain';
import { accountId as toAccountId, newId } from '@global-idle/shared';
import { run } from '../support/repo.js';

const prisma = createClient();

beforeEach(async () => {
  await truncateAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('§14.2 database', () => {
  it('D1: migrations apply cleanly from an empty database', () => {
    const result = run('pnpm', ['--filter', '@global-idle/domain', 'run', 'migrate:check']);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /D1 migrations apply cleanly from an empty database/,
    );
  }, 300_000);

  it('D2: migrations apply cleanly from the previous migration state', () => {
    const result = run('pnpm', ['--filter', '@global-idle/domain', 'run', 'migrate:check']);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /D2 migrations apply cleanly from the previous migration state/,
    );
  }, 300_000);

  it('D3: UUIDv7 ids are generated server-side and are time-ordered', async () => {
    // Generated in APPLICATION CODE (§6.2) — the column carries no database
    // default, so nothing silently generates an id behind the application.
    const [{ column_default: accountDefault }] = await prisma.$queryRawUnsafe<
      { column_default: string | null }[]
    >(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'Account' AND column_name = 'id'`,
    );
    expect(accountDefault).toBeNull();

    // Time-ordered: ids minted at increasing instants sort in that order.
    const instants = [0, 1, 2, 5, 50, 1_000].map((ms) => new Date(T0.getTime() + ms));
    const ids = instants.map((at) => newId<'AccountId'>(at));
    expect([...ids].sort()).toEqual(ids);

    // And they are v7: version nibble 7, RFC 4122 variant.
    for (const id of ids) {
      expect(id[14]).toBe('7');
      expect('89ab').toContain(id[19]);
    }

    // Round-trips through the database unchanged.
    for (const [index, at] of instants.entries()) {
      await prisma.account.create({ data: { id: ids[index]!, rosterCapacity: 1, createdAt: at } });
    }
    const stored = await prisma.account.findMany({ orderBy: { id: 'asc' }, select: { id: true } });
    expect(stored.map((row) => row.id)).toEqual(ids);
  });

  it('D4: two playable Characters of the same vocation on one account is rejected', async () => {
    const account = await seedAccount(prisma);
    await seedCharacter(prisma, account, 'KNIGHT');
    await expect(seedCharacter(prisma, account, 'KNIGHT')).rejects.toThrow();

    // A different vocation is fine, and so is the same vocation on another account.
    await expect(seedCharacter(prisma, account, 'DRUID')).resolves.toBeDefined();
    const other = await seedAccount(prisma, { at: new Date(T0.getTime() + 1) });
    await expect(seedCharacter(prisma, other, 'KNIGHT')).resolves.toBeDefined();
  });

  it('D5: a retired Character does not reserve its vocation', async () => {
    const account = await seedAccount(prisma);
    const retired = await seedCharacter(prisma, account, 'KNIGHT', {
      retiredAt: new Date(T0.getTime() + 1_000),
    });

    // ADR-007: retirement frees the vocation for a new playable Character...
    const replacement = await seedCharacter(prisma, account, 'KNIGHT', {
      at: new Date(T0.getTime() + 2_000),
    });
    expect(replacement).not.toBe(retired);

    // ...and the retired row is still there. A Character is never deleted (I12).
    const rows = await prisma.character.findMany({ where: { accountId: account } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.retiredAt === null)).toHaveLength(1);
  });

  it('D6: retiring a Character does not reduce rosterCapacity', async () => {
    const account = await seedAccount(prisma, { rosterCapacity: 3 });
    const character = await seedCharacter(prisma, account, 'PALADIN');
    await prisma.character.update({
      where: { id: character },
      data: { retiredAt: new Date(T0.getTime() + 1_000) },
    });
    const after = await prisma.account.findUniqueOrThrow({ where: { id: account } });
    expect(after.rosterCapacity).toBe(3);
  });

  it('D7: rosterCapacity outside 1 to 5 is rejected', async () => {
    for (const capacity of [0, -1, 6, 99]) {
      await expect(
        prisma.account.create({
          data: { id: newId<'AccountId'>(T0), rosterCapacity: capacity, createdAt: T0 },
        }),
      ).rejects.toThrow();
    }
    for (const capacity of [1, 3, 5]) {
      await expect(
        prisma.account.create({
          data: {
            id: newId<'AccountId'>(new Date(T0.getTime() + capacity)),
            rosterCapacity: capacity,
            createdAt: T0,
          },
        }),
      ).resolves.toBeDefined();
    }
  });

  it('D8: count(playable) <= rosterCapacity holds under concurrent creation', async () => {
    const account = await seedAccount(prisma, { rosterCapacity: 2 });
    const vocations = ['KNIGHT', 'PALADIN', 'SORCERER', 'DRUID', 'MONK'] as const;

    // Five concurrent creations against a capacity of two, through the SAME
    // service a player's action would use. The count cannot be a column
    // constraint, so it is verified INSIDE the creating transaction with the
    // Account row locked (§6.4) — and this asserts the application does that,
    // not merely that the pattern works when a test writes it out.
    const attempts = vocations.map((vocation, index) =>
      withTransaction(prisma, (tx) =>
        character.createCharacter(tx, {
          accountId: toAccountId(account),
          vocation,
          name: vocation,
          baseLevel: ORIGIN_LEVEL,
          at: new Date(T0.getTime() + index),
        }),
      ).then(
        () => 'created' as const,
        (error: unknown) => {
          // Rejected for the RIGHT reason: a serialization failure or a
          // deadlock would also reject, and would not prove the invariant.
          expect((error as { code?: string }).code).toBe('RosterCapacityExceeded');
          return 'rejected' as const;
        },
      ),
    );

    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(2);

    const playable = await prisma.character.count({
      where: { accountId: account, retiredAt: null },
    });
    expect(playable).toBe(2);
  });

  it('D9: the application role cannot UPDATE or DELETE a ledger row', async () => {
    const account = await seedAccount(prisma);
    const entryId = newId<'LedgerEntryId'>(T0);
    await prisma.ledgerEntry.create({
      data: {
        id: entryId,
        accountId: account,
        currency: 'GOLD',
        amount: 100n,
        reasonCode: 'TEST_CREDIT',
        operationId: 'op-d9',
        createdAt: T0,
      },
    });

    const appRole = createAppRoleClient();
    try {
      // It may read and append...
      await expect(appRole.ledgerEntry.count()).resolves.toBe(1);
      await expect(
        appRole.ledgerEntry.create({
          data: {
            id: newId<'LedgerEntryId'>(new Date(T0.getTime() + 1)),
            accountId: account,
            currency: 'GOLD',
            amount: -50n,
            reasonCode: 'TEST_DEBIT',
            operationId: 'op-d9b',
            createdAt: T0,
          },
        }),
      ).resolves.toBeDefined();

      // ...and it has no UPDATE or DELETE to issue. I6 is a database
      // permission, which is what makes it true for a developer who has never
      // read ADR-003.
      await expect(
        appRole.ledgerEntry.update({ where: { id: entryId }, data: { amount: 1n } }),
      ).rejects.toThrow(/permission denied/i);
      await expect(appRole.ledgerEntry.delete({ where: { id: entryId } })).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await appRole.$disconnect();
    }
  });
});
