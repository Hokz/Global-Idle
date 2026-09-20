/**
 * Transaction boundaries and retry behaviour (§8.1-§8.5).
 *
 * Each operation named in §8.1 is EXACTLY ONE transaction; partial application
 * must be impossible. This module owns the retry policy so no call site
 * invents its own.
 */
import { MAX_SERIALIZATION_RETRIES } from '@global-idle/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';

/** The transactional handle a domain operation receives. */
export type UnitOfWork = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export type IsolationLevel = 'ReadCommitted' | 'RepeatableRead' | 'Serializable';

export interface TransactionOptions {
  readonly isolation?: IsolationLevel;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

/** PostgreSQL class 40 — serialization failure and deadlock detected. */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

function sqlState(error: unknown): string | undefined {
  const candidate = error as { code?: string; meta?: { code?: string } };
  if (typeof candidate?.meta?.code === 'string') return candidate.meta.code;
  if (typeof candidate?.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
    return candidate.code;
  }
  return undefined;
}

export function isRetryable(error: unknown): boolean {
  const state = sqlState(error);
  if (state && RETRYABLE_SQLSTATES.has(state)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /could not serialize access|deadlock detected/i.test(message);
}

const backoffMs = (attempt: number): number => 5 * 2 ** (attempt - 1);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `body` in one transaction, retrying ONLY a serialization failure or
 * deadlock, at most {@link MAX_SERIALIZATION_RETRIES} times (§8.3).
 *
 * A unique-constraint violation on a claim is NOT retried: the caller decides,
 * because a blind retry would turn "someone else won the race" into a spin.
 */
export async function withTransaction<T>(
  prisma: PrismaClient,
  body: (tx: UnitOfWork) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_SERIALIZATION_RETRIES;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(body, {
        isolationLevel: options.isolation ?? 'ReadCommitted',
        timeout: options.timeoutMs ?? 15_000,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts) throw error;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

/**
 * Lock rows in the ONE global order of §8.5:
 *
 *   Account -> Character (ascending id) -> Activity
 *           -> ActivityParticipant (ascending characterId)
 *           -> OccupancyClaim (ascending characterId)
 *           -> CurrencyBalance (ascending accountId) -> LedgerEntry
 *
 * Two party starts touching the same Characters therefore cannot deadlock.
 * This helper exists so the order is obeyed by construction rather than by
 * each call site remembering it.
 */
export async function lockCharactersInOrder(
  tx: UnitOfWork,
  characterIds: readonly string[],
): Promise<void> {
  const ordered = [...new Set(characterIds)].sort();
  if (ordered.length === 0) return;
  await tx.$queryRawUnsafe(
    `SELECT id FROM "Character" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    ordered,
  );
}

export async function lockAccount(tx: UnitOfWork, accountId: string): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT id FROM "Account" WHERE id = $1 FOR UPDATE`, accountId);
}

export async function lockBalance(
  tx: UnitOfWork,
  accountId: string,
  currency: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT "accountId" FROM "CurrencyBalance" WHERE "accountId" = $1 AND currency = $2::"CurrencyKind" FOR UPDATE`,
    accountId,
    currency,
  );
}
