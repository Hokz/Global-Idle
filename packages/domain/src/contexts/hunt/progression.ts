/**
 * Base XP and Base Level (Phase 2 spec §5, source map §5).
 *
 * The curve is Canary's `Player::getExpForLevel`, transcribed:
 *
 *   (((level - 6) * level + 17) * level - 12) / 6 * 100
 *
 * `COMBAT_LEVEL_SKILLS_FOUNDATION.md` §45 lists "exact Base Level XP curve" as
 * an open decision. `REFERENCES.md` says Tibia answers the gameplay questions
 * Tibia has already answered, so this closes it from source rather than by
 * invention — and the numbers it produces are the ones a Tibia player already
 * knows: 100 at level 2, 4200 at level 8.
 *
 * `bigint` throughout: the curve passes 2^31 around level 1700 and the product
 * has no level cap.
 */

export const STARTING_LEVEL = 1;

/** Total Base XP required to BE this level. Level 1 is 0. */
export function xpForLevel(level: number): bigint {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`A level must be a positive integer, got ${level}.`);
  }
  const l = BigInt(level);
  return ((((l - 6n) * l + 17n) * l - 12n) / 6n) * 100n;
}

/**
 * The level a total of Base XP buys. Monotonic and exact — a search rather
 * than an inverted formula, because the curve is integer-divided and an
 * algebraic inverse would disagree with it at the boundaries by one, which is
 * precisely where a level-up happens.
 */
export function levelForXp(xp: bigint): number {
  if (xp < 0n) throw new RangeError(`Base XP cannot be negative, got ${xp}.`);
  let level = STARTING_LEVEL;
  // Double until the requirement passes the total, then walk back down. Even
  // for absurd totals this is a few dozen iterations.
  let high = 2;
  while (xpForLevel(high) <= xp) high *= 2;
  for (let candidate = high; candidate >= STARTING_LEVEL; candidate -= 1) {
    if (xpForLevel(candidate) <= xp) {
      level = candidate;
      break;
    }
  }
  return level;
}

/** What the UI needs to draw a progress bar, without recomputing the curve. */
export interface LevelProgress {
  readonly level: number;
  readonly totalXp: bigint;
  readonly levelStartXp: bigint;
  readonly nextLevelXp: bigint;
}

export function levelProgress(xp: bigint): LevelProgress {
  const level = levelForXp(xp);
  return {
    level,
    totalXp: xp,
    levelStartXp: xpForLevel(level),
    nextLevelXp: xpForLevel(level + 1),
  };
}
