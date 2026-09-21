/**
 * The engine's SHAPE (§9.1), with a trivial pure body (§9.3).
 *
 * Phase 0B does not implement Hunt simulation. What it establishes is the
 * boundary: state in, already-resolved content in, elapsed time in as a
 * PARAMETER, a seeded generator in, and a result out that DESCRIBES change
 * and applies nothing.
 *
 * THERE IS NO GAMEPLAY HERE ON PURPOSE. No damage formula, no loot table, no
 * balance number, no XP curve. Inventing one would be a Phase 2 decision
 * smuggled into Phase 0B (§19). The draw recorded per participant has no
 * meaning attached to it; it exists to prove the generator is threaded through
 * in a fixed order.
 */
import type { SeededRandom } from './random.js';

export interface ActivityRunState {
  readonly activityId: string;
  /** Ticks already simulated. The engine reads it and returns the next value;
   *  it never writes it anywhere. */
  readonly tick: number;
}

export interface ParticipantProfile {
  readonly characterId: string;
  readonly vocation: string;
}

/** Content ARRIVES RESOLVED (§9.2). The engine never looks a key up, because
 *  it has no way to: there is no resolver here and no I/O to reach one. */
export interface ResolvedContentSlice {
  readonly version: string;
  readonly keys: readonly string[];
}

export interface ParticipantOutcome {
  readonly characterId: string;
  /** A raw uniform draw. Deliberately UNINTERPRETED — see the module comment. */
  readonly rngDraw: number;
}

export interface SimulationResult {
  readonly activityId: string;
  readonly tick: number;
  readonly elapsedMs: number;
  readonly contentVersion: string;
  readonly participants: readonly ParticipantOutcome[];
  /** How many draws this call consumed. A replay that consumes a different
   *  number has diverged, and the fixture says so immediately. */
  readonly drawsConsumed: number;
}

/**
 * DRAW ORDERING: exactly one draw per participant, in the order the party is
 * given. The party order is the Active Party's ordered configuration
 * (ADR-005), so the same run replays identically only if that order is
 * preserved — which is why it is an ordered array rather than a set.
 */
export function simulateActivity(
  state: ActivityRunState,
  party: readonly ParticipantProfile[],
  content: ResolvedContentSlice,
  elapsedMs: number,
  rng: SeededRandom,
): SimulationResult {
  const before = rng.drawCount;
  const participants = party.map((participant) => ({
    characterId: participant.characterId,
    rngDraw: rng.next(),
  }));

  return {
    activityId: state.activityId,
    // Whole seconds only: a result that depends on sub-millisecond timing is
    // not reproducible, and elapsed time arrives as a parameter precisely so
    // that it can be replayed.
    tick: state.tick + Math.floor(elapsedMs / 1000),
    elapsedMs,
    contentVersion: content.version,
    participants,
    drawsConsumed: rng.drawCount - before,
  };
}
