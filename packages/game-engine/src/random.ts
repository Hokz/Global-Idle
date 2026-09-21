/**
 * `SeededRandom` (ADR-010, §9.3). Deterministic, injected, never global.
 *
 * DRAW ORDERING IS PART OF THE CONTRACT. Every method below documents exactly
 * how many draws it consumes, because a replay is only reproducible if the
 * sequence of draws is. A method that sometimes consumes two draws and
 * sometimes one would make the same seed produce different futures depending
 * on data, and the bug would surface as an unreproducible support ticket.
 *
 * The algorithm is sfc32, seeded by cyrb128 over the seed string. Both are
 * written out here rather than imported: a dependency that changes its
 * implementation changes every historical replay, and this package must be
 * able to reproduce a run recorded a year ago.
 */

export interface SeededRandom {
  /** The seed this generator was constructed from. Persisted with the
   *  activity, so a run can be replayed exactly. */
  readonly seed: string;
  /** How many draws have been consumed. Part of the observable state, so a
   *  fixture can assert draw ordering directly. */
  readonly drawCount: number;
  /** ONE draw. A float in [0, 1). */
  next(): number;
  /** ONE draw. An integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** ONE draw. The element at a uniformly chosen index; throws on an empty
   *  array rather than returning undefined, because a caller that silently
   *  gets nothing is a bug that surfaces much later. */
  pick<T>(items: readonly T[]): T;
}

/** 128 bits of seed material from a string. Four 32-bit words, mixed so that
 *  seeds differing in one character do not produce neighbouring streams. */
function cyrb128(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i += 1) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export function createSeededRandom(seed: string): SeededRandom {
  const [s0, s1, s2, s3] = cyrb128(seed);
  let a = s0;
  let b = s1;
  let c = s2;
  let d = s3;
  let draws = 0;

  // sfc32. Every arithmetic step is written with >>> 0 so the state stays in
  // uint32, independently of the engine's number representation.
  function raw(): number {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    d = (d + 1) >>> 0;
    t = (t + d) >>> 0;
    c = (c + t) >>> 0;
    draws += 1;
    return t >>> 0;
  }

  const generator: SeededRandom = {
    seed,
    get drawCount() {
      return draws;
    },
    next() {
      // 2^32 exactly, so the result is in [0, 1) and never reaches 1.
      return raw() / 4294967296;
    },
    nextInt(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`nextInt needs a positive integer bound, got ${maxExclusive}.`);
      }
      // ONE draw, always. Rejection sampling would consume a variable number
      // and break replay; the modulo bias over a 32-bit draw is far below
      // anything this project's bounds can observe.
      return raw() % maxExclusive;
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick needs a non-empty array.');
      const chosen = items[raw() % items.length];
      // The index is in range by construction; this narrows the type without
      // widening the contract.
      return chosen as (typeof items)[number];
    },
  };
  return generator;
}
