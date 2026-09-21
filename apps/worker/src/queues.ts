/**
 * Queue SETUP (§11.2). A queue is a TRIGGER, never a decision.
 *
 * Two ways in, one handler:
 *
 * - a DELAYED job scheduled when an activity enters reconnect grace, so the
 *   decision is taken promptly;
 * - a REPEATABLE sweep that covers the jobs that were never delivered.
 *
 * Both call the same domain operation, which decides from persisted
 * timestamps. That is what makes a lost job a delay rather than a different
 * outcome (test R3).
 *
 * The NAMES live in packages/domain (§5.2: apps/api reports this queue's depth
 * and may not import this file). What lives here is the construction, the
 * scheduling and the shutdown.
 */
import { Queue, type ConnectionOptions } from 'bullmq';
import {
  GRACE_EXPIRY_JOB,
  GRACE_SWEEP_INTERVAL_MS,
  GRACE_SWEEP_SCHEDULER,
  MAINTENANCE_QUEUE,
  currentCorrelationId,
  type GraceExpiryJobData,
} from '@global-idle/domain';

export function createMaintenanceQueue(connection: ConnectionOptions): Queue<GraceExpiryJobData> {
  return new Queue<GraceExpiryJobData>(MAINTENANCE_QUEUE, {
    connection,
    defaultJobOptions: {
      // At-least-once delivery is assumed, so retries are safe: every job here
      // is idempotent (§11.2).
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1_000 },
    },
  });
}

/** The safety net. Upserted at boot, so restarting the worker neither
 *  duplicates it nor loses it. */
export async function scheduleGraceSweep(queue: Queue<GraceExpiryJobData>): Promise<void> {
  await queue.upsertJobScheduler(
    GRACE_SWEEP_SCHEDULER,
    { every: GRACE_SWEEP_INTERVAL_MS },
    { name: GRACE_EXPIRY_JOB, data: {} },
  );
}

/**
 * The prompt path: check this activity when its grace is due.
 *
 * If this job is lost, the sweep above still ends the activity — later, but
 * identically. Nothing about the outcome depends on this job existing.
 */
export async function scheduleGraceExpiryCheck(
  queue: Queue<GraceExpiryJobData>,
  activityId: string,
  graceExpiresAt: Date,
  now: Date,
): Promise<void> {
  const correlationId = currentCorrelationId();
  await queue.add(
    GRACE_EXPIRY_JOB,
    correlationId ? { activityId, correlationId } : { activityId },
    {
      delay: Math.max(0, graceExpiresAt.getTime() - now.getTime()),
      // One pending check per activity: re-entering grace replaces it rather
      // than stacking a second. BullMQ refuses a custom id containing ':',
      // which is its own key separator.
      jobId: `${GRACE_EXPIRY_JOB}-${activityId}`,
    },
  );
}
