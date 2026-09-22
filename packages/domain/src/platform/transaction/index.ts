/**
 * Transaction boundaries and retry behaviour (§8.1-§8.5).
 *
 * Each operation named in §8.1 is EXACTLY ONE transaction; partial application
 * must be impossible. This module owns the retry policy so no call site
 * invents its own.
 */
import { MAX_SERIALIZATION_RETRIES } from '@global-idle/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { withCommittedEvents } from '../observability/index.js';

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
      // One event buffer PER ATTEMPT (§12.2). A retried attempt rolled its
      // writes back, and the events it reported have to go with them —
      // wrapping the whole loop would emit a "success" line for a transaction
      // that never committed.
      return await withCommittedEvents(() =>
        prisma.$transaction(body, {
          isolationLevel: options.isolation ?? 'ReadCommitted',
          timeout: options.timeoutMs ?? 15_000,
        }),
      );
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
 *   Account -> Character (ascending id) -> Activity (and its HuntRun)
 *           -> ActivityParticipant (ascending characterId)
 *           -> OccupancyClaim (ascending characterId)
 *           -> CurrencyBalance (ascending subjectId) -> LedgerEntry
 *
 * HuntRun is keyed BY its Activity and is a 1:1 extension of it, so it locks
 * at the Activity position rather than getting a position of its own.
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

/**
 * What a locked HuntRun row says about whether it is already over.
 *
 * `present: false` means there is no run for that Activity at all, which is a
 * different thing from a run that has ended and must not be collapsed into it.
 */
export type HuntRunLock =
  { readonly present: false } | { readonly present: true; readonly endedReason: string | null };

/**
 * Lock a HuntRun row and report the ending it already carries.
 *
 * This is what makes a run's TERMINAL TRANSITION once-only against concurrent
 * callers rather than against sequential retries. Two requests that both want
 * to end the same run — a poll that has just simulated a death and a Leave
 * that arrived at the same instant — serialize here, and the second one sees
 * the first one's ending instead of settling a second penalty.
 *
 * The lock and the test are ONE statement on purpose. `FOR UPDATE` followed by
 * a separate read is two statements, and under ReadCommitted each takes its
 * own snapshot: the row this returns is the version the lock was granted on,
 * so there is no window between proving the run is live and acting on it.
 *
 * Callers take the Character lock FIRST (§8.5 above). Locking a HuntRun is
 * cheap to repeat: a caller that already holds the row re-acquires it without
 * waiting, so `endRun` can guard itself without knowing who called it.
 */
export async function lockHuntRun(tx: UnitOfWork, activityId: string): Promise<HuntRunLock> {
  const rows = await tx.$queryRawUnsafe<{ endedReason: string | null }[]>(
    `SELECT "endedReason" FROM "HuntRun" WHERE "activityId" = $1 FOR UPDATE`,
    activityId,
  );
  const row = rows[0];
  return row === undefined ? { present: false } : { present: true, endedReason: row.endedReason };
}

export async function lockBalance(
  tx: UnitOfWork,
  subjectId: string,
  custody: string,
  currency: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT "subjectId" FROM "CurrencyBalance"
      WHERE "subjectId" = $1 AND custody = $2::"CurrencyCustody" AND currency = $3::"CurrencyKind"
      FOR UPDATE`,
    subjectId,
    custody,
    currency,
  );
}
