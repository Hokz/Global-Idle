/**
 * What death costs (Phase 2 correction, source map §8).
 *
 * PURE. It decides what is lost; the caller writes it.
 *
 * The formula is `Player::getLostPercent()` and the application is
 * `Player::death()`, transcribed rather than summarised. The summary that gets
 * repeated — "seven blessings at 8% plus Promotion's 30% is 86% off, always" —
 * is TRUE ONLY FROM LEVEL 24. Below it Canary takes a different branch, and
 * the difference is not small: any blessing reduction of 40% or more is
 * REPLACED by a flat 50%, so five, six and seven blessings all protect
 * identically, and full blessings plus Promotion is 80% off rather than 86%.
 *
 * Every Character Phase 2 can currently represent is below level 24, so the
 * branch that the slogan hides is the only branch this phase ever executes.
 * That is precisely why it is transcribed.
 */
import { levelForXp, xpForLevel } from './progression.js';

/** Canary counts blessings 2 through 8. Twist of Fate (1) is the PvP skull
 *  protection and is not one of them. */
export const FULL_BLESS_COUNT = 7;
/** Percentage points per regular blessing, non-retro. */
export const BLESSING_FACTOR = 8;
/** Percentage points Promotion adds, after the blessing handling. */
export const PROMOTION_REDUCTION = 30;
/** Below this level the base loss is flat. */
export const FORMULA_LEVEL = 24;
/** ...and that flat base is ten percent of the total. */
export const LOW_LEVEL_LOSS_PERCENT = 10;
/** Below `FORMULA_LEVEL`, a reduction at or above this is replaced outright. */
export const LOW_LEVEL_BRANCH_THRESHOLD = 0.4;
export const LOW_LEVEL_BRANCH_REPLACEMENT = 0.5;
/** A VOCATIONED Character at or below this level loses no experience. A
 *  vocation-less one always does — see {@link losesExperience}. */
export const VOCATION_EXEMPT_LEVEL = 7;

/**
 * What stands between a Character and its death penalty.
 *
 * THE SEAM. Phase 2 ships no blessing shop and no Oracle, so nothing yet
 * CHANGES these — but the policy reads them from authoritative state rather
 * than assuming "unblessed forever" inside the Hunt, so the acquisition flow
 * that arrives in a later phase attaches here and nowhere else.
 */
export interface DeathProtection {
  /** Regular blessings held, 0 to 7. */
  readonly blessings: number;
  /** Promotion. FALSE for a vocation-less Character, which is the source's
   *  answer and not a Global Idle rule: `Vocations::getPromotedVocation(0)` is
   *  `VOCATION_NONE`, so `Player::isPromoted()` is false for it. */
  readonly promoted: boolean;
}

/** The state a fresh Rookgaard Character is in. */
export const UNPROTECTED: DeathProtection = { blessings: 0, promoted: false };

/**
 * Full Bless — all seven regular blessings.
 *
 * This is the BINARY threshold for carried-reward protection: below it the
 * Gold Pouch is forfeited in full, at it the Pouch is kept in full. Partial
 * blessings still reduce the experience loss; they protect nothing carried.
 */
export const isFullBless = (protection: DeathProtection): boolean =>
  protection.blessings >= FULL_BLESS_COUNT;

export interface DeathLossInput {
  /** Total accumulated Base XP. */
  readonly experience: bigint;
  readonly protection: DeathProtection;
  /** null = no vocation chosen yet, which is every Phase 2 Character. */
  readonly vocation: string | null;
}

/**
 * `Player::getPercentLevel` — progress into the current level, as a percentage
 * with two decimals. It only matters from level 24, where it makes the loss
 * depend on the fractional level.
 */
export function levelPercent(experience: bigint, level: number): number {
  const start = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - start;
  if (span <= 0n) return 0;
  const result = Math.round(((Number(experience - start) * 100) / Number(span)) * 100) / 100;
  return result > 100 ? 0 : result;
}

/**
 * `Player::getLostPercent()` — the FRACTION of total experience that death
 * costs.
 *
 * TRANSCRIBED IN THE SOURCE'S ARITHMETIC, in the source's order, in the same
 * binary64 the source uses. That is deliberate and it is visible: the source
 * computes `(1 - 0.30)` and `× 10 ÷ 100` in floating point, which lands a hair
 * above the exact value often enough to cost one extra point whenever the
 * exact product is a whole number. Recomputing this in exact rational
 * arithmetic would "fix" about one case in five hundred and would be a silent
 * divergence from the baseline in every one of them. The baseline is the
 * baseline; DL7 pins the boundary where the two readings differ.
 */
export function lostPercent(input: DeathLossInput): number {
  const level = levelForXp(input.experience);
  const blessingCount = Math.max(0, Math.min(FULL_BLESS_COUNT, input.protection.blessings));
  let percentReduction = (blessingCount * BLESSING_FACTOR) / 100;

  let lossPercent: number;
  if (level >= FORMULA_LEVEL) {
    const tmpLevel = level + levelPercent(input.experience, level) / 100;
    lossPercent =
      ((tmpLevel + 50) * 50 * (tmpLevel * tmpLevel - 5 * tmpLevel + 8)) / Number(input.experience);
  } else {
    percentReduction =
      percentReduction >= LOW_LEVEL_BRANCH_THRESHOLD
        ? LOW_LEVEL_BRANCH_REPLACEMENT
        : percentReduction;
    lossPercent = LOW_LEVEL_LOSS_PERCENT;
  }

  if (input.protection.promoted) percentReduction += PROMOTION_REDUCTION / 100;

  return (lossPercent * (1 - percentReduction)) / 100;
}

/**
 * Whether the loss is applied at all.
 *
 * `Player::death()` guards the subtraction with `vocation == VOCATION_NONE ||
 * level > 7`. Reading only the second half would make Global Idle's Origin
 * Character — which is vocation-less until the Level-8 Oracle — immune to its
 * own death penalty for its entire tutorial. It is on the FIRST side of the
 * guard, and it always loses.
 */
export function losesExperience(vocation: string | null, level: number): boolean {
  return vocation === null || level > VOCATION_EXEMPT_LEVEL;
}

export interface DeathSettlement {
  /** The fraction `getLostPercent()` returned, for the record. */
  readonly lostPercent: number;
  readonly experienceLost: bigint;
  readonly experienceAfter: bigint;
  readonly levelBefore: number;
  readonly levelAfter: number;
  /** Full Bless keeps what the Character was carrying; anything less loses it
   *  all. Partial blessings reduce the XP loss and protect nothing carried. */
  readonly forfeitsCarried: boolean;
}

/**
 * What one death does to a Character's durable progression.
 *
 * `ceil` on the loss and a walk down the levels afterwards, both from the
 * source. Experience never goes negative and the level never falls below 1.
 */
export function settleDeath(input: DeathLossInput): DeathSettlement {
  const levelBefore = levelForXp(input.experience);
  const fraction = lostPercent(input);

  let experienceLost = 0n;
  if (losesExperience(input.vocation, levelBefore) && input.experience > 0n) {
    // The source multiplies a uint64 by a double, so it loses the same
    // precision above 2^53 that this does. Matching it means matching that
    // too, rather than being quietly more exact than the thing being copied.
    experienceLost = BigInt(Math.ceil(Number(input.experience) * fraction));
  }
  if (experienceLost > input.experience) experienceLost = input.experience;
  if (experienceLost < 0n) experienceLost = 0n;

  const experienceAfter = input.experience - experienceLost;
  return {
    lostPercent: fraction,
    experienceLost,
    experienceAfter,
    levelBefore,
    levelAfter: levelForXp(experienceAfter),
    forfeitsCarried: !isFullBless(input.protection),
  };
}
