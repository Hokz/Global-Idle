/**
 * The periodic sweeper (§11.2). INTERNAL to the activity context.
 *
 * SCHEDULING IS NEVER THE SOURCE OF TRUTH. Grace expiry is decided from the
 * persisted `graceExpiresAt` against the server clock — never from a job
 * having fired. A BullMQ job may trigger this promptly; this sweeper covers
 * the jobs that were never delivered. A lost job therefore DELAYS a decision
 * and cannot change one (test R3).
 *
 * Idempotent by construction: findExpiredGrace only sees
 * RECONNECT_GRACE_PAUSED rows, and ending one leaves it ACTIVITY_ENDED, so a
 * second pass finds nothing to do. Job systems deliver at-least-once, and this
 * is what makes that harmless.
 */
import type { ActivityId, Instant } from '@global-idle/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { withTransaction } from '../../platform/transaction/index.js';
import { endActivity } from './lifecycle.js';

export interface SweepResult {
  /** Activities whose reconnect grace had run out and which this pass ended. */
  readonly ended: readonly string[];
}

export async function sweepExpiredGrace(prisma: PrismaClient, now: Instant): Promise<SweepResult> {
  // Each activity gets its OWN transaction. One activity that cannot be ended
  // must not prevent the rest of the sweep, and the alternative — one big
  // transaction — holds locks across the whole batch.
  const expired = await prisma.$queryRawUnsafe<{ activityId: string }[]>(
    `SELECT "activityId" FROM "SessionBoundActivity"
      WHERE "state" = 'RECONNECT_GRACE_PAUSED' AND "graceExpiresAt" IS NOT NULL
        AND "graceExpiresAt" <= $1`,
    now,
  );

  const ended: string[] = [];
  for (const row of expired) {
    await withTransaction(prisma, (tx) => endActivity(tx, row.activityId as ActivityId, now));
    ended.push(row.activityId);
  }
  return { ended };
}
