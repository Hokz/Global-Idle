/**
 * Queue wiring (§11.2). A queue is a TRIGGER, never a decision.
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
 */
import { Queue, type ConnectionOptions } from 'bullmq';

export const MAINTENANCE_QUEUE = 'activity-maintenance';
export const GRACE_EXPIRY_JOB = 'grace-expiry';
export const GRACE_SWEEP_SCHEDULER = 'grace-expiry-sweep';

/** How often the safety net runs. Frequent enough that a lost job is a small
 *  delay, cheap enough that running it forever costs nothing: the query reads
 *  an indexed predicate and usually returns no rows. */
export const GRACE_SWEEP_INTERVAL_MS = 30_000;

/** The job carries no decision — at most a hint about which activity
 *  prompted it. The handler re-derives everything from the database. */
export interface GraceExpiryJobData {
  readonly activityId?: string;
}

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
  await queue.add(
    GRACE_EXPIRY_JOB,
    { activityId },
    {
      delay: Math.max(0, graceExpiresAt.getTime() - now.getTime()),
      // One pending check per activity: re-entering grace replaces it rather
      // than stacking a second. BullMQ refuses a custom id containing ':',
      // which is its own key separator.
      jobId: `${GRACE_EXPIRY_JOB}-${activityId}`,
    },
  );
}
