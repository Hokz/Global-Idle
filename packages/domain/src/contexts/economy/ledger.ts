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
