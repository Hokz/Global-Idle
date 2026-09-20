/**
 * The reusable active-use duration framework (§7.3, ADR-015).
 *
 * NEVER decremented on a schedule: no cron, no per-second tick, no background
 * sweep that reduces a timer (test T9). Settlement happens at transitions and
 * checkpoints, from two durable fields, so a crash resettles from
 * `qualifyingSince` and produces the SAME result (test T3).
 *
 * Stamina uses this machinery with the sign inverted; it is the framework's
 * first consumer and its reference implementation.
 */
import {
  ZERO_DURATION,
  durationMs,
  elapsedSince,
  type DurationMs,
  type Instant,
  type OperationId,
} from '@global-idle/shared';
import { claimSettlement } from '../idempotency/index.js';
import { reportRegression, type ClockRegressionObserver } from '../clock/index.js';
import type { UnitOfWork } from '../transaction/index.js';

export interface ActiveUseTimerState {
  readonly remaining: DurationMs;
  /** null means NOT CURRENTLY QUALIFYING. */
  readonly qualifyingSince: Instant | null;
}

/**
 * A COMPUTED READ (§7.3). Consumers, including the UI, must compute rather
 * than trusting the stored field between checkpoints.
 */
export function remainingAt(timer: ActiveUseTimerState, at: Instant): DurationMs {
  if (timer.qualifyingSince === null) return timer.remaining;
  const used = elapsedSince(timer.qualifyingSince, at);
  return durationMs(Math.max(0, timer.remaining - used));
}

export interface TimerPort {
  enterQualifying(tx: UnitOfWork, timerId: string, at: Instant): Promise<void>;
  leaveQualifying(
    tx: UnitOfWork,
    timerId: string,
    at: Instant,
    op: OperationId,
  ): Promise<DurationMs>;
  settleCheckpoint(
    tx: UnitOfWork,
    timerId: string,
    at: Instant,
    op: OperationId,
  ): Promise<DurationMs>;
}

export function createTimerPort(observer?: ClockRegressionObserver): TimerPort {
  /**
   * Consume the qualifying interval and write it down. Every settlement
   * carries an operation id; replaying it is a no-op (§7.3).
   */
  async function settle(
    tx: UnitOfWork,
    timerId: string,
    at: Instant,
    op: OperationId,
    keepQualifying: boolean,
  ): Promise<DurationMs> {
    const row = await tx.activeUseTimer.findUniqueOrThrow({ where: { id: timerId } });
    if (row.qualifyingSince === null) return ZERO_DURATION;

    // A backward clock STALLS the timer rather than reversing it: elapsed is
    // max(0, now - since), so nothing is minted and nothing already settled is
    // restored (§7.1.1 rules 1 and 2). The regression is reported, never
    // silently corrected.
    reportRegression(row.qualifyingSince, at, observer);

    const consumed = elapsedSince(row.qualifyingSince, at);
    const applied = durationMs(Math.min(consumed, row.remainingMs));

    // A replay of the same operation id applies nothing at all.
    if (!(await claimSettlement(tx, op, 'active-use-timer', at))) return ZERO_DURATION;

    await tx.activeUseTimer.update({
      where: { id: timerId },
      data: {
        remainingMs: row.remainingMs - applied,
        qualifyingSince: keepQualifying ? at : null,
        updatedAt: at,
      },
    });
    return applied;
  }

  return {
    async enterQualifying(tx, timerId, at) {
      const row = await tx.activeUseTimer.findUniqueOrThrow({ where: { id: timerId } });
      // Entering twice must not move the marker: only a STATE TRANSITION
      // writes qualifyingSince (I15).
      if (row.qualifyingSince !== null) return;
      await tx.activeUseTimer.update({
        where: { id: timerId },
        data: { qualifyingSince: at, updatedAt: at },
      });
    },

    leaveQualifying: (tx, timerId, at, op) => settle(tx, timerId, at, op, false),
    settleCheckpoint: (tx, timerId, at, op) => settle(tx, timerId, at, op, true),
  };
}
