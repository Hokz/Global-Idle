/**
 * Server time (§7.1). Two concerns, deliberately separated.
 *
 * A wall-clock instant is NOT intrinsically monotonic, and a process monotonic
 * clock cannot span a restart — which is precisely what durable timers must
 * do. So `Clock` is the authoritative UTC wall clock and the only durable
 * timestamp source; `MonotonicSource` is intra-process measurement and is
 * NEVER persisted.
 *
 * Both are injected. There is no `Date.now()` in domain code, and ESLint
 * enforces that (§3.5).
 */
import type { DurationMs, Instant, Mark, MonotonicSource } from '@global-idle/shared';
import { durationMs, regressionOf } from '@global-idle/shared';

export interface Clock {
  now(): Instant;
}

export class SystemClock implements Clock {
  now(): Instant {
    return new Date();
  }
}

/** Test support: settable, advanceable, and able to move BACKWARDS, which
 *  §7.1.1 requires and §14.5 tests. */
export class FakeClock implements Clock {
  #current: Instant;

  constructor(start: Instant) {
    this.#current = new Date(start.getTime());
  }

  now(): Instant {
    return new Date(this.#current.getTime());
  }

  set(at: Instant): void {
    this.#current = new Date(at.getTime());
  }

  advance(by: DurationMs): void {
    this.#current = new Date(this.#current.getTime() + by);
  }

  /** Move the clock backwards. NTP correction, VM migration, operator error —
   *  durable settlement must be defined for it (§7.1.1). */
  rewind(by: DurationMs): void {
    this.#current = new Date(this.#current.getTime() - by);
  }
}

export class ProcessMonotonicSource implements MonotonicSource {
  mark(): Mark {
    return performance.now() as Mark;
  }

  elapsedSince(mark: Mark): DurationMs {
    return durationMs(Math.max(0, Math.round(performance.now() - mark)));
  }
}

/**
 * A backward clock step beyond this is an OPERATIONAL SIGNAL, not a silent
 * correction (§7.1.1 rule 3). Small steps are ordinary NTP slew.
 */
export const CLOCK_REGRESSION_TOLERANCE: DurationMs = durationMs(1_000);

export interface ClockRegressionObserver {
  /** Called when `now` is earlier than a stored marker by more than the
   *  tolerance. 0B.9 attaches the `clock_regression_total` counter here. */
  onRegression(details: {
    readonly by: DurationMs;
    readonly since: Instant;
    readonly now: Instant;
  }): void;
}

export const noopRegressionObserver: ClockRegressionObserver = { onRegression: () => {} };

/**
 * Report a clock regression if one happened. Returns the regression amount so
 * a caller can log it; it NEVER rewrites the stored marker, because rewriting
 * would change history to match a broken clock (§7.1.1 rule 4).
 */
export function reportRegression(
  since: Instant,
  now: Instant,
  observer: ClockRegressionObserver = noopRegressionObserver,
): DurationMs {
  const by = regressionOf(since, now);
  if (by > CLOCK_REGRESSION_TOLERANCE) observer.onRegression({ by, since, now });
  return by;
}
