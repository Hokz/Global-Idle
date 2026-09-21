/**
 * Time vocabulary (§7.1).
 *
 * Two concerns, deliberately separated. A wall-clock instant is NOT
 * intrinsically monotonic, and a process monotonic clock cannot span a restart
 * — which is precisely what durable timers must do.
 */

/**
 * An authoritative UTC wall-clock instant. The ONLY durable timestamp source.
 * Modelled as `Date` because that is what the persistence layer stores and
 * returns; the alias exists so call sites read as the contract does.
 */
export type Instant = Date;

/** A span of time in whole milliseconds. Branded so it cannot be confused with
 *  a count, an index or an amount. */
export type DurationMs = number & { readonly __durationMs: unique symbol };

export const durationMs = (value: number): DurationMs => {
  if (!Number.isFinite(value)) throw new RangeError(`duration must be finite, got ${value}`);
  if (!Number.isInteger(value)) throw new RangeError(`duration must be whole ms, got ${value}`);
  return value as DurationMs;
};

export const ZERO_DURATION: DurationMs = durationMs(0);

export const seconds = (n: number): DurationMs => durationMs(n * 1_000);
export const minutes = (n: number): DurationMs => durationMs(n * 60_000);
export const hours = (n: number): DurationMs => durationMs(n * 3_600_000);

export const addDuration = (a: DurationMs, b: DurationMs): DurationMs => durationMs(a + b);
export const subtractDuration = (a: DurationMs, b: DurationMs): DurationMs => durationMs(a - b);
export const clampDuration = (value: DurationMs, min: DurationMs, max: DurationMs): DurationMs =>
  durationMs(Math.min(Math.max(value, min), max));

export const plus = (at: Instant, duration: DurationMs): Instant =>
  new Date(at.getTime() + duration);

/**
 * Elapsed time between two instants, per §7.1.1 rule 1: `max(0, now - since)`.
 *
 * It is NEVER negative. A backward clock therefore STALLS a timer rather than
 * reversing it: nothing is minted, and nothing already settled is restored.
 * Callers that need to know a regression happened use {@link regressionOf}.
 */
export const elapsedSince = (since: Instant, now: Instant): DurationMs =>
  durationMs(Math.max(0, now.getTime() - since.getTime()));

/** How far backwards the clock moved, or zero if it did not (§7.1.1 rule 3). */
export const regressionOf = (since: Instant, now: Instant): DurationMs =>
  durationMs(Math.max(0, since.getTime() - now.getTime()));

/** Intra-process measurement only. NEVER persisted (§7.1). */
export interface MonotonicSource {
  mark(): Mark;
  elapsedSince(mark: Mark): DurationMs;
}

export type Mark = number & { readonly __monotonicMark: unique symbol };
