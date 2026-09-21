/**
 * Character occupancy claims (§7.2, ADR-013). INTERNAL to the activity context.
 *
 * At most one claim per Character, enforced by the primary key on
 * OccupancyClaim.characterId (I13). The claim's composite foreign key to
 * ActivityParticipant means it can only name a PARTICIPANT of the activity it
 * claims, so the sweeper reads the trainee through the participant row rather
 * than from a column that could have drifted.
 */
import type { CharacterId, Instant } from '@global-idle/shared';
import { occupancyConflict } from '../../platform/errors/index.js';
import { metrics, recordDomainEvent } from '../../platform/observability/index.js';
import { lockCharactersInOrder, type UnitOfWork } from '../../platform/transaction/index.js';

export interface ReleasedClaim {
  readonly characterId: string;
  readonly activityId: string;
  readonly reason: 'activity-absent' | 'activity-terminal';
}

/**
 * Acquire one claim per Character, ALL OR NOTHING.
 *
 * Characters are locked in ascending id order (§8.5), so two party starts
 * touching the same Characters cannot deadlock. Any conflict throws, and
 * because the whole thing runs in the caller's transaction, the rollback
 * leaves NO partial claims.
 */
export async function acquire(
  tx: UnitOfWork,
  characterIds: readonly CharacterId[],
  activityId: string,
  at: Instant,
): Promise<void> {
  await lockCharactersInOrder(tx, characterIds);

  for (const characterId of [...characterIds].sort()) {
    const existing = await tx.occupancyClaim.findUnique({ where: { characterId } });
    if (existing) {
      // §12.3: contention, or a client bug. Counted HERE, where the conflict
      // is decided — not at a call site that might forget, and not for the
      // ordinary database errors that are not conflicts.
      metrics.occupancyConflict();
      throw occupancyConflict({
        characterId,
        heldBy: existing.activityId,
        requestedFor: activityId,
      });
    }
  }

  try {
    await tx.occupancyClaim.createMany({
      data: [...characterIds]
        .sort()
        .map((characterId) => ({ characterId, activityId, acquiredAt: at })),
    });
  } catch (error) {
    // A concurrent acquirer won between the check and the insert. The unique
    // constraint is the real guard; the read above only produces a better
    // message. This is translated to a typed conflict and NOT retried blindly
    // — the caller decides (§8.3).
    metrics.occupancyConflict();
    throw occupancyConflict({
      activityId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  // §12.2 always logs claim acquisition. Reported, not written: the emission
  // waits for the caller's transaction to commit.
  recordDomainEvent({
    kind: 'occupancy.acquired',
    activityId,
    characterIds: [...characterIds].sort(),
  });
}

/** Release happens in the SAME transaction as the lifecycle transition, never
 *  as a follow-up, and releases CLAIMS ONLY: the activity's participant rows
 *  are its durable roster snapshot and survive the end (§6.3.1). */
export async function release(tx: UnitOfWork, activityId: string): Promise<number> {
  const { count } = await tx.occupancyClaim.deleteMany({ where: { activityId } });
  // Releasing nothing is not a release. `endActivity` calls this
  // unconditionally, and an event per no-op would bury the real ones.
  if (count > 0) recordDomainEvent({ kind: 'occupancy.released', activityId, released: count });
  return count;
}

/** Reconnect grace RESERVES rather than releases — the activity still exists,
 *  and the Character is still busy (§7.2). */
export async function reserveForGrace(tx: UnitOfWork, activityId: string): Promise<number> {
  return tx.occupancyClaim.count({ where: { activityId } });
}

/** Exhaustive over SkillTrainingStatus. Adding a status without a rule here is
 *  a COMPILE ERROR, which is what makes the sweeper's rule total (test O13). */
export type SkillTrainingStatus = 'ACCRUING' | 'ENDED' | 'EXHAUSTED' | 'CANCELLED';

export function isSkillTrainingLive(status: SkillTrainingStatus): boolean {
  switch (status) {
    case 'ACCRUING':
      return true;
    case 'ENDED':
    case 'EXHAUSTED':
    case 'CANCELLED':
      return false;
    default: {
      const unreachable: never = status;
      throw new Error(`Unclassified Skill Training status: ${String(unreachable)}`);
    }
  }
}

export type SessionBoundState = 'ONLINE_ACTIVE' | 'RECONNECT_GRACE_PAUSED' | 'ACTIVITY_ENDED';

export function isSessionBoundLive(state: SessionBoundState): boolean {
  switch (state) {
    case 'ONLINE_ACTIVE':
    case 'RECONNECT_GRACE_PAUSED':
      return true;
    case 'ACTIVITY_ENDED':
      return false;
    default: {
      const unreachable: never = state;
      throw new Error(`Unclassified session-bound state: ${String(unreachable)}`);
    }
  }
}

/**
 * Release only claims whose named activity is ABSENT or TERMINAL.
 *
 * Because a claim NAMES its activity, this is reconciliation against durable
 * state rather than a heuristic: nothing here guesses from presence, a
 * timeout, or how long a row has been sitting there.
 */
export async function reconcileStranded(tx: UnitOfWork): Promise<ReleasedClaim[]> {
  const claims = await tx.occupancyClaim.findMany({
    select: { characterId: true, activityId: true },
  });
  if (claims.length === 0) return [];

  const activityIds = [...new Set(claims.map((claim) => claim.activityId))];
  const activities = await tx.activity.findMany({
    where: { id: { in: activityIds } },
    select: {
      id: true,
      family: true,
      sessionBound: { select: { state: true } },
      skillTraining: { select: { status: true } },
    },
  });
  const byId = new Map(activities.map((row) => [row.id, row]));

  const released: ReleasedClaim[] = [];
  for (const claim of claims) {
    const activity = byId.get(claim.activityId);
    if (!activity) {
      released.push({ ...claim, reason: 'activity-absent' });
      continue;
    }
    const live =
      activity.family === 'SESSION_BOUND'
        ? activity.sessionBound
          ? isSessionBoundLive(activity.sessionBound.state as SessionBoundState)
          : false
        : activity.skillTraining
          ? isSkillTrainingLive(activity.skillTraining.status as SkillTrainingStatus)
          : false;
    if (!live) released.push({ ...claim, reason: 'activity-terminal' });
  }

  if (released.length > 0) {
    await tx.occupancyClaim.deleteMany({
      where: { characterId: { in: released.map((claim) => claim.characterId) } },
    });
  }
  return released;
}
