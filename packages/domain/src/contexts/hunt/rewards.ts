/**
 * Turning a simulated span into DURABLE rewards, under the locked Stamina
 * rules (`ACTIVITY_OCCUPANCY_AND_TIMERS.md` §2, Phase 2 spec §6).
 *
 * Pure. It decides *what* changes; the caller writes it.
 *
 * WHY PER-REWARD AND NOT PRO-RATA. §2.2 requires a settlement interval that
 * crosses 39:00 to be SPLIT at the boundary — the part above settles at 1.5×,
 * the part below at 1.0×. Rewards are discrete and each carries the tick it
 * happened on, so the exact Stamina at each one is computable. Pro-rating a
 * settlement's XP across the boundary would be an approximation where an exact
 * answer exists, and cases 23 and 24 ask for determinism at the boundary
 * itself.
 */
import { STAMINA_RECOVERY_BOUNDARY, durationMs, type DurationMs } from '@global-idle/shared';
import { TICK_MS, type HuntReward } from '@global-idle/game-engine';

/** The Premium Hunt XP band, §2.2. */
export const PREMIUM_XP_MULTIPLIER = 1.5;

export interface RewardSettlementInput {
  /** The tick the settled span starts AFTER. */
  readonly fromTick: number;
  /** The tick the settled span ends ON. */
  readonly toTick: number;
  readonly rewards: readonly HuntReward[];
  readonly staminaRemaining: DurationMs;
  /** Already activated before this span? */
  readonly activated: boolean;
  readonly premium: boolean;
}

export interface RewardSettlement {
  readonly experience: bigint;
  readonly gold: bigint;
  readonly staminaRemaining: DurationMs;
  readonly staminaConsumed: DurationMs;
  /** The tick the FIRST qualifying XP landed on, when this span activated
   *  consumption. null when it was already activated, or still is not. */
  readonly activatedAtTick: number | null;
  /** Rewards dropped because Stamina was exactly zero (§2.3). */
  readonly rewardsDropped: number;
}

/**
 * The band at a given remaining Stamina.
 *
 * `> BOUNDARY`, not `>=`: §2.2's band is "42:00 → 39:00", and exactly 39:00 is
 * the boundary rather than a point above it. Case 23 pins this, and it has to
 * be pinned somewhere — an implementation that chose `>=` would also be
 * self-consistent and would disagree by one settlement's worth of bonus.
 */
export const isPremiumBand = (remaining: DurationMs): boolean =>
  remaining > STAMINA_RECOVERY_BOUNDARY;

export function settleRewards(input: RewardSettlementInput): RewardSettlement {
  let remaining = input.staminaRemaining as number;
  let activated = input.activated;
  let activatedAtTick: number | null = null;
  let experience = 0n;
  let gold = 0n;
  let consumed = 0;
  let rewardsDropped = 0;
  let cursor = input.fromTick;

  /** Consume `ticks` of ONLINE_ACTIVE time, floored at zero (§2.1). */
  const consume = (ticks: number): void => {
    if (!activated || ticks <= 0) return;
    const wanted = ticks * TICK_MS;
    const taken = Math.min(remaining, wanted);
    remaining -= taken;
    consumed += taken;
  };

  const ordered = [...input.rewards].sort((a, b) => a.tick - b.tick);
  for (const reward of ordered) {
    // Consumption covers the ticks STRICTLY AFTER activation: the tick that
    // brought the first XP is the activation, not the first second spent.
    consume(reward.tick - cursor);
    cursor = reward.tick;

    // §2.3 — at exactly zero Stamina the Character is reward-INELIGIBLE. Not
    // reduced: zero XP, zero Gold, zero everything. Combat carries on.
    if (remaining <= 0) {
      rewardsDropped += 1;
      continue;
    }

    const multiplier =
      input.premium && isPremiumBand(durationMs(remaining)) ? PREMIUM_XP_MULTIPLIER : 1;
    // Floor, so a multiplier can never invent a fraction of a point.
    experience += BigInt(Math.floor(reward.experience * multiplier));
    gold += BigInt(reward.gold);

    if (!activated) {
      activated = true;
      activatedAtTick = reward.tick;
    }
  }

  consume(input.toTick - cursor);

  return {
    experience,
    gold,
    staminaRemaining: durationMs(remaining),
    staminaConsumed: durationMs(consumed),
    activatedAtTick,
    rewardsDropped,
  };
}
