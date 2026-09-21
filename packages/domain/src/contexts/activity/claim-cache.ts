/**
 * The Redis fast path over the account activity claim (§11.1). INTERNAL to the
 * activity context.
 *
 * PostgreSQL is authoritative (ADR-009, §6.3.2). This is a read-THROUGH cache,
 * which is the only kind that can be flushed without losing anything: a miss
 * is not an answer, it is a trip to the durable source.
 *
 * Nothing WRITES the claim here. Transfers go through transferClaim's
 * compare-and-swap, and this cache is invalidated after them — a cache that
 * can decide who holds a claim is a second source of truth.
 */
import type { AccountId, SessionId } from '@global-idle/shared';
import { activityClaimKey, type RedisPort } from '../../platform/redis/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';

export interface ClaimView {
  readonly activityId: string;
  readonly claimHolderSessionId: SessionId | null;
}

/** The authoritative read: the account's one non-terminal session-bound
 *  activity and who holds it (I9). */
export async function readClaimFromDatabase(
  tx: UnitOfWork,
  accountId: AccountId,
): Promise<ClaimView | null> {
  const rows = await tx.$queryRawUnsafe<
    { activityId: string; claimHolderSessionId: string | null }[]
  >(
    `SELECT "activityId", "claimHolderSessionId" FROM "SessionBoundActivity"
      WHERE "accountId" = $1 AND "state" IN ('ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED')`,
    accountId,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    activityId: row.activityId,
    claimHolderSessionId: row.claimHolderSessionId as SessionId | null,
  };
}

/** Front the authoritative claim. After a total flush this simply reads
 *  PostgreSQL again and repopulates — test R2. */
export async function readClaim(
  redis: RedisPort,
  tx: UnitOfWork,
  accountId: AccountId,
): Promise<ClaimView | null> {
  return redis.readThrough(activityClaimKey(accountId), () => readClaimFromDatabase(tx, accountId));
}

/** Drop the fronted value. Called after any write that could change the
 *  answer, so the next read goes to the source rather than serving a decision
 *  that is no longer true. */
export async function invalidateClaim(redis: RedisPort, accountId: AccountId): Promise<void> {
  await redis.del(activityClaimKey(accountId));
}
