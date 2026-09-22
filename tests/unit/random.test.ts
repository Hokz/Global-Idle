/**
 * Cross-phase §21 — RNGC11 and RNGC12. The generator's durable position.
 *
 * `RNGC1`–`RNGC10` prove the DOMAIN keeps a run's streams continuous across
 * settlements. These two prove the thing that makes it possible, at the level
 * where a break is one line rather than a whole settlement: a generator can be
 * stopped, written down, and continued — and a written-down state this engine
 * cannot read is refused instead of quietly becoming a different stream.
 */
import { describe, expect, it } from 'vitest';
import {
  SEEDED_RANDOM_ALGORITHM,
  createSeededRandom,
  isSeededRandomState,
  restoreSeededRandom,
  type SeededRandomState,
} from '@global-idle/game-engine';

const draws = (generator: { next(): number }, count: number): number[] =>
  Array.from({ length: count }, () => generator.next());

describe('§21 RNGC — a stream can be put down and picked up', () => {
  it('RNGC11: a restored generator continues the same stream, through JSON', () => {
    const continuous = draws(createSeededRandom('hunt.rookgaard.sewers:0'), 12);

    const stopped = createSeededRandom('hunt.rookgaard.sewers:0');
    const first = draws(stopped, 5);
    // THROUGH JSON, because that is how it reaches the row: a state that only
    // survives an in-memory handoff is not a durable one.
    const stored = JSON.parse(JSON.stringify(stopped.snapshot())) as SeededRandomState;
    const resumed = restoreSeededRandom(stored);
    const rest = draws(resumed, 7);

    expect([...first, ...rest]).toEqual(continuous);
    expect(resumed.drawCount).toBe(12);
    expect(resumed.seed).toBe('hunt.rookgaard.sewers:0');
    expect(stored.algorithm).toBe(SEEDED_RANDOM_ALGORITHM);

    // A snapshot taken before any draw is the seed's own starting position.
    const untouched = createSeededRandom('hunt.rookgaard.sewers:0');
    expect(draws(restoreSeededRandom(untouched.snapshot()), 12)).toEqual(continuous);
  });

  it('RNGC12: a state this engine cannot continue is refused, not reseeded', () => {
    const good = createSeededRandom('seed').snapshot();

    expect(isSeededRandomState(good)).toBe(true);
    for (const bad of [
      null,
      undefined,
      'sfc32-v1',
      {},
      { ...good, algorithm: 'sfc32-v2' },
      { ...good, seed: 7 },
      { ...good, a: -1 },
      { ...good, b: 1.5 },
      { ...good, c: 4294967296 },
      { ...good, drawCount: -1 },
    ]) {
      expect(isSeededRandomState(bad), JSON.stringify(bad)).toBe(false);
    }

    // And the restore itself throws rather than coercing.
    expect(() => restoreSeededRandom({ ...good, algorithm: 'sfc32-v2' } as never)).toThrow(
      /Unknown RNG algorithm/,
    );
    expect(() => restoreSeededRandom({ ...good, d: 1.25 } as never)).toThrow(/must be a uint32/);
    expect(() => restoreSeededRandom({ ...good, drawCount: -3 } as never)).toThrow(
      /must be a count/,
    );
  });
});
