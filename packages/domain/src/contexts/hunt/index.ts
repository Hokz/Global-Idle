// Public surface of the Hunt bounded context (ADR-001, Phase 2).
//
// This file is the ONLY legal entry point. It owns the Hunt RUN: the durable
// position of a simulation, its settlement into XP, Gold, Stamina and
// supplies, and its ending. It does not own the simulation itself — that is
// `@global-idle/game-engine`, which is pure and knows nothing about any of
// this.
export const CONTEXT_NAME = 'hunt' as const;

export {
  LIVENESS_WINDOW,
  advance,
  endForSession,
  endRun,
  endRunOrActivity,
  snapshot,
  startRun,
} from './run.js';
export type { DeathPenalty, HuntEndReason, HuntRunView } from './run.js';

export {
  BLESSING_FACTOR,
  FORMULA_LEVEL,
  FULL_BLESS_COUNT,
  LOW_LEVEL_BRANCH_REPLACEMENT,
  LOW_LEVEL_BRANCH_THRESHOLD,
  LOW_LEVEL_LOSS_PERCENT,
  PROMOTION_REDUCTION,
  UNPROTECTED,
  VOCATION_EXEMPT_LEVEL,
  isFullBless,
  levelPercent,
  losesExperience,
  lostPercent,
  settleDeath,
} from './death.js';
export type { DeathLossInput, DeathProtection, DeathSettlement } from './death.js';

export { buildHuntPlan } from './plan.js';
export type { HuntPlan } from './plan.js';

export { PREMIUM_XP_MULTIPLIER, isPremiumBand, settleRewards } from './rewards.js';
export type { RewardSettlement, RewardSettlementInput } from './rewards.js';

export { STARTING_LEVEL, levelForXp, levelProgress, xpForLevel } from './progression.js';
export type { LevelProgress } from './progression.js';
