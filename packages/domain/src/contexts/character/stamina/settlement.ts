/**
 * DURABLE Stamina settlement (`ACTIVITY_OCCUPANCY_AND_TIMERS.md` §3, Phase 2
 * spec §6). INTERNAL to the character context.
 *
 * Phase 0B built the pure machinery — `deriveStaminaMode`, `settleRecovery`,
 * `settleConsumption` — and deliberately wired none of it to a row, because
 * Phase 0B had no activity that could consume or recover. Phase 2 has both, so
 * this is where the machinery meets the database.
 *
 * ADVANCE ON READ, exactly as the Hunt does, and for the same reason: a job
 * that ticked every Character's Stamina down or up would be a process that can
 * die between two writes, and ADR-015 rules out decrementing anything on a
 * schedule. The durable state is a POSITION — `remainingMs` as of
 * `updatedAt` — and every read moves it forward by however much authoritative
 * time has passed.
 *
 * IDEMPOTENT BY CONSTRUCTION. The marker IS `updatedAt`, so a retry settles
 * the span from `now` to `now`, which is nothing. There is no operation id to
 * forget to pass and no window in which a replay can double-recover (case 21).
 */
import {
  STAMINA_MAX,
  ZERO_DURATION,
  durationMs,
  type AccountId,
  type DurationMs,
  type Instant,
} from '@global-idle/shared';
import { entitlementPort } from '../../identity/index.js';
import type { UnitOfWork } from '../../../platform/transaction/index.js';
import {
  deriveStaminaMode,
  settleRecovery,
  type OccupancyView,
  type StaminaMode,
} from './index.js';

export interface StaminaSettlement {
  readonly remaining: DurationMs;
  readonly mode: StaminaMode;
  /** What this settlement added. Consumption is the Hunt's, not this. */
  readonly recovered: DurationMs;
  /** The instant the row is now settled through. */
  readonly settledThrough: Instant;
}

export interface SettleStaminaInput {
  readonly characterId: string;
  readonly accountId: AccountId;
  /** The Character's real occupancy — `activity.occupancyFor`. The MODE is
   *  derived from it and never assigned (§7.3.1). */
  readonly occupancy: OccupancyView;
  readonly now: Instant;
}

/**
 * Bring a Character's Stamina up to `now`.
 *
 * RECOVERING settles the span at Premium 1:1 or Free 1:2, segmented at every
 * entitlement transition and capped at 42:00. NEUTRAL and CONSUMING recover
 * nothing — but the marker still moves, so a span spent in reconnect grace
 * cannot be claimed as recovery by the settlement that follows it. That is
 * the whole of "grace is NEUTRAL": not merely that it grants nothing at the
 * time, but that it is never granted afterwards either.
 */
export async function settleStamina(
  tx: UnitOfWork,
  input: SettleStaminaInput,
): Promise<StaminaSettlement> {
  const row = await tx.characterStamina.findUniqueOrThrow({
    where: { characterId: input.characterId },
  });
  const mode = deriveStaminaMode(input.occupancy);

  // A backward clock STALLS rather than reverses: an interval that ends before
  // it began settles nothing, and nothing already settled is given back.
  const from = row.updatedAt;
  const span = Math.max(0, input.now.getTime() - from.getTime());

  let remaining = durationMs(row.remainingMs);
  let recovered: DurationMs = ZERO_DURATION;

  if (mode === 'RECOVERING' && span > 0 && row.remainingMs < STAMINA_MAX) {
    const segments = await entitlementPort.segmentsBetween(tx, input.accountId, from, input.now);
    const settled = settleRecovery(remaining, segments);
    recovered = durationMs(settled.remaining - remaining);
    remaining = settled.remaining;
  }

  const changed = mode !== row.mode;
  await tx.characterStamina.update({
    where: { characterId: input.characterId },
    data: {
      remainingMs: remaining,
      mode,
      // The mode's clock only restarts when the mode actually changes; a poll
      // is not a transition (I15).
      ...(changed ? { modeSince: input.now } : {}),
      updatedAt: input.now,
    },
  });

  return { remaining, mode, recovered, settledThrough: input.now };
}
