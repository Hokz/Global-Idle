/**
 * Per-Character Stamina (ADR-014, §7.4). INTERNAL to the character context.
 *
 * Phase 0B builds the DURABLE REPRESENTATION and the MODE MACHINERY. It does
 * not build the Hunt reward loop: nothing here decides when a Hunt awards
 * qualifying XP, and nothing applies an XP multiplier (§19).
 */
import {
  STAMINA_MAX,
  STAMINA_RECOVERY_BOUNDARY,
  ZERO_DURATION,
  durationMs,
  type DurationMs,
  type Instant,
} from '@global-idle/shared';
import type { RateSegment } from '../../identity/index.js';
import type { StaminaClassification } from '../../activity/index.js';

export type StaminaMode = 'CONSUMING' | 'NEUTRAL' | 'RECOVERING';

export interface CharacterStaminaState {
  readonly remaining: DurationMs;
  readonly mode: StaminaMode;
  readonly modeSince: Instant;
}

/** Everything the mode derivation is allowed to look at. */
export interface OccupancyView {
  /** null means the Character holds no occupancy claim at all. */
  readonly claim: {
    readonly stamina: StaminaClassification;
    /** Session-bound state, or null for a wall-clock activity. */
    readonly sessionState: 'ONLINE_ACTIVE' | 'RECONNECT_GRACE_PAUSED' | 'ACTIVITY_ENDED' | null;
    /** ADR-014's first-qualifying-XP flag, per participant. null = not yet. */
    readonly staminaActivatedAt: Instant | null;
  } | null;
}

/**
 * Mode is a PURE FUNCTION of authoritative state, never assigned freely: a
 * Character cannot be put into CONSUMING except by the activity machinery
 * (§7.3.1, §7.4).
 *
 * The ordering matters. OCCUPANCY IS NOT CONSUMPTION — Skill Training occupies
 * the Character (so it cannot also hunt) AND is recovery-eligible (so its
 * Stamina climbs). One claim, two independent classifications.
 */
export function deriveStaminaMode(view: OccupancyView): StaminaMode {
  const claim = view.claim;
  if (claim === null) return 'RECOVERING';
  if (claim.stamina === 'STAMINA_RECOVERY_ELIGIBLE') return 'RECOVERING';
  // From here the activity is STAMINA_CONSUMING.
  if (claim.sessionState === 'RECONNECT_GRACE_PAUSED') return 'NEUTRAL';
  if (claim.sessionState === 'ACTIVITY_ENDED') return 'RECOVERING';
  if (claim.staminaActivatedAt === null) return 'NEUTRAL';
  return claim.sessionState === 'ONLINE_ACTIVE' ? 'CONSUMING' : 'NEUTRAL';
}

/**
 * A settlement segment: a span over which BOTH the entitlement and the
 * stamina band are constant, so it can be rated on its own terms.
 *
 * `band` records which side of the 39:00 line the span sits on. Phase 0B
 * produces the split and applies NOTHING to it: the 42:00-39:00 Premium Hunt
 * XP band is Phase 2's, and §19 forbids its maths here. Building the split now
 * means Phase 2 attaches a multiplier rather than retrofitting segmentation.
 */
export interface StaminaSegment {
  readonly duration: DurationMs;
  readonly premium: boolean;
  readonly band: 'ABOVE_39H' | 'BELOW_39H';
}

/**
 * Recovery: Premium 1:1, Free 1:2, capped at STAMINA_MAX
 * (ACTIVITY_OCCUPANCY_AND_TIMERS.md §3.1). There is no mandatory waiting
 * period before recovery begins.
 */
export function settleRecovery(
  remaining: DurationMs,
  segments: readonly RateSegment[],
): { readonly remaining: DurationMs; readonly segments: readonly StaminaSegment[] } {
  let current = remaining;
  const produced: StaminaSegment[] = [];

  for (const segment of segments) {
    // Split the segment where the 39:00 line is crossed, so each piece sits
    // wholly in one band.
    let left = segment.duration as number;
    while (left > 0) {
      const gainRate = segment.premium ? 1 : 0.5;
      const band: StaminaSegment['band'] =
        current < STAMINA_RECOVERY_BOUNDARY ? 'BELOW_39H' : 'ABOVE_39H';

      const toBoundary =
        band === 'BELOW_39H' ? (STAMINA_RECOVERY_BOUNDARY - current) / gainRate : Infinity;
      const toCap = (STAMINA_MAX - current) / gainRate;
      const step = Math.min(left, toBoundary, toCap);

      if (!Number.isFinite(step) || step <= 0) {
        // Already at the cap: the remaining time recovers nothing, but it is
        // still a segment that happened.
        produced.push({ duration: durationMs(left), premium: segment.premium, band });
        break;
      }

      const wholeStep = Math.max(1, Math.round(step));
      const applied = Math.min(left, wholeStep);
      current = durationMs(Math.min(STAMINA_MAX, Math.round(current + applied * gainRate)));
      produced.push({ duration: durationMs(applied), premium: segment.premium, band });
      left -= applied;
    }
  }

  return { remaining: current, segments: produced };
}

/** Consumption: one second of qualifying Hunt time costs one second of
 *  Stamina, floored at zero. Zero Stamina is a STATE, never an error: it does
 *  not block combat (ADR-014). */
export function settleConsumption(
  remaining: DurationMs,
  duration: DurationMs,
): { readonly remaining: DurationMs; readonly consumed: DurationMs } {
  const consumed = durationMs(Math.min(remaining, duration));
  return { remaining: durationMs(remaining - consumed), consumed };
}

/** NEUTRAL consumes nothing and recovers nothing (§7.4, test T8). */
export function settleNeutral(remaining: DurationMs): DurationMs {
  return remaining;
}

export const ZERO_STAMINA: DurationMs = ZERO_DURATION;
export { STAMINA_MAX, STAMINA_RECOVERY_BOUNDARY };
