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

/**
 * WHERE value sits (ADR-019).
 *
 * `BANK` is account-scoped and safe. `POUCH` is character-scoped and CARRIED —
 * it is what a Hunt fills and what death forfeits. There is no default: a
 * caller that did not say which scope it meant would otherwise credit the safe
 * one, which is the defect this dimension exists to remove.
 */
export type CurrencyCustody = 'BANK' | 'POUCH';

/**
 * Who holds the value, and in which scope.
 *
 * `subjectId` is the Account for `BANK` and the Character for `POUCH`; the
 * database CHECKs that pairing rather than trusting every call site.
 */
export interface CustodySubject {
  readonly accountId: AccountId;
  readonly custody: CurrencyCustody;
  /** The carrying Character. Required for POUCH, forbidden for BANK. */
  readonly characterId?: string;
}

/** The Account's safe, stored Gold. */
export const bankOf = (accountId: AccountId): CustodySubject => ({ accountId, custody: 'BANK' });

/** What a Character is CARRYING, and can lose. */
export const pouchOf = (accountId: AccountId, characterId: string): CustodySubject => ({
  accountId,
  custody: 'POUCH',
  characterId,
});

/** The row key `subjectId` a scope projects onto. */
export function subjectIdOf(subject: CustodySubject): string {
  if (subject.custody === 'BANK') {
    if (subject.characterId !== undefined) {
      throw new RangeError('A BANK scope is account-wide and must not name a Character.');
    }
    return String(subject.accountId);
  }
  if (!subject.characterId) {
    throw new RangeError('A POUCH scope is carried BY a Character and must name one.');
  }
  return subject.characterId;
}

export interface LedgerPosting {
  /** WHERE the value sits. ADR-019 — there is no default scope. */
  readonly subject: CustodySubject;
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
  const subjectId = subjectIdOf(posting.subject);
  const { accountId, custody } = posting.subject;

  await ensureBalanceRow(tx, subjectId, posting.subject, posting.currency, posting.at);
  await lockBalance(tx, subjectId, custody, posting.currency);

  const current = await readBalance(tx, posting.subject, posting.currency);
  const next = current + posting.amount;
  if (next < 0n) {
    throw insufficientFunds({
      accountId,
      currency: posting.currency,
      balance: current.toString(),
      requested: posting.amount.toString(),
    });
  }

  await tx.ledgerEntry.create({
    data: {
      id: newId<'LedgerEntryId'>(posting.at),
      accountId,
      subjectId,
      custody,
      currency: posting.currency,
      amount: posting.amount,
      reasonCode: posting.reasonCode,
      operationId: posting.operationId,
      createdAt: posting.at,
    },
  });

  await tx.currencyBalance.update({
    where: {
      subjectId_custody_currency: { subjectId, custody, currency: posting.currency },
    },
    data: { amount: next, updatedAt: posting.at },
  });

  // §12.2 always logs economy operations WITH THEIR OPERATION IDS — the field
  // that makes a ledger line traceable to the command that produced it. The
  // amount is stringified because a bigint has no JSON form and a log line
  // that throws is worse than one that is absent.
  recordDomainEvent({
    kind: 'economy.operation',
    accountId,
    custody,
    subjectId,
    currency: posting.currency,
    amount: posting.amount.toString(),
    reasonCode: posting.reasonCode,
    operationId: posting.operationId,
  });

  return next;
}

async function ensureBalanceRow(
  tx: UnitOfWork,
  subjectId: string,
  subject: CustodySubject,
  currency: CurrencyKind,
  at: Instant,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "CurrencyBalance"
       ("subjectId", "custody", "currency", "accountId", "amount", "updatedAt")
     VALUES ($1, $2::"CurrencyCustody", $3::"CurrencyKind", $4, 0, $5)
     ON CONFLICT DO NOTHING`,
    subjectId,
    subject.custody,
    currency,
    subject.accountId,
    at,
  );
}

export async function readBalance(
  tx: UnitOfWork,
  subject: CustodySubject,
  currency: CurrencyKind,
): Promise<bigint> {
  const row = await tx.currencyBalance.findUnique({
    where: {
      subjectId_custody_currency: {
        subjectId: subjectIdOf(subject),
        custody: subject.custody,
        currency,
      },
    },
    select: { amount: true },
  });
  return row?.amount ?? 0n;
}

/**
 * Move value BETWEEN scopes, as one operation.
 *
 * DOUBLE ENTRY, deliberately: two entries under one operation id, summing to
 * zero. A single "move" entry would be value destroyed in one scope and
 * created in another, and reconciliation would be right to call that drift.
 */
export async function transfer(
  tx: UnitOfWork,
  input: {
    readonly from: CustodySubject;
    readonly to: CustodySubject;
    readonly currency: CurrencyKind;
    /** Positive. */
    readonly amount: bigint;
    readonly reasonCode: string;
    readonly operationId: OperationId;
    readonly at: Instant;
  },
): Promise<void> {
  if (input.amount <= 0n) {
    throw new RangeError(`A transfer moves a positive amount, got ${input.amount}.`);
  }
  await post(tx, {
    subject: input.from,
    currency: input.currency,
    amount: -input.amount,
    reasonCode: input.reasonCode,
    operationId: input.operationId,
    at: input.at,
  });
  await post(tx, {
    subject: input.to,
    currency: input.currency,
    amount: input.amount,
    reasonCode: input.reasonCode,
    operationId: input.operationId,
    at: input.at,
  });
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
  subject: CustodySubject,
  currency: CurrencyKind,
): Promise<Reconciliation> {
  const subjectId = subjectIdOf(subject);
  const projected = await readBalance(tx, subject, currency);
  const rows = await tx.$queryRawUnsafe<{ sum: bigint | null }[]>(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS sum
       FROM "LedgerEntry"
      WHERE "subjectId" = $1 AND custody = $2::"CurrencyCustody" AND currency = $3::"CurrencyKind"`,
    subjectId,
    subject.custody,
    currency,
  );
  const ledgerSum = rows[0]?.sum ?? 0n;
  return { projected, ledgerSum, reconciles: projected === ledgerSum };
}

/**
 * How many (subject, custody, currency) scopes disagree between the ledger and
 * its projection, across the whole database. Feeds
 * `ledger_reconciliation_mismatches`, which §12.3 says MUST BE ZERO — any
 * non-zero value is a P1.
 *
 * PER SCOPE since ADR-019, which is the same guarantee at the granularity the
 * data now has: a Character's pouch cannot silently disagree with its own
 * entries by being averaged into its account's bank.
 *
 * A FULL OUTER JOIN, because drift runs both ways: a projection whose sum is
 * wrong, and a projection that is missing for entries that exist.
 */
export async function countReconciliationMismatches(tx: UnitOfWork): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ mismatches: number }[]>(
    `WITH ledger AS (
       SELECT "subjectId", custody, currency, SUM(amount)::bigint AS total
         FROM "LedgerEntry" GROUP BY "subjectId", custody, currency
     ), projection AS (
       SELECT "subjectId", custody, currency, amount AS total FROM "CurrencyBalance"
     )
     SELECT count(*)::int AS mismatches
       FROM ledger FULL OUTER JOIN projection
         ON ledger."subjectId" = projection."subjectId"
        AND ledger.custody = projection.custody
        AND ledger.currency = projection.currency
      WHERE COALESCE(ledger.total, 0) <> COALESCE(projection.total, 0)`,
  );
  return rows[0]?.mismatches ?? 0;
}
