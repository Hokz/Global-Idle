/**
 * Ledger and balance projection (ADR-003, ECONOMY_INTEGRITY.md).
 *
 * INTERNAL to the economy context. Nothing outside it may import this file —
 * only contexts/economy/index.ts is public (§4.2, test W11).
 *
 * A balance is a PROJECTION of an append-only ledger. The projection is
 * updated in the SAME transaction as the entry it reflects, and it is never
 * the source of truth: {@link reconcile} recomputes from the entries.
 */
import { newId, type AccountId, type Instant, type OperationId } from '@global-idle/shared';
import { insufficientFunds } from '../../platform/errors/index.js';
import { recordDomainEvent } from '../../platform/observability/index.js';
import { lockBalance, type UnitOfWork } from '../../platform/transaction/index.js';

export type CurrencyKind = 'GOLD' | 'PREMIUM';

export interface LedgerPosting {
  readonly accountId: AccountId;
  readonly currency: CurrencyKind;
  /** Signed. Credit is positive, debit is negative. */
  readonly amount: bigint;
  readonly reasonCode: string;
  readonly operationId: OperationId;
  readonly at: Instant;
}

/**
 * Append one entry and move the projection with it, in one transaction.
 *
 * The balance row is locked FIRST (§8.2: balances and ledger take pessimistic
 * row locks, §8.5: CurrencyBalance before LedgerEntry), so two concurrent
 * debits cannot both read the same balance and both decide they fit.
 */
export async function post(tx: UnitOfWork, posting: LedgerPosting): Promise<bigint> {
  await ensureBalanceRow(tx, posting.accountId, posting.currency, posting.at);
  await lockBalance(tx, posting.accountId, posting.currency);

  const current = await readBalance(tx, posting.accountId, posting.currency);
  const next = current + posting.amount;
  if (next < 0n) {
    throw insufficientFunds({
      accountId: posting.accountId,
      currency: posting.currency,
      balance: current.toString(),
      requested: posting.amount.toString(),
    });
  }

  await tx.ledgerEntry.create({
    data: {
      id: newId<'LedgerEntryId'>(posting.at),
      accountId: posting.accountId,
      currency: posting.currency,
      amount: posting.amount,
      reasonCode: posting.reasonCode,
      operationId: posting.operationId,
      createdAt: posting.at,
    },
  });

  await tx.currencyBalance.update({
    where: { accountId_currency: { accountId: posting.accountId, currency: posting.currency } },
    data: { amount: next, updatedAt: posting.at },
  });

  // §12.2 always logs economy operations WITH THEIR OPERATION IDS — the field
  // that makes a ledger line traceable to the command that produced it. The
  // amount is stringified because a bigint has no JSON form and a log line
  // that throws is worse than one that is absent.
  recordDomainEvent({
    kind: 'economy.operation',
    accountId: posting.accountId,
    currency: posting.currency,
    amount: posting.amount.toString(),
    reasonCode: posting.reasonCode,
    operationId: posting.operationId,
  });

  return next;
}

async function ensureBalanceRow(
  tx: UnitOfWork,
  accountId: AccountId,
  currency: CurrencyKind,
  at: Instant,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "CurrencyBalance" ("accountId", "currency", "amount", "updatedAt")
     VALUES ($1, $2::"CurrencyKind", 0, $3) ON CONFLICT DO NOTHING`,
    accountId,
    currency,
    at,
  );
}

export async function readBalance(
  tx: UnitOfWork,
  accountId: AccountId,
  currency: CurrencyKind,
): Promise<bigint> {
  const row = await tx.currencyBalance.findUnique({
    where: { accountId_currency: { accountId, currency } },
    select: { amount: true },
  });
  return row?.amount ?? 0n;
}

export interface Reconciliation {
  readonly projected: bigint;
  readonly ledgerSum: bigint;
  readonly reconciles: boolean;
}

/**
 * I5 — the projection reconciles to the ledger. This recomputes from the
 * entries rather than trusting the column, which is the only way the check
 * means anything.
 */
export async function reconcile(
  tx: UnitOfWork,
  accountId: AccountId,
  currency: CurrencyKind,
): Promise<Reconciliation> {
  const projected = await readBalance(tx, accountId, currency);
  const rows = await tx.$queryRawUnsafe<{ sum: bigint | null }[]>(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS sum
       FROM "LedgerEntry" WHERE "accountId" = $1 AND currency = $2::"CurrencyKind"`,
    accountId,
    currency,
  );
  const ledgerSum = rows[0]?.sum ?? 0n;
  return { projected, ledgerSum, reconciles: projected === ledgerSum };
}

/**
 * How many (account, currency) pairs disagree between the ledger and its
 * projection, across the whole database. Feeds
 * `ledger_reconciliation_mismatches`, which §12.3 says MUST BE ZERO — any
 * non-zero value is a P1.
 *
 * A FULL OUTER JOIN, because drift runs both ways: a projection whose sum is
 * wrong, and a projection that is missing for entries that exist.
 */
export async function countReconciliationMismatches(tx: UnitOfWork): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ mismatches: number }[]>(
    `WITH ledger AS (
       SELECT "accountId", currency, SUM(amount)::bigint AS total
         FROM "LedgerEntry" GROUP BY "accountId", currency
     ), projection AS (
       SELECT "accountId", currency, amount AS total FROM "CurrencyBalance"
     )
     SELECT count(*)::int AS mismatches
       FROM ledger FULL OUTER JOIN projection
         ON ledger."accountId" = projection."accountId"
        AND ledger.currency = projection.currency
      WHERE COALESCE(ledger.total, 0) <> COALESCE(projection.total, 0)`,
  );
  return rows[0]?.mismatches ?? 0;
}
