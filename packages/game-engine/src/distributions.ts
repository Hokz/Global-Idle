/**
 * The two random distributions Canary's combat draws from, transcribed.
 *
 * Source: `src/utils/tools.cpp` in `Hokz/canary` —
 *
 *   uniform_random(min, max)  uniform, inclusive
 *   normal_random(min, max)   std::normal_distribution<float>(0.5f, 0.25f),
 *                             REJECTION-SAMPLED into [0, 1], then
 *                             min + lround(v * (max - min))
 *
 * Damage in Tibia is centred, not flat. Using a uniform roll here would make
 * every hit equally likely and change the feel of every fight — which is
 * exactly the kind of silent divergence `REFERENCES.md` exists to prevent.
 *
 * ONE ADAPTATION, DELIBERATE. Canary rejection-samples, which consumes a
 * VARIABLE number of draws. This engine's contract is that draw ordering is
 * fixed (`random.ts`), because a replay is only reproducible if the sequence
 * of draws is. So the same distribution is produced by INVERSE TRANSFORM over
 * the truncated normal instead: one draw, and the resulting distribution is
 * identical to the rejection sampler's, not an approximation of it. Rejection
 * sampling and inverse transform on the same truncated support are the same
 * distribution by construction.
 */
import type { SeededRandom } from './random.js';

const MEAN = 0.5;
const SIGMA = 0.25;
/** Φ(±2): the mass the rejection sampler discards outside [0, 1]. The upper
 *  bound is DERIVED rather than written out, so the two can never drift apart
 *  and the literal is the one a double actually holds. */
const LOWER = 0.022750131948179195;
const UPPER = 1 - LOWER;

/**
 * The inverse standard normal CDF — Acklam's rational approximation, with one
 * Halley refinement. Accurate to about 1e-15 over the range this uses, which
 * is far finer than the integer damage it feeds.
 */
function probit(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;

  let q: number;
  let r: number;
  let x: number;
  if (p < low) {
    q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - low) {
    q = p - 0.5;
    r = q * q;
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }

  // One Halley step. The approximation above is good to ~1e-9; this takes it
  // to machine precision, so the fixture cannot drift with a compiler.
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Complementary error function, Numerical Recipes' Chebyshev form. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const ty = 4 * t - 2;
  const cof = [
    -1.3026537197817094, 6.419697923564902e-1, 1.9476473204185836e-2, -9.56151478680863e-3,
    -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5,
    -1.624290004647e-6, 1.30365583558e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
    5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11, 2.394038e-12, -6.886027e-12,
    8.94487e-13, 3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15,
  ];
  let d = 0;
  let dd = 0;
  for (let j = cof.length - 1; j > 0; j -= 1) {
    const tmp = d;
    d = ty * d - dd + cof[j]!;
    dd = tmp;
  }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0]! + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

/** ONE draw. Canary's `normal_random(min, max)`. */
export function normalRandom(rng: SeededRandom, min: number, max: number): number {
  const [low, high] = min <= max ? [min, max] : [max, min];
  if (low === high) return low;
  const p = LOWER + rng.next() * (UPPER - LOWER);
  const v = MEAN + SIGMA * probit(p);
  // `std::lround` is half-away-from-zero; every value here is non-negative, so
  // Math.round agrees.
  return low + Math.round(v * (high - low));
}

/** ONE draw. Canary's `uniform_random(min, max)`, inclusive. */
export function uniformRandom(rng: SeededRandom, min: number, max: number): number {
  const [low, high] = min <= max ? [min, max] : [max, min];
  if (low === high) return low;
  return low + rng.nextInt(high - low + 1);
}
