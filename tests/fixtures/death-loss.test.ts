/**
 * Phase 2 correction §12 — DL1 to DL9. What death costs, from the source.
 *
 * These are PURE and they are about arithmetic, so they are asserted against
 * the pure settlement: a database adds nothing to a claim about a formula.
 * DL10 and DL11 — the ones about durable state and about not applying the loss
 * twice — live with the database, where they can be wrong.
 *
 * THE SLOGAN THIS GROUP EXISTS TO REFUSE: "seven blessings at 8% plus
 * Promotion's 30% is 86% off". That is true from level 24 and false below it,
 * where Canary REPLACES any reduction of 40% or more with a flat 50% before
 * Promotion is added. Every Character Phase 2 can currently represent is below
 * level 24, so the branch the slogan hides is the only branch this phase ever
 * runs.
 */
import { describe, expect, it } from 'vitest';
import { hunt } from '@global-idle/domain';
import { recorded, recordedValue } from '../support/canary.js';

const {
  BLESSING_FACTOR,
  FORMULA_LEVEL,
  FULL_BLESS_COUNT,
  LOW_LEVEL_LOSS_PERCENT,
  PROMOTION_REDUCTION,
  losesExperience,
  lostPercent,
  settleDeath,
  xpForLevel,
} = hunt;

/** A vocation-less Origin Character, which is every Phase 2 Character. */
const origin = (experience: bigint, blessings = 0) =>
  ({ experience, protection: { blessings, promoted: false }, vocation: null }) as const;

/** Someone who has been to the Oracle, for the cases that need a vocation. */
const vocationed = (experience: bigint, blessings: number, promoted: boolean) =>
  ({ experience, protection: { blessings, promoted }, vocation: 'KNIGHT' }) as const;

describe('§12 DL — what death costs', () => {
  it('DL1: below level 24 the base loss is a flat ten percent', () => {
    expect(LOW_LEVEL_LOSS_PERCENT).toBe(recordedValue('death.lowLevelLoss'));
    expect(FORMULA_LEVEL).toBe(24);

    // Unblessed and unpromoted, the reduction is nothing and the loss is the
    // base: a tenth of everything the Character has.
    expect(lostPercent(origin(1000n))).toBeCloseTo(0.1, 12);
    expect(settleDeath(origin(1000n)).experienceLost).toBe(100n);
    expect(settleDeath(origin(4200n)).experienceLost).toBe(420n);

    // It is a tenth of the TOTAL, not of the level's progress: a Character
    // deep into level 7 loses more than one at the start of it.
    expect(settleDeath(origin(2700n)).experienceLost).toBe(270n);
    expect(settleDeath(origin(3700n)).experienceLost).toBe(370n);

    // Nothing to lose is nothing lost, rather than an error or a negative.
    expect(settleDeath(origin(0n)).experienceLost).toBe(0n);
  });

  it('DL2: below the branch, each blessing is worth eight points', () => {
    expect(BLESSING_FACTOR).toBe(recordedValue('death.blessingFactor'));

    // 1 to 4 blessings stay under 40%, so they reduce linearly.
    for (const [blessings, reduction] of [
      [0, 0.0],
      [1, 0.08],
      [2, 0.16],
      [3, 0.24],
      [4, 0.32],
    ] as const) {
      expect(lostPercent(origin(1000n, blessings))).toBeCloseTo((10 * (1 - reduction)) / 100, 12);
    }

    expect(settleDeath(origin(1000n, 4)).experienceLost).toBe(68n);
  });

  it('DL3: below level 24, forty percent or more is REPLACED by fifty', () => {
    // This is the branch the slogan hides. Five blessings would be 40%; Canary
    // does not use 40%, it uses 50%. Six and seven would be 48% and 56%;
    // Canary uses 50% for those too. At low level the fifth blessing is worth
    // 18 points and the sixth and seventh are worth NOTHING.
    expect(settleDeath(origin(1000n, 4)).experienceLost).toBe(68n);
    expect(settleDeath(origin(1000n, 5)).experienceLost).toBe(50n);
    expect(settleDeath(origin(1000n, 6)).experienceLost).toBe(50n);
    expect(settleDeath(origin(1000n, 7)).experienceLost).toBe(50n);

    // Stated as the reduction itself, so a refactor that "simplified" the
    // branch into a linear formula fails here rather than in a balance report.
    expect(lostPercent(origin(1000n, 5))).toBeCloseTo(0.05, 12);
    expect(lostPercent(origin(1000n, 7))).toBeCloseTo(0.05, 12);
    expect(recorded('death.lowLevelBlessingBranch').decision).toBe('Keep');
  });

  it('DL4: Promotion adds thirty points, AFTER the branch', () => {
    expect(PROMOTION_REDUCTION).toBe(recordedValue('death.promotion'));

    // Full blessings plus Promotion, below level 24: 50% + 30% = 80% off, so
    // the loss is 2% of the total. NOT 86%, and this is the case that says so.
    const low = settleDeath(vocationed(1000n, FULL_BLESS_COUNT, true));
    expect(low.lostPercent).toBeCloseTo(0.02, 12);
    expect((10 * (1 - 0.86)) / 100).not.toBeCloseTo(low.lostPercent, 6);

    // The order matters: 30 points are added to the REPLACED 50, not to the
    // 56 the blessings were worth before the replacement.
    expect(settleDeath(vocationed(1000n, 4, true)).lostPercent).toBeCloseTo(0.038, 12);
    expect(settleDeath(vocationed(1000n, 5, true)).lostPercent).toBeCloseTo(0.02, 12);
  });

  it('DL5: from level 24 the loss follows the level, and 86% is real there', () => {
    // Level 24 is 179,400 experience on the Canary curve.
    expect(xpForLevel(FORMULA_LEVEL)).toBe(179_400n);

    const experience = 15_694_800n; // exactly level 100
    const bare = settleDeath(vocationed(experience, 0, false));
    const blessed = settleDeath(vocationed(experience, FULL_BLESS_COUNT, true));

    // 7 x 8% + 30% = 86%, so what is left is 14% of the bare loss. This IS the
    // branch the slogan describes, and it only applies here.
    expect(Number(blessed.experienceLost) / Number(bare.experienceLost)).toBeCloseTo(0.14, 6);

    // The ABSOLUTE loss depends on the level, not on the total: the same level
    // costs the same experience whether the Character is at the start of it or
    // deep into the next one's approach.
    const deeper = settleDeath(vocationed(experience + 1_000_000n, 0, false));
    expect(deeper.levelBefore).toBeGreaterThan(bare.levelBefore);
    expect(bare.experienceLost).toBeGreaterThan(0n);

    // And it is genuinely the other branch: a Character one level below 24
    // loses a tenth, one at 24 loses far less.
    const justBelow = settleDeath(vocationed(xpForLevel(23), 0, false));
    expect(justBelow.experienceLost).toBe(BigInt(Math.ceil(Number(xpForLevel(23)) * 0.1)));
    const atTheLine = settleDeath(vocationed(xpForLevel(24), 0, false));
    expect(Number(atTheLine.experienceLost) / Number(xpForLevel(24))).toBeLessThan(0.1);
  });

  it('DL6: the vocation gate decides whether anything is lost at all', () => {
    // `Player::death` subtracts only when the Character has NO vocation or is
    // above level 7. Reading only the second half would make Global Idle's
    // Origin Character — vocation-less until the Level-8 Oracle — immune to
    // its own death penalty for the whole tutorial.
    expect(losesExperience(null, 1)).toBe(true);
    expect(losesExperience(null, 7)).toBe(true);
    expect(losesExperience('KNIGHT', 7)).toBe(false);
    expect(losesExperience('KNIGHT', 8)).toBe(true);

    // The Origin Character loses from its very first death.
    expect(settleDeath(origin(100n)).experienceLost).toBe(10n);
    // A vocationed Character at level 7 loses nothing, and still ends up in a
    // settlement rather than an exception.
    const protectedByLevel = settleDeath(vocationed(2700n, 0, false));
    expect(protectedByLevel.levelBefore).toBe(7);
    expect(protectedByLevel.experienceLost).toBe(0n);
    expect(protectedByLevel.experienceAfter).toBe(2700n);

    expect(recorded('death.expLossGate').reason).toMatch(/Origin Character/);
  });

  it('DL7: the loss is rounded UP, in the source’s own arithmetic', () => {
    // `ceil`, so a death that would cost a fraction of a point costs one.
    expect(settleDeath(origin(1n)).experienceLost).toBe(1n);
    expect(settleDeath(origin(11n)).experienceLost).toBe(2n);
    expect(settleDeath(origin(19n)).experienceLost).toBe(2n);
    expect(settleDeath(origin(21n)).experienceLost).toBe(3n);

    // AND in the source's floating point, which is not the same as exact
    // arithmetic. At 4,300 experience, unblessed and promoted, the exact
    // product is 301 exactly; the source computes (1 - 0.30) in binary64,
    // lands a hair above 301, and charges 302. Transcribing the baseline means
    // transcribing that too — being quietly more exact than the thing being
    // copied is a divergence, and a silent one.
    const atTheBoundary = settleDeath(vocationed(4300n, 0, true));
    expect(atTheBoundary.experienceLost).toBe(302n);
    expect(Math.ceil((4300 * 10 * (100 - 30)) / 10000)).toBe(301);
  });

  it('DL8: the level walks down after the loss, and stops at one', () => {
    // 100 experience is exactly level 2; losing a tenth drops it back to 1.
    const demoted = settleDeath(origin(100n));
    expect(demoted.levelBefore).toBe(2);
    expect(demoted.experienceAfter).toBe(90n);
    expect(demoted.levelAfter).toBe(1);

    // 4,200 is exactly level 8 — the Oracle's doorstep. A death sends it back.
    const oracle = settleDeath(origin(4200n));
    expect(oracle.levelBefore).toBe(8);
    expect(oracle.levelAfter).toBe(7);

    // Level 1 is the floor: there is no level 0 and no negative level.
    const floor = settleDeath(origin(50n));
    expect(floor.levelBefore).toBe(1);
    expect(floor.levelAfter).toBe(1);
    expect(floor.experienceAfter).toBe(45n);

    // A loss that does not cross a boundary does not move the level.
    const survived = settleDeath(origin(190n));
    expect(survived.levelBefore).toBe(2);
    expect(survived.levelAfter).toBe(2);
  });

  it('DL9: experience never goes negative, however the numbers fall', () => {
    for (const experience of [0n, 1n, 2n, 9n, 10n, 99n, 100n, 4200n, 179_400n]) {
      for (const blessings of [0, 3, 5, 7]) {
        const settled = settleDeath(origin(experience, blessings));
        expect(settled.experienceLost).toBeGreaterThanOrEqual(0n);
        expect(settled.experienceLost).toBeLessThanOrEqual(experience);
        expect(settled.experienceAfter).toBeGreaterThanOrEqual(0n);
        expect(settled.experienceAfter + settled.experienceLost).toBe(experience);
        expect(settled.levelAfter).toBeGreaterThanOrEqual(1);
        expect(settled.levelAfter).toBeLessThanOrEqual(settled.levelBefore);
      }
    }
  });
});
