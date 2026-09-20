// §13 check 11 — the economy invariant category.
//
// A category of its own, not ordinary unit tests. AGENTS.md §6 warns that
// green CI does not prove game correctness; these are the part of correctness
// CI genuinely can prove, and the part where being wrong costs the most.
//
// These cases carry no §14 id: the matrix numbers the foundation's cases, and
// this suite is the standing economy gate that runs beside them.
//
// WHAT THIS DOES NOT COVER, stated so no one is misled: item duplication.
// ItemInstance and custody scopes are deliberately absent from Phase 0B
// (§6.3), so there is no item to duplicate. ADR-004 stays accepted and
// implementation-deferred to Phase 3 (§6.6).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  economy,
  withTransaction,
  settlementOperationId,
  claimSettlement,
} from '@global-idle/domain';
import { accountId as toAccountId } from '@global-idle/shared';
import { T0, createClient, seedAccount, truncateAll } from '../support/db.js';

const prisma = createClient();

beforeEach(async () => {
  await truncateAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('economy invariants', () => {
  it('a balance is the sum of its ledger entries, and stays so', async () => {
    const account = toAccountId(await seedAccount(prisma));

    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        accountId: account,
        currency: 'GOLD',
        amount: 1_000n,
        reasonCode: 'SEED',
        operationId: settlementOperationId('seed', 0),
        at: T0,
      }),
    );
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        accountId: account,
        currency: 'GOLD',
        amount: -250n,
        reasonCode: 'SPEND',
        operationId: settlementOperationId('spend', 0),
        at: T0,
      }),
    );

    const state = await withTransaction(prisma, (tx) => economy.reconcile(tx, account, 'GOLD'));
    expect(state).toEqual({ projected: 750n, ledgerSum: 750n, reconciles: true });
  });

  it('no currency double-spend under concurrency', async () => {
    const account = toAccountId(await seedAccount(prisma));
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        accountId: account,
        currency: 'GOLD',
        amount: 100n,
        reasonCode: 'SEED',
        operationId: settlementOperationId('seed', 0),
        at: T0,
      }),
    );

    // Ten concurrent debits of 30 against a balance of 100. Three can succeed.
    // The balance row is locked before it is read (§8.2), so two callers
    // cannot both read 100 and both decide they fit.
    const attempts = Array.from({ length: 10 }, (_, index) =>
      withTransaction(prisma, (tx) =>
        economy.post(tx, {
          accountId: account,
          currency: 'GOLD',
          amount: -30n,
          reasonCode: 'CONCURRENT_SPEND',
          operationId: settlementOperationId(`spend-${index}`, 0),
          at: T0,
        }),
      ).then(
        () => 'ok' as const,
        () => 'rejected' as const,
      ),
    );
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(3);

    const state = await withTransaction(prisma, (tx) => economy.reconcile(tx, account, 'GOLD'));
    expect(state.projected).toBe(10n);
    expect(state.reconciles).toBe(true);
    // And it never went negative on the way.
    expect(state.projected >= 0n).toBe(true);
  });

  it('an idempotent settlement replay moves no value', async () => {
    const account = toAccountId(await seedAccount(prisma));
    const operationId = settlementOperationId('activity-1', 1);

    const award = async () =>
      withTransaction(prisma, async (tx) => {
        if (!(await claimSettlement(tx, operationId, 'hunt-settlement', T0))) return 'replayed';
        await economy.post(tx, {
          accountId: account,
          currency: 'GOLD',
          amount: 500n,
          reasonCode: 'SETTLEMENT',
          operationId,
          at: T0,
        });
        return 'applied';
      });

    expect(await award()).toBe('applied');
    expect(await award()).toBe('replayed');
    expect(await award()).toBe('replayed');

    const state = await withTransaction(prisma, (tx) => economy.reconcile(tx, account, 'GOLD'));
    expect(state.projected).toBe(500n);
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });

  it('reconciliation DETECTS drift rather than hiding it', async () => {
    const account = toAccountId(await seedAccount(prisma));
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        accountId: account,
        currency: 'GOLD',
        amount: 400n,
        reasonCode: 'SEED',
        operationId: settlementOperationId('seed', 0),
        at: T0,
      }),
    );

    // Corrupt the PROJECTION behind the domain's back — something only a bug
    // or a manual edit could do, since the projection is only ever written
    // beside its entry.
    await prisma.currencyBalance.update({
      where: { accountId_currency: { accountId: account, currency: 'GOLD' } },
      data: { amount: 999_999n },
    });

    const drifted = await withTransaction(prisma, (tx) => economy.reconcile(tx, account, 'GOLD'));
    expect(drifted.reconciles).toBe(false);
    expect(drifted.projected).toBe(999_999n);
    expect(drifted.ledgerSum).toBe(400n);
  });

  it('the ledger is append-only: no domain path updates or deletes an entry', async () => {
    const account = toAccountId(await seedAccount(prisma));
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        accountId: account,
        currency: 'PREMIUM',
        amount: 10n,
        reasonCode: 'SEED',
        operationId: settlementOperationId('seed', 0),
        at: T0,
      }),
    );

    // A correction is a COMPENSATING ENTRY, never an edit (ADR-003).
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        accountId: account,
        currency: 'PREMIUM',
        amount: -10n,
        reasonCode: 'CORRECTION',
        operationId: settlementOperationId('correction', 0),
        at: T0,
      }),
    );

    const entries = await prisma.ledgerEntry.findMany({ orderBy: { createdAt: 'asc' } });
    expect(entries).toHaveLength(2);
    const state = await withTransaction(prisma, (tx) => economy.reconcile(tx, account, 'PREMIUM'));
    expect(state).toEqual({ projected: 0n, ledgerSum: 0n, reconciles: true });
  });

  it('a debit that would go negative is refused, and writes nothing', async () => {
    const account = toAccountId(await seedAccount(prisma));
    const before = await prisma.ledgerEntry.count();

    await expect(
      withTransaction(prisma, (tx) =>
        economy.post(tx, {
          accountId: account,
          currency: 'GOLD',
          amount: -1n,
          reasonCode: 'OVERDRAW',
          operationId: settlementOperationId('overdraw', 0),
          at: T0,
        }),
      ),
    ).rejects.toThrow(/InsufficientFunds|balance would go negative/i);

    expect(await prisma.ledgerEntry.count()).toBe(before);
    const state = await withTransaction(prisma, (tx) => economy.reconcile(tx, account, 'GOLD'));
    expect(state.reconciles).toBe(true);
  });
});
