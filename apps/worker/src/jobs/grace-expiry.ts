/**
 * The grace-expiry handler (§11.2).
 *
 * It takes no arguments from the job. Whatever triggered it — a delayed job
 * for one activity or the periodic sweep — it asks the database the same
 * question: which non-terminal activities have a grace deadline in the past?
 *
 * That is the whole point. The job says WHEN to look, never WHAT to conclude.
 */
import { activity, type Clock, type PrismaClient } from '@global-idle/domain';

export async function runGraceExpiry(
  prisma: PrismaClient,
  clock: Clock,
): Promise<{ ended: readonly string[] }> {
  return activity.sweepExpiredGrace(prisma, clock.now());
}
