// §14.5 — the pure half of Timers and Stamina: T4 to T9, T11 to T14.
//
// These need no database: mode derivation and settlement are pure functions of
// authoritative state, which is what makes them testable at all.
import { describe, expect, it } from 'vitest';
import { character, activity } from '@global-idle/domain';
import {
  CLOCK_REGRESSION_TOLERANCE,
  FakeClock,
  remainingAt,
  reportRegression,
} from '@global-idle/domain';
import { STAMINA_MAX, durationMs, hours, minutes, elapsedSince } from '@global-idle/shared';
import type { RateSegment } from '@global-idle/domain';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const free = (ms: number): RateSegment[] => [
  { from: T0, to: new Date(T0.getTime() + ms), duration: durationMs(ms), premium: false },
];
const premium = (ms: number): RateSegment[] => [
  { from: T0, to: new Date(T0.getTime() + ms), duration: durationMs(ms), premium: true },
];

describe('§14.5 timers and stamina (pure)', () => {
  it('T4: client-provided elapsed time is ignored or rejected', () => {
    // The settlement surface takes INSTANTS, never a duration. There is no
    // parameter anywhere through which a caller can assert how much time
    // passed, which is what makes "the client cannot mint time" structural
    // rather than a validation rule someone might forget (§7.1,
    // CLIENT_SERVER_BOUNDARIES.md §6).
    const since = T0;
    const serverNow = new Date(T0.getTime() + minutes(10));

    // remainingAt derives the elapsed span itself, from the timer's own stored
    // marker and the instant it is given.
    const timer = { remaining: minutes(60), qualifyingSince: since };
    expect(remainingAt(timer, serverNow)).toBe(minutes(50));

    // A client claiming an hour elapsed has nowhere to put the claim: the same
    // call with the same server instant returns the same answer.
    const clientClaimedElapsed = hours(1);
    expect(remainingAt(timer, serverNow)).toBe(minutes(50));
    expect(clientClaimedElapsed).not.toBe(elapsedSince(since, serverNow));

    // And elapsed is computed, not supplied: from the two instants only.
    expect(elapsedSince(since, serverNow)).toBe(minutes(10));
  });

  it('T5: a Premium transition splits a duration interval into correctly-rated segments', () => {
    // One hour, Premium for the first 20 minutes and Free for the rest.
    const segments: RateSegment[] = [
      {
        from: T0,
        to: new Date(T0.getTime() + minutes(20)),
        duration: minutes(20),
        premium: true,
      },
      {
        from: new Date(T0.getTime() + minutes(20)),
        to: new Date(T0.getTime() + minutes(60)),
        duration: minutes(40),
        premium: false,
      },
    ];
    const result = character.settleRecovery(durationMs(0), segments);
    // 20 minutes at 1:1 plus 40 minutes at 1:2 = 20 + 20 = 40 minutes.
    expect(result.remaining).toBe(minutes(40));
    // The interval was SPLIT, not averaged.
    expect(result.segments.length).toBeGreaterThanOrEqual(2);
    expect(result.segments.some((s) => s.premium)).toBe(true);
    expect(result.segments.some((s) => !s.premium)).toBe(true);
  });

  it('T6: Stamina never exceeds STAMINA_MAX (42:00)', () => {
    expect(STAMINA_MAX).toBe(hours(42));
    const fromEmpty = character.settleRecovery(durationMs(0), premium(hours(100)));
    expect(fromEmpty.remaining).toBe(STAMINA_MAX);

    const alreadyFull = character.settleRecovery(STAMINA_MAX, premium(hours(10)));
    expect(alreadyFull.remaining).toBe(STAMINA_MAX);

    const nearlyFull = character.settleRecovery(
      durationMs(STAMINA_MAX - minutes(1)),
      premium(hours(5)),
    );
    expect(nearlyFull.remaining).toBe(STAMINA_MAX);
  });

  it('T7: Premium recovery settles 1:1; Free settles 1:2', () => {
    const premiumGain = character.settleRecovery(durationMs(0), premium(minutes(60)));
    expect(premiumGain.remaining).toBe(minutes(60));

    const freeGain = character.settleRecovery(durationMs(0), free(minutes(60)));
    expect(freeGain.remaining).toBe(minutes(30));

    // Two free minutes buy one (ACTIVITY_OCCUPANCY_AND_TIMERS.md §3.1).
    expect(character.settleRecovery(durationMs(0), free(minutes(2))).remaining).toBe(minutes(1));
  });

  it('T8: NEUTRAL mode consumes nothing and recovers nothing', () => {
    const before = hours(20);
    expect(character.settleNeutral(before)).toBe(before);

    // Reconnect grace is NEUTRAL, not recovery. Without that, a player could
    // disconnect and reconnect on a cycle to regenerate at resting rate while
    // keeping the Hunt — a regeneration exploit dressed as a network problem.
    expect(
      character.deriveStaminaMode({
        claim: {
          stamina: 'STAMINA_CONSUMING',
          sessionState: 'RECONNECT_GRACE_PAUSED',
          staminaActivatedAt: T0,
        },
      }),
    ).toBe('NEUTRAL');
  });

  it('T9: a timer is never decremented by any scheduled job', () => {
    // remainingAt is a COMPUTED READ: time passing changes what a caller sees
    // without anything having written to the row (§7.3).
    const timer = { remaining: minutes(60), qualifyingSince: T0 };
    const clock = new FakeClock(T0);
    clock.advance(minutes(15));
    expect(remainingAt(timer, clock.now())).toBe(minutes(45));
    // The stored value is untouched. Only settlement writes.
    expect(timer.remaining).toBe(minutes(60));

    clock.advance(hours(100));
    expect(remainingAt(timer, clock.now())).toBe(durationMs(0));
    expect(timer.remaining).toBe(minutes(60));
  });

  it('T11: a backwards clock yields elapsed 0, never negative, and mints nothing', () => {
    const clock = new FakeClock(new Date(T0.getTime() + hours(1)));
    const since = clock.now();

    clock.rewind(hours(2));
    const now = clock.now();
    expect(now.getTime()).toBeLessThan(since.getTime());

    // Rule 1: elapsed is max(0, now - since) — never negative.
    expect(elapsedSince(since, now)).toBe(durationMs(0));

    // Rule 2: the timer STALLS rather than reversing. Nothing is minted, and
    // nothing already settled is restored.
    const timer = { remaining: minutes(30), qualifyingSince: since };
    expect(remainingAt(timer, now)).toBe(minutes(30));

    // Rule 3: a regression beyond tolerance is an OPERATIONAL SIGNAL, not a
    // silent correction. 0B.9 attaches clock_regression_total to this hook.
    const observed: number[] = [];
    const observer = { onRegression: ({ by }: { by: number }) => observed.push(by) };

    const reported = reportRegression(since, now, observer);
    expect(reported).toBe(hours(2));
    expect(observed).toEqual([hours(2)]);

    // Ordinary NTP slew inside the tolerance is not an incident.
    observed.length = 0;
    const slightlyBack = new Date(since.getTime() - 200);
    expect(reportRegression(since, slightlyBack, observer)).toBe(durationMs(200));
    expect(observed).toEqual([]);
    expect(CLOCK_REGRESSION_TOLERANCE).toBe(durationMs(1_000));

    // Rule 4: qualifyingSince is NEVER rewritten to compensate — rewriting it
    // would change history to match a broken clock.
    expect(timer.qualifyingSince).toBe(since);
  });

  it('T12: a descriptor missing its stamina classification fails registry validation', () => {
    // The real registry is valid...
    expect(() => activity.validateRegistry()).not.toThrow();

    // ...and one missing `stamina` is refused, which is the only way
    // "undeclared is rejected" is true in practice. A new activity type cannot
    // be added by forgetting to classify it.
    expect(() =>
      activity.validateRegistry([
        { key: activity.HUNT, family: 'SESSION_BOUND', occupiesCharacter: true },
      ]),
    ).toThrow(/missing its stamina classification/);

    expect(() =>
      activity.validateRegistry([
        {
          key: activity.HUNT,
          family: 'SESSION_BOUND',
          stamina: 'SOMETHING_ELSE' as never,
          occupiesCharacter: true,
        },
      ]),
    ).toThrow(/missing its stamina classification/);

    // Dungeon is deliberately absent: no accepted document classifies it.
    expect(activity.describe('dungeon' as never)).toBeUndefined();
    expect(activity.registrySnapshot()).toEqual([
      ['hunt', 'SESSION_BOUND'],
      ['skill-training', 'WALL_CLOCK'],
    ]);
  });

  it('T13: Knight hunting while the Druid trains — occupied AND recovering', () => {
    const knightBeforeActivation = character.deriveStaminaMode({
      claim: {
        stamina: 'STAMINA_CONSUMING',
        sessionState: 'ONLINE_ACTIVE',
        staminaActivatedAt: null,
      },
    });
    const knightAfterActivation = character.deriveStaminaMode({
      claim: {
        stamina: 'STAMINA_CONSUMING',
        sessionState: 'ONLINE_ACTIVE',
        staminaActivatedAt: T0,
      },
    });
    const druidTraining = character.deriveStaminaMode({
      claim: {
        stamina: 'STAMINA_RECOVERY_ELIGIBLE',
        sessionState: null,
        staminaActivatedAt: null,
      },
    });

    expect(knightBeforeActivation).toBe('NEUTRAL');
    expect(knightAfterActivation).toBe('CONSUMING');
    // OCCUPANCY IS NOT CONSUMPTION: the Druid holds a claim and still recovers.
    expect(druidTraining).toBe('RECOVERING');

    // And a Character with no claim at all recovers.
    expect(character.deriveStaminaMode({ claim: null })).toBe('RECOVERING');
  });

  it('T14: a STAMINA_CONSUMING activity in RECONNECT_GRACE_PAUSED is NEUTRAL', () => {
    expect(
      character.deriveStaminaMode({
        claim: {
          stamina: 'STAMINA_CONSUMING',
          sessionState: 'RECONNECT_GRACE_PAUSED',
          staminaActivatedAt: T0,
        },
      }),
    ).toBe('NEUTRAL');

    // Even before activation it is NEUTRAL, never recovery.
    expect(
      character.deriveStaminaMode({
        claim: {
          stamina: 'STAMINA_CONSUMING',
          sessionState: 'RECONNECT_GRACE_PAUSED',
          staminaActivatedAt: null,
        },
      }),
    ).toBe('NEUTRAL');
  });
});
