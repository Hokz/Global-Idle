/**
 * Activity root <-> subtype integrity (§6.3.3). INTERNAL to the activity context.
 *
 * Three invalid subtype states, closed at different times:
 *
 *   wrong-family subtype   CHECK + composite FK  -> write time, unrepresentable
 *   both subtypes present  the same two          -> write time, unrepresentable
 *   missing subtype        start transaction     -> start time
 *                          + the sweep below     -> startup
 *
 * "Every parent has at least one child" is a participation constraint in the
 * parent's direction, and PostgreSQL can only enforce it with a deferred
 * circular foreign key or a trigger. Neither is worth it, so a missing subtype
 * is PREVENTED TRANSACTIONALLY AND DETECTED STRUCTURALLY rather than made
 * unrepresentable — and this file says so instead of claiming a guarantee it
 * does not have.
 */
import { activityIntegrityViolation } from '../../platform/errors/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';

export interface IntegrityFinding {
  readonly activityId: string;
  readonly family: string;
  readonly hasSessionBound: boolean;
  readonly hasSkillTraining: boolean;
  readonly participants: number;
}

/**
 * One query, written PER FAMILY rather than per symptom.
 *
 * An earlier design enumerated symptoms — no subtype, both subtypes, no
 * participants — and so never compared Activity.family against which subtype
 * was actually present: a WALL_CLOCK root carrying only a SessionBoundActivity
 * row has a subtype, does not have both, and may well have a participant, so
 * it passed.
 *
 * `family` is a two-valued enum, so TWO predicates, each the complete negation
 * of validity for one value, are exhaustive by construction. There is no third
 * case to forget.
 */
export async function findIntegrityViolations(tx: UnitOfWork): Promise<IntegrityFinding[]> {
  return tx.$queryRawUnsafe<IntegrityFinding[]>(`
    SELECT a.id                                        AS "activityId",
           a.family::text                              AS family,
           (sb."activityId" IS NOT NULL)               AS "hasSessionBound",
           (st."activityId" IS NOT NULL)               AS "hasSkillTraining",
           (SELECT count(*)::int FROM "ActivityParticipant" p
             WHERE p."activityId" = a.id)              AS participants
      FROM "Activity" a
      LEFT JOIN "SessionBoundActivity"  sb ON sb."activityId" = a.id
      LEFT JOIN "SkillTrainingActivity" st ON st."activityId" = a.id
     WHERE (a.family = 'SESSION_BOUND'
            AND (sb."activityId" IS NULL OR st."activityId" IS NOT NULL))
        OR (a.family = 'WALL_CLOCK'
            AND (st."activityId" IS NULL OR sb."activityId" IS NOT NULL))
        OR NOT EXISTS (SELECT 1 FROM "ActivityParticipant" p WHERE p."activityId" = a.id)
  `);
}

/**
 * Run the sweep and THROW. It NEVER repairs: an Activity with no subtype or no
 * roster is a bug in the start transaction, and guessing which subtype it
 * should have had turns one bad row into a silently wrong one.
 */
export async function assertActivityIntegrity(tx: UnitOfWork): Promise<void> {
  const findings = await findIntegrityViolations(tx);
  if (findings.length === 0) return;

  const described = findings.map((f) => {
    const reasons: string[] = [];
    if (!f.hasSessionBound && !f.hasSkillTraining) reasons.push('no subtype row');
    if (f.hasSessionBound && f.hasSkillTraining) reasons.push('both subtype rows');
    if (f.family === 'SESSION_BOUND' && f.hasSkillTraining)
      reasons.push('wall-clock subtype on a session-bound root');
    if (f.family === 'WALL_CLOCK' && f.hasSessionBound)
      reasons.push('session-bound subtype on a wall-clock root');
    if (f.participants === 0) reasons.push('no participants');
    return `${f.activityId} (${f.family}): ${reasons.join(', ')}`;
  });

  throw activityIntegrityViolation({ findings }, described.join('; '));
}
