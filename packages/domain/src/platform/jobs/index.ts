/**
 * Job contract (§11.2). NAMES ONLY — no BullMQ, no connection, no scheduling.
 *
 * Both applications need to agree on what a queue is called: the worker
 * consumes it, and `/metrics` reports its depth. Neither app may import the
 * other (§5.2), so the agreement lives here, in the package they both depend
 * on. The SETUP — constructing the Queue and the Worker, scheduling, shutdown
 * — stays in `apps/worker`, which owns it.
 */

export const MAINTENANCE_QUEUE = 'activity-maintenance';
export const GRACE_EXPIRY_JOB = 'grace-expiry';
export const GRACE_SWEEP_SCHEDULER = 'grace-expiry-sweep';

/** How often the safety net runs. Frequent enough that a lost job is a small
 *  delay, cheap enough to run forever: the query reads an indexed predicate
 *  and usually returns no rows. */
export const GRACE_SWEEP_INTERVAL_MS = 30_000;

/**
 * The job carries no decision — at most a hint about which activity prompted
 * it, and the correlation id of whatever caused it, so a job's log lines join
 * up with the request that scheduled it (§12.2).
 */
export interface GraceExpiryJobData {
  readonly activityId?: string;
  readonly correlationId?: string;
}
