/**
 * The account activity claim holder (§6.3.2, ADR-008). INTERNAL to the
 * activity context.
 *
 * Newest connection wins, with an ATOMIC transfer. The claim holder is durable
 * in PostgreSQL; presence is ephemeral in Redis and is NOT consulted here.
 */
import type { ActivityId, Instant, SessionId } from '@global-idle/shared';
import { activityClaimHeld } from '../../platform/errors/index.js';
import { recordDomainEvent } from '../../platform/observability/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';

/**
 * Compare-and-swap in one statement. Zero rows updated means another session
 * won the race: the caller receives ActivityClaimHeld and does NOT retry
 * blindly (§8.3). At no instant do two sessions hold the claim, because the
 * swap is the single write that decides it.
 */
export async function transferClaim(
  tx: UnitOfWork,
  activityId: ActivityId,
  expectedHolder: SessionId | null,
  newHolder: SessionId,
): Promise<void> {
  // RETURNING, so the swap is still ONE statement but also tells us whose
  // claim it was: §12.2 always logs a session eviction, and the account it
  // happened on is the only thing that makes the line useful.
  const swapped = await tx.$queryRawUnsafe<{ accountId: string }[]>(
    `UPDATE "SessionBoundActivity"
        SET "claimHolderSessionId" = $1
      WHERE "activityId" = $2
        AND "claimHolderSessionId" IS NOT DISTINCT FROM $3
        AND "state" <> 'ACTIVITY_ENDED'
   RETURNING "accountId"`,
    newHolder,
    activityId,
    expectedHolder,
  );
  if (swapped.length !== 1) {
    throw activityClaimHeld({
      activityId,
      expectedHolder,
      newHolder,
      rowsAffected: swapped.length,
    });
  }

  // An eviction is a PREVIOUS holder losing the claim (ADR-008). Taking an
  // unheld claim is an acquisition, and reporting it as an eviction would
  // make the count meaningless.
  if (expectedHolder !== null && expectedHolder !== newHolder) {
    recordDomainEvent({
      kind: 'session.evicted',
      accountId: swapped[0]!.accountId,
      previousSessionId: expectedHolder,
      newSessionId: newHolder,
    });
  }
}

export async function currentHolder(
  tx: UnitOfWork,
  activityId: ActivityId,
): Promise<SessionId | null> {
  const row = await tx.sessionBoundActivity.findUnique({
    where: { activityId },
    select: { claimHolderSessionId: true },
  });
  return (row?.claimHolderSessionId ?? null) as SessionId | null;
}

/**
 * Staleness is decided from `graceExpiresAt` against the server clock, NEVER
 * from presence being absent (§6.3.2, §11.2).
 *
 * A holder with no live presence is not by itself stale — that is exactly what
 * reconnect grace is for. Deciding from presence would evict a player whose
 * websocket blipped.
 */
export function isGraceExpired(graceExpiresAt: Instant | null, now: Instant): boolean {
  if (graceExpiresAt === null) return false;
  return now.getTime() >= graceExpiresAt.getTime();
}

/** Non-terminal session-bound activities whose grace has run out, decided from
 *  persisted timestamps rather than from a job having fired (§11.2). */
export async function findExpiredGrace(
  tx: UnitOfWork,
  now: Instant,
): Promise<{ activityId: string }[]> {
  return tx.$queryRawUnsafe<{ activityId: string }[]>(
    `SELECT "activityId" FROM "SessionBoundActivity"
      WHERE "state" = 'RECONNECT_GRACE_PAUSED' AND "graceExpiresAt" IS NOT NULL
        AND "graceExpiresAt" <= $1`,
    now,
  );
}
