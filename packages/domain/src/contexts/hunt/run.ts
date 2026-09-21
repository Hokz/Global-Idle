/**
 * The Hunt run: advance-on-read settlement (Phase 2 spec §2, §8, §9).
 *
 * THERE IS NO LOOP. A worker per activity is a process that can die between
 * two writes; this is a pure function of durable state and the clock, so a
 * restart resumes rather than recovers. Nothing is decremented on a schedule
 * (ADR-015) — the durable state is a POSITION, and every read moves it forward
 * by however much authoritative time has passed.
 *
 * One settlement is one transaction: simulate, write the run, award XP, post
 * Gold, settle Stamina, settle active-use timers — all under one operation id,
 * so a retry is a no-op rather than a duplicate.
 */
import {
  RECONNECT_GRACE,
  activityId as toActivityId,
  characterId as toCharacterId,
  durationMs,
  elapsedSince,
  operationId as toOperationId,
  type ActivityId,
  type DurationMs,
  type Instant,
} from '@global-idle/shared';
import {
  TICK_MS,
  createSeededRandom,
  initialState,
  simulateHunt,
  type HuntEvent,
  type HuntState,
} from '@global-idle/game-engine';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { claimSettlement, settlementOperationId } from '../../platform/idempotency/index.js';
import { recordDomainEvent } from '../../platform/observability/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { endActivity, occupancyFor, pauseForGrace, resumeFromGrace } from '../activity/index.js';
import { settleStamina } from '../character/index.js';
import { post } from '../economy/index.js';
import { entitlementPort } from '../identity/index.js';
import { createTimerPort } from '../../platform/timer/index.js';
import { levelForXp, levelProgress } from './progression.js';
import { buildHuntPlan } from './plan.js';
import { settleRewards } from './rewards.js';

/**
 * How long a run keeps advancing after the last sign of life.
 *
 * A session is `ONLINE_ACTIVE` while a heartbeat arrived inside this window
 * (P2-D7). Time beyond it was never proven to be connected, so it is not
 * simulated — which is what makes "no connection, no progress" true rather
 * than merely intended.
 *
 * NINETY SECONDS, and the number comes from the browser rather than from
 * taste. §8 requires a BACKGROUNDED TAB WITH A LIVE CONNECTION to keep
 * advancing, and every current engine clamps a hidden page's timers to roughly
 * one firing per minute. A window shorter than that clamp would treat a tab
 * that is merely hidden as a connection that is gone, and an idle game whose
 * progress stops when you look away is not an idle game. The cost is the
 * maximum unproven span: a client that genuinely dies is credited with up to
 * ninety seconds it did not connect for, once, after which nothing advances at
 * all.
 */
export const LIVENESS_WINDOW: DurationMs = durationMs(90_000);

/** The framework Stamina is the reference implementation of (ADR-015, §5). */
const timers = createTimerPort();

export type HuntEndReason = 'DIED' | 'LEFT' | 'GRACE_EXPIRED';

export interface HuntRunView {
  readonly activityId: string;
  readonly characterId: string;
  readonly room: number;
  readonly cycle: number;
  readonly tick: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly supplyCharges: number;
  readonly creatures: readonly { key: string; health: number; maxHealth: number }[];
  /** STRINGS on the wire. A bigint does not survive JSON, and a number would
   *  quietly lose precision on a total the curve takes past 2^53. */
  readonly sessionXp: string;
  readonly sessionGold: string;
  /** The DURABLE progression, so the window does not have to ask twice. */
  readonly baseLevel: number;
  readonly baseXp: string;
  readonly levelStartXp: string;
  readonly nextLevelXp: string;
  readonly staminaRemainingMs: number;
  readonly staminaMode: 'CONSUMING' | 'NEUTRAL' | 'RECOVERING';
  readonly connection: 'ONLINE_ACTIVE' | 'RECONNECT_GRACE_PAUSED' | 'ACTIVITY_ENDED';
  readonly graceExpiresAt: string | null;
  readonly endedReason: HuntEndReason | null;
  readonly events: readonly HuntEvent[];
}

interface StoredCreature {
  readonly key: string;
  readonly health: number;
  readonly nextAttackTick: number;
}

/** Create the run beside the Activity, in the same transaction (spec §11). */
export async function startRun(
  tx: UnitOfWork,
  input: {
    readonly activityId: ActivityId;
    readonly characterId: string;
    readonly resolver: ContentBundleResolver;
    readonly contentVersion: string;
    readonly contentKey: string;
    readonly level: number;
    readonly at: Instant;
  },
): Promise<void> {
  const bundle = await input.resolver.resolve(input.contentVersion);
  const { plan, profile, supplyCharges } = buildHuntPlan(bundle, input.contentKey, input.level);
  const state = initialState(profile, plan, supplyCharges);

  await tx.huntRun.create({
    data: {
      activityId: input.activityId,
      characterId: input.characterId,
      room: state.room,
      cycle: state.cycle,
      tick: state.tick,
      simulatedThrough: input.at,
      characterHealth: state.health,
      characterNextAttackTick: state.characterNextAttackTick,
      supplyCharges: state.supplyCharges,
      creatures: [],
      lastSeenAt: input.at,
    },
  });
}

/**
 * Advance a run to `now` and return what a client should see.
 *
 * `seen` marks this call as a sign of life — a heartbeat or a read from a live
 * client. A server-side sweep passes `false`, so it can expire a grace without
 * pretending the player is still there.
 */
export async function advance(
  tx: UnitOfWork,
  input: {
    readonly activityId: ActivityId;
    readonly resolver: ContentBundleResolver;
    readonly now: Instant;
    readonly seen: boolean;
    /**
     * Active-use timers to settle against this Hunt's qualifying time
     * (§5 of ACTIVITY_OCCUPANCY_AND_TIMERS.md, cases 25–28).
     *
     * INJECTED rather than looked up: Phase 2 ships no player-facing timed
     * effect — no XP boost, no Imbuement — so there is no ownership to model
     * yet, and inventing an owner column for a feature that does not exist
     * would be a schema decision made by the wrong phase. The seam is the real
     * settlement path, under the same operation id as everything else, and the
     * cases drive it with a real timer.
     */
    readonly activeUseTimerIds?: readonly string[];
  },
): Promise<HuntRunView | null> {
  const run = await tx.huntRun.findUnique({ where: { activityId: input.activityId } });
  if (!run) return null;

  /**
   * Active-use timers burn EXACTLY the span this settlement simulated, and
   * stop being qualifying the moment the run stops advancing.
   *
   * Two things make cases 25 to 28 true rather than approximately true. The
   * first is the INSTANT: a checkpoint settles at the point the simulation
   * reached, never at the wall clock the request happened to arrive on, so an
   * unproven span cannot be billed to a timer. The second is the TRANSITION:
   * a paused, expired or dead run leaves qualifying, so the marker does not
   * sit there accumulating through the pause and get collected on the far
   * side of it — which is what a checkpoint-only implementation does, and it
   * reads as "grace consumed five minutes of my Imbuement".
   *
   * Injecting the ids is the seam (see the parameter): Phase 2 ships no timed
   * effect to own them, so what burns is the caller's to say. WHEN it burns
   * is not.
   */
  const timerIds = input.activeUseTimerIds ?? [];

  const burnTimers = async (from: Instant, to: Instant, operation: string): Promise<void> => {
    for (const timerId of timerIds) {
      // No-op when it is already qualifying: only a STATE TRANSITION moves the
      // marker (I15).
      await timers.enterQualifying(tx, timerId, from);
      await timers.settleCheckpoint(
        tx,
        timerId,
        to,
        toOperationId(`${operation}:timer:${timerId}`),
      );
    }
  };

  const stopTimers = async (at: Instant, operation: string): Promise<void> => {
    for (const timerId of timerIds) {
      await timers.leaveQualifying(tx, timerId, at, toOperationId(`${operation}:stop:${timerId}`));
    }
  };

  const activity = await tx.activity.findUniqueOrThrow({
    where: { id: input.activityId },
    select: { contentVersion: true, contentKey: true, sessionBound: true },
  });
  const bound = activity.sessionBound;
  const character = await tx.character.findUniqueOrThrow({
    where: { id: run.characterId },
    select: { id: true, accountId: true, baseXp: true, baseLevel: true },
  });

  const bundle = await input.resolver.resolve(activity.contentVersion);
  const { plan, profile } = buildHuntPlan(
    bundle,
    activity.contentKey,
    levelForXp(character.baseXp),
  );

  // Stamina is brought up to `now` FIRST, through the character context's own
  // settlement. A Hunt that ended or is in grace leaves the Character
  // recovering, and that recovery is this read's to apply — a Hunt read is
  // still a read, and advance-on-read is the whole model (P2-D1).
  const occupancy = await occupancyFor(tx, run.characterId);
  const stamina = await settleStamina(tx, {
    characterId: run.characterId,
    accountId: character.accountId as never,
    occupancy: { claim: occupancy },
    now: input.now,
  });

  const view = (
    state: {
      room: number;
      cycle: number;
      tick: number;
      characterHealth: number;
      supplyCharges: number;
      creatures: readonly StoredCreature[];
      sessionXp: bigint;
      sessionGold: bigint;
      endedReason: HuntEndReason | null;
      baseXp: bigint;
      staminaRemainingMs: number;
    },
    connection: HuntRunView['connection'],
    graceExpiresAt: Instant | null,
    events: readonly HuntEvent[],
  ): HuntRunView => {
    const progress = levelProgress(state.baseXp);
    return {
      activityId: String(input.activityId),
      characterId: run.characterId,
      room: state.room,
      cycle: state.cycle,
      tick: state.tick,
      health: state.characterHealth,
      maxHealth: profile.maxHealth,
      supplyCharges: state.supplyCharges,
      creatures: state.creatures.map((creature) => ({
        key: creature.key,
        health: creature.health,
        maxHealth: plan.creatures[creature.key]?.maxHealth ?? creature.health,
      })),
      sessionXp: state.sessionXp.toString(),
      sessionGold: state.sessionGold.toString(),
      baseLevel: progress.level,
      baseXp: progress.totalXp.toString(),
      levelStartXp: progress.levelStartXp.toString(),
      nextLevelXp: progress.nextLevelXp.toString(),
      staminaRemainingMs: state.staminaRemainingMs,
      // The mode is DERIVED from the same authoritative state the Character
      // context derives it from: ended is recovering, paused is neutral, and a
      // run that has not yet earned its first XP is neutral too (§3.3).
      staminaMode:
        connection === 'ACTIVITY_ENDED'
          ? 'RECOVERING'
          : connection === 'RECONNECT_GRACE_PAUSED'
            ? 'NEUTRAL'
            : state.tick > 0 && state.sessionXp > 0n
              ? 'CONSUMING'
              : 'NEUTRAL',
      connection,
      graceExpiresAt: graceExpiresAt ? graceExpiresAt.toISOString() : null,
      endedReason: state.endedReason,
      events,
    };
  };

  const stored = {
    room: run.room,
    cycle: run.cycle,
    tick: run.tick,
    characterHealth: run.characterHealth,
    supplyCharges: run.supplyCharges,
    creatures: run.creatures as unknown as StoredCreature[],
    sessionXp: run.sessionXp,
    sessionGold: run.sessionGold,
    endedReason: run.endedReason as HuntEndReason | null,
    baseXp: character.baseXp,
    staminaRemainingMs: stamina.remaining,
  };

  // ── ended ────────────────────────────────────────────────────────────────
  if (run.endedReason !== null || bound === null || bound.state === 'ACTIVITY_ENDED') {
    await stopTimers(run.simulatedThrough, `${String(input.activityId)}:ended`);
    return view(stored, 'ACTIVITY_ENDED', null, []);
  }

  // ── paused in reconnect grace ────────────────────────────────────────────
  if (bound.state === 'RECONNECT_GRACE_PAUSED') {
    const deadline = bound.graceExpiresAt;
    await stopTimers(run.simulatedThrough, `${String(input.activityId)}:grace`);
    if (deadline && input.now >= deadline) {
      await endRun(tx, input.activityId, 'GRACE_EXPIRED', input.now);
      return view({ ...stored, endedReason: 'GRACE_EXPIRED' }, 'ACTIVITY_ENDED', null, []);
    }
    if (input.seen) {
      // Reconnect INSIDE the window resumes the same run at the same state.
      // `simulatedThrough` jumps to now, which is what makes the paused time
      // cost nothing: no ticks, no Stamina, no timers, no rewards (§8).
      await resumeFromGrace(tx, input.activityId);
      await tx.huntRun.update({
        where: { activityId: input.activityId },
        data: { simulatedThrough: input.now, lastSeenAt: input.now },
      });
      return view(stored, 'ONLINE_ACTIVE', null, []);
    }
    return view(stored, 'RECONNECT_GRACE_PAUSED', deadline ?? null, []);
  }

  // ── online ───────────────────────────────────────────────────────────────
  //
  // Only the span that was PROVEN LIVE is simulated. Anything past
  // `lastSeenAt + LIVENESS_WINDOW` happened with nobody connected.
  const liveThrough = new Date(run.lastSeenAt.getTime() + LIVENESS_WINDOW);
  const simulateTo = input.now < liveThrough ? input.now : liveThrough;
  const availableMs = Math.max(0, simulateTo.getTime() - run.simulatedThrough.getTime());
  const ticks = Math.floor(availableMs / TICK_MS);
  /** The instant the simulation actually reached. Everything settles here. */
  const simulatedTo = new Date(run.simulatedThrough.getTime() + ticks * TICK_MS);

  let next = stored;
  let events: readonly HuntEvent[] = [];

  if (ticks > 0) {
    const sequence = run.checkpointSequence + 1;
    const operation = settlementOperationId(String(input.activityId), sequence);
    const fresh = await claimSettlement(tx, operation, 'hunt.checkpoint', input.now);
    if (!fresh) {
      // This checkpoint is already applied — a concurrent settlement won the
      // race, or this is a replay of one that committed. Either way the work
      // is done and doing it again would double the XP, the Gold, the supply
      // consumption and the Stamina.
      //
      // The answer is to APPLY NOTHING and return what is durable. An earlier
      // version re-entered `advance` to "read the fresh state", which inside
      // the same transaction re-read the same snapshot and looped until the
      // transaction timed out — a retry storm dressed as a re-read. The
      // winner has already advanced `checkpointSequence`, so the caller's next
      // read computes the next sequence and moves on by itself.
      return view(stored, 'ONLINE_ACTIVE', null, []);
    }

    const state: HuntState = {
      tick: run.tick,
      room: run.room,
      cycle: run.cycle,
      health: run.characterHealth,
      supplyCharges: run.supplyCharges,
      creatures: stored.creatures,
      characterNextAttackTick: run.characterNextAttackTick,
      ended: null,
    };

    // The seed includes the tick, so a settlement is a pure function of the
    // persisted position: a rolled-back attempt replays identically, and a
    // restart resumes the same future.
    const rng = createSeededRandom(`${bound.rngSeed}:${state.tick}`);
    const step = simulateHunt(state, profile, plan, ticks, rng);
    events = step.events;

    const participant = await tx.activityParticipant.findUniqueOrThrow({
      where: {
        activityId_characterId: { activityId: input.activityId, characterId: run.characterId },
      },
      select: { staminaActivatedAt: true },
    });
    const staminaRow = await tx.characterStamina.findUniqueOrThrow({
      where: { characterId: run.characterId },
    });
    const entitlements = await entitlementPort.activeAt(
      tx,
      character.accountId as never,
      input.now,
    );
    const premium = entitlements.some((entitlement) => entitlement.kind === 'PREMIUM');

    const settled = settleRewards({
      fromTick: state.tick,
      toTick: step.state.tick,
      rewards: step.rewards,
      staminaRemaining: durationMs(staminaRow.remainingMs),
      activated: participant.staminaActivatedAt !== null,
      premium,
    });

    // Activation is the tick the first qualifying XP landed on (§2.1).
    if (settled.activatedAtTick !== null) {
      await tx.activityParticipant.update({
        where: {
          activityId_characterId: { activityId: input.activityId, characterId: run.characterId },
        },
        data: {
          staminaActivatedAt: new Date(
            run.simulatedThrough.getTime() + (settled.activatedAtTick - state.tick) * TICK_MS,
          ),
        },
      });
    }

    if (settled.staminaConsumed > 0 || settled.staminaRemaining !== staminaRow.remainingMs) {
      await tx.characterStamina.update({
        where: { characterId: run.characterId },
        data: { remainingMs: settled.staminaRemaining, updatedAt: input.now },
      });
    }

    if (settled.experience > 0n) {
      const total = character.baseXp + settled.experience;
      await tx.character.update({
        where: { id: run.characterId },
        data: { baseXp: total, baseLevel: levelForXp(total) },
      });
    }

    // Active-use timers burn only while the Hunt is actually advancing, which
    // is this branch and nowhere else: a paused run returns above without
    // reaching here, and so does one with no elapsed ticks (cases 25, 26).
    await burnTimers(run.simulatedThrough, simulatedTo, operation);

    if (settled.gold > 0n) {
      await post(tx, {
        accountId: character.accountId as never,
        currency: 'GOLD',
        amount: settled.gold,
        reasonCode: 'hunt.reward',
        operationId: toOperationId(`${operation}:gold`),
        at: input.now,
      });
    }

    next = {
      room: step.state.room,
      cycle: step.state.cycle,
      tick: step.state.tick,
      characterHealth: step.state.health,
      supplyCharges: step.state.supplyCharges,
      creatures: step.state.creatures as unknown as StoredCreature[],
      sessionXp: run.sessionXp + settled.experience,
      sessionGold: run.sessionGold + settled.gold,
      endedReason: step.state.ended,
      baseXp: character.baseXp + settled.experience,
      staminaRemainingMs: settled.staminaRemaining,
    };

    await tx.huntRun.update({
      where: { activityId: input.activityId },
      data: {
        room: next.room,
        cycle: next.cycle,
        tick: next.tick,
        simulatedThrough: simulatedTo,
        characterHealth: next.characterHealth,
        characterNextAttackTick: step.state.characterNextAttackTick,
        supplyCharges: next.supplyCharges,
        creatures: next.creatures as never,
        sessionXp: next.sessionXp,
        sessionGold: next.sessionGold,
        checkpointSequence: sequence,
        ...(input.seen ? { lastSeenAt: input.now } : {}),
      },
    });

    if (step.state.ended === 'DIED') {
      await stopTimers(simulatedTo, operation);
      await endRun(tx, input.activityId, 'DIED', input.now);
      return view({ ...next, endedReason: 'DIED' }, 'ACTIVITY_ENDED', null, events);
    }
  } else if (input.seen) {
    await tx.huntRun.update({
      where: { activityId: input.activityId },
      data: { lastSeenAt: input.now },
    });
  }

  // The connection went quiet for longer than the window. The five minutes run
  // from the last moment anyone was PROVEN to be there, and the deadline is
  // computed the same way whoever asks — a server sweep, a poll, or the
  // reconnect itself. A deadline that depended on who noticed would let a
  // client extend its own grace by staying away.
  if (elapsedSince(run.lastSeenAt, input.now) > LIVENESS_WINDOW) {
    const graceExpiresAt = new Date(liveThrough.getTime() + RECONNECT_GRACE);
    if (input.now >= graceExpiresAt) {
      await stopTimers(simulatedTo, `${String(input.activityId)}:expired`);
      await endRun(tx, input.activityId, 'GRACE_EXPIRED', input.now);
      return view({ ...next, endedReason: 'GRACE_EXPIRED' }, 'ACTIVITY_ENDED', null, events);
    }
    if (!input.seen) {
      await stopTimers(simulatedTo, `${String(input.activityId)}:paused`);
      await pauseForGrace(tx, input.activityId, graceExpiresAt);
      await tx.huntRun.update({
        where: { activityId: input.activityId },
        data: { simulatedThrough: input.now },
      });
      return view(next, 'RECONNECT_GRACE_PAUSED', graceExpiresAt, events);
    }
    // A reconnect inside the window. The unproven span produced nothing and
    // cost nothing: no ticks, no Stamina, no timers, no rewards (§8).
    await stopTimers(simulatedTo, `${String(input.activityId)}:gap`);
    await tx.huntRun.update({
      where: { activityId: input.activityId },
      data: { simulatedThrough: input.now, lastSeenAt: input.now },
    });
  }

  return view(next, 'ONLINE_ACTIVE', null, events);
}

/**
 * End whatever live session-bound Activity a SESSION holds.
 *
 * Signing out is an explicit departure, so §8 gives it no grace: the run ends
 * now, the claim is released now, and the next sign-in starts clean. Leaving
 * the Activity behind would strand the Character in an occupancy claim held by
 * a session that no longer exists, which the sweeper would only clear five
 * minutes later — for a player who told us they were going.
 */
export async function endForSession(
  tx: UnitOfWork,
  claimHolderSessionId: string,
  at: Instant,
): Promise<string | null> {
  const bound = await tx.sessionBoundActivity.findFirst({
    where: {
      claimHolderSessionId,
      state: { in: ['ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED'] },
    },
    select: { activityId: true },
  });
  if (!bound) return null;
  await endRunOrActivity(tx, toActivityId(bound.activityId), 'LEFT', at);
  return bound.activityId;
}

/**
 * End an Activity, as a Hunt if it is one.
 *
 * A Hunt LEAVES — it has a run to close and a reason to record. Anything else
 * just ends. Both paths release the claim; the difference is whether there is
 * a run that has to agree with the Activity about being over.
 */
export async function endRunOrActivity(
  tx: UnitOfWork,
  activityId: ActivityId,
  reason: HuntEndReason,
  at: Instant,
): Promise<void> {
  const run = await tx.huntRun.findUnique({
    where: { activityId },
    select: { activityId: true },
  });
  if (run) await endRun(tx, activityId, reason, at);
  else await endActivity(tx, activityId, at);
}

/** End a run and the Activity with it, releasing the occupancy claim. */
export async function endRun(
  tx: UnitOfWork,
  activityId: ActivityId,
  reason: HuntEndReason,
  at: Instant,
): Promise<void> {
  const run = await tx.huntRun.findUnique({ where: { activityId } });
  if (!run || run.endedReason !== null) return;

  await tx.huntRun.update({
    where: { activityId },
    data: { endedReason: reason, endedAt: at },
  });
  await endActivity(tx, activityId, at);
  recordDomainEvent({
    kind: 'hunt.ended',
    activityId: String(activityId),
    characterId: run.characterId,
    reason,
    room: run.room,
    cycle: run.cycle,
  });
}

export const asActivityId = toActivityId;
export const asCharacterId = toCharacterId;
