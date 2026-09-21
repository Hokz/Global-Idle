/**
 * Activity start and end (§8.1). INTERNAL to the activity context.
 *
 * Each of these is EXACTLY ONE transaction; partial application must be
 * impossible. The write ORDER is the order the foreign keys of §6.3.1 impose,
 * which has no cycle — so ordinary immediate constraint checking suffices and
 * no constraint is deferred.
 */
import {
  newId,
  type ActivityId,
  type AccountId,
  type CharacterId,
  type ContentVersion,
  type Instant,
  type SessionId,
} from '@global-idle/shared';
import { activityTypeUnknown } from '../../platform/errors/index.js';
import { recordDomainEvent } from '../../platform/observability/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { describe } from './types/registry.js';
import { acquire, release } from './occupancy.js';
import type { ActivityTypeKey } from '@global-idle/shared';

export interface StartSessionBoundInput {
  readonly accountId: AccountId;
  readonly activityTypeKey: ActivityTypeKey;
  readonly contentVersion: ContentVersion;
  readonly participants: readonly CharacterId[];
  readonly claimHolderSessionId: SessionId;
  readonly rngSeed: string;
  readonly at: Instant;
}

/**
 * Session-bound start. Order: root, subtype, participants, claims.
 *
 * Any conflict rolls the WHOLE transaction back — no partial roster, no
 * partial claims.
 */
export async function startSessionBound(
  tx: UnitOfWork,
  input: StartSessionBoundInput,
): Promise<ActivityId> {
  const descriptor = describe(input.activityTypeKey);
  if (!descriptor) throw activityTypeUnknown({ activityTypeKey: input.activityTypeKey });
  if (descriptor.family !== 'SESSION_BOUND') {
    throw activityTypeUnknown({
      activityTypeKey: input.activityTypeKey,
      expected: 'SESSION_BOUND',
      actual: descriptor.family,
    });
  }
  if (input.participants.length === 0) {
    throw activityTypeUnknown({
      reason: 'a session-bound activity needs at least one participant',
    });
  }

  const id = newId<'ActivityId'>(input.at);

  // 1. the root, with the content version PINNED at start (ADR-011)
  await tx.activity.create({
    data: {
      id,
      accountId: input.accountId,
      activityTypeKey: input.activityTypeKey,
      family: 'SESSION_BOUND',
      contentVersion: input.contentVersion,
      createdAt: input.at,
    },
  });

  // 2. the subtype
  await tx.sessionBoundActivity.create({
    data: {
      activityId: id,
      accountId: input.accountId,
      family: 'SESSION_BOUND',
      state: 'ONLINE_ACTIVE',
      claimHolderSessionId: input.claimHolderSessionId,
      graceExpiresAt: null,
      rngSeed: input.rngSeed,
    },
  });

  // 3. the roster snapshot, frozen here (ADR-002), in party order.
  //    staminaActivatedAt is written NULL: the durable "not yet activated"
  //    marker §7.3.1 reads as NEUTRAL. Phase 2 decides what raises it.
  await tx.activityParticipant.createMany({
    data: input.participants.map((characterId, slotIndex) => ({
      activityId: id,
      characterId,
      family: 'SESSION_BOUND' as const,
      slotIndex,
      staminaActivatedAt: null,
    })),
  });

  // 4. one claim per participant, ascending characterId (§8.5)
  await acquire(tx, input.participants, id, input.at);

  recordDomainEvent({
    kind: 'activity.transition',
    activityId: id,
    family: 'SESSION_BOUND',
    to: 'ONLINE_ACTIVE',
  });
  return id;
}

export interface StartSkillTrainingInput {
  readonly accountId: AccountId;
  readonly activityTypeKey: ActivityTypeKey;
  readonly contentVersion: ContentVersion;
  readonly trainee: CharacterId;
  readonly at: Instant;
}

/**
 * Skill Training start. Order: root, THE PARTICIPANT, subtype, claim.
 *
 * The participant is written BEFORE the subtype because the subtype's foreign
 * key requires it to exist. That ordering is what makes "exactly one
 * participant" hold even for a buggy caller: a participant-less training
 * cannot be committed at all.
 */
export async function startSkillTraining(
  tx: UnitOfWork,
  input: StartSkillTrainingInput,
): Promise<ActivityId> {
  const descriptor = describe(input.activityTypeKey);
  if (!descriptor) throw activityTypeUnknown({ activityTypeKey: input.activityTypeKey });
  if (descriptor.family !== 'WALL_CLOCK') {
    throw activityTypeUnknown({
      activityTypeKey: input.activityTypeKey,
      expected: 'WALL_CLOCK',
      actual: descriptor.family,
    });
  }

  const id = newId<'ActivityId'>(input.at);

  await tx.activity.create({
    data: {
      id,
      accountId: input.accountId,
      activityTypeKey: input.activityTypeKey,
      family: 'WALL_CLOCK',
      // A wall-clock Activity pins too: ADR-011 says EVERY Activity pins.
      contentVersion: input.contentVersion,
      createdAt: input.at,
    },
  });

  await tx.activityParticipant.create({
    data: {
      activityId: id,
      characterId: input.trainee,
      family: 'WALL_CLOCK',
      slotIndex: 0,
      staminaActivatedAt: null,
    },
  });

  await tx.skillTrainingActivity.create({
    data: {
      activityId: id,
      family: 'WALL_CLOCK',
      traineeCharacterId: input.trainee,
      status: 'ACCRUING',
      startedAt: input.at,
      lastSettledAt: input.at,
      endedAt: null,
    },
  });

  await acquire(tx, [input.trainee], id, input.at);

  recordDomainEvent({
    kind: 'activity.transition',
    activityId: id,
    family: 'WALL_CLOCK',
    to: 'ACCRUING',
  });
  return id;
}

export type SkillTrainingTerminal = 'ENDED' | 'EXHAUSTED' | 'CANCELLED';

export interface EndResult {
  readonly claimsReleased: number;
  readonly participantsRetained: number;
}

/**
 * End an activity.
 *
 * DOES: transition the subtype to its terminal state, release every occupancy
 * claim.
 * DOES NOT: delete the Activity root, delete ActivityParticipant rows, or
 * clear contentVersion. The participant rows are the durable roster snapshot
 * and the pin keeps the bundle alive; removing either is the job of a separate
 * retention or archive operation, which this specification does not authorize.
 */
export async function endActivity(
  tx: UnitOfWork,
  activityId: ActivityId,
  at: Instant,
  terminal: SkillTrainingTerminal = 'ENDED',
): Promise<EndResult> {
  const activity = await tx.activity.findUniqueOrThrow({
    where: { id: activityId },
    select: { family: true },
  });

  if (activity.family === 'SESSION_BOUND') {
    await tx.sessionBoundActivity.update({
      where: { activityId },
      data: { state: 'ACTIVITY_ENDED', graceExpiresAt: null },
    });
  } else {
    await tx.skillTrainingActivity.update({
      where: { activityId },
      data: { status: terminal, endedAt: at, lastSettledAt: at },
    });
  }

  const claimsReleased = await release(tx, activityId);
  const participantsRetained = await tx.activityParticipant.count({ where: { activityId } });

  recordDomainEvent({
    kind: 'activity.transition',
    activityId,
    family: activity.family,
    to: activity.family === 'SESSION_BOUND' ? 'ACTIVITY_ENDED' : terminal,
  });
  return { claimsReleased, participantsRetained };
}

/** Reconnect grace: pause, set the deadline, KEEP the claims (§7.2). */
export async function pauseForGrace(
  tx: UnitOfWork,
  activityId: ActivityId,
  graceExpiresAt: Instant,
): Promise<void> {
  await tx.sessionBoundActivity.update({
    where: { activityId },
    data: { state: 'RECONNECT_GRACE_PAUSED', graceExpiresAt },
  });
  recordDomainEvent({
    kind: 'activity.transition',
    activityId,
    family: 'SESSION_BOUND',
    to: 'RECONNECT_GRACE_PAUSED',
  });
}
