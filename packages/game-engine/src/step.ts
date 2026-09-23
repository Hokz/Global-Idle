/**
 * What one step costs, and the domain in which that answer is the source's.
 *
 * PURE, and a leaf: nothing here imports anything. `space.ts` compiles maps
 * against this and `hunt.ts` times movement with it, so the arithmetic and the
 * limits it is valid inside live in ONE module that neither of them owns.
 *
 * Every rule here that claims to come from the source engine is cited in
 * `docs/specs/phase-3-6/PHASE_3_6_CANARY_MOVEMENT_FIDELITY_SOURCE_MAP.md`.
 */

/**
 * `SERVER_BEAT` (`src/game/game.hpp:64`) — 50 ms, and the resolution movement
 * is decided at.
 *
 * A combat tick is a second; a step is not. Iterating the settlement in beats
 * and resolving combat only on the tick boundaries gives movement real timing
 * WITHOUT a second clock and without moving a single Phase 2 draw: a Hunt with
 * no map iterates whole ticks exactly as it always did.
 */
export const BEAT_MS = 50;

/** `WALK_DIAGONAL_EXTRA_COST` (`src/creatures/creature.hpp:45`). */
export const DIAGONAL_STEP_FACTOR = 3;

/**
 * The default ground speed, hard-coded in the source before anything is looked
 * up (`Creature::setParent`, `src/creatures/creature.cpp:1817`).
 *
 * A tile that authors nothing uses this, which is also the most common
 * authored value in the real client data — 1,097 of the appearances at the
 * pinned commit carry exactly 150.
 */
export const DEFAULT_GROUND_SPEED = 150;

/**
 * What a ground speed can BE, not what an actor can walk.
 *
 * `iType.speed` (`src/items/items.cpp:230`) and the `walk.groundSpeed` cache it
 * feeds (`src/creatures/creature.hpp:1077`) are both `uint16_t`, so this is the
 * whole of what the source can store about a ground. It is a REPRESENTATION
 * bound and nothing more: a ground speed inside it can still be one no actor
 * can walk, which is `MAX_STEP_DURATION_MS` below and is checked separately.
 */
export const MAX_GROUND_SPEED = 65535;

/**
 * What a step DURATION can be — the ceiling this whole module exists to state.
 *
 * `Creature::getStepDuration` (`src/creatures/creature.cpp:1690-1710`) narrows
 * to `uint16_t` in TWO places, and both were verified at the pinned commit
 * rather than assumed:
 *
 *  1. the cached CARDINAL duration —
 *     `walk.duration = static_cast<uint16_t>(std::ceil(duration / SERVER_BEAT) * SERVER_BEAT)`,
 *     where the operand is a `double` and `walk.duration` is a `uint16_t`
 *     (`creature.hpp:1079`). A `double` outside the destination's range is
 *     UNDEFINED BEHAVIOUR in C++ ([conv.fpint]), not a wrap with a value;
 *  2. the RETURNED duration — `auto duration = walk.duration` deduces
 *     `uint16_t`, so `duration *= WALK_DIAGONAL_EXTRA_COST` (and the
 *     `WALK_TARGET_NEARBY_EXTRA_COST` branch beside it) narrows the product
 *     back into 16 bits, which for an unsigned type is a defined MODULAR WRAP.
 *     The function's return type is `uint16_t` as well.
 *
 * So the boundary is not "the cached value only", which is the tempting
 * reading: a cardinal duration that fits perfectly can still have its diagonal
 * wrap, and it does so QUIETLY — 21,850 ms cardinal returns 14 ms diagonal.
 *
 * Both regions are reachable from real content at the pinned commit. The
 * largest authored ground speed is 1,200 (`bank.waypoints`, §3.1 of the source
 * map) and the slowest non-zero authored monster speed is 15: that pair gives
 * a 48,000 ms cardinal — representable — whose diagonal wraps from 144,000 to
 * 12,928, a diagonal FASTER than the cardinal it triples. A player clamped to
 * `PLAYER_MIN_SPEED` on the same ground reaches the undefined cast outright.
 *
 * Global Idle reproduces NEITHER. Copying undefined behaviour is not fidelity,
 * copying a modular wrap is not fidelity either, and silently clamping would
 * be a made-up number wearing the source's clothes. Outside this ceiling the
 * engine REFUSES — see `stepDurationMs`.
 */
export const MAX_STEP_DURATION_MS = 65535;

/**
 * The vocation base speed every Character starts from
 * (`data/XML/vocations.xml`, `basespeed="110"`), used when a profile or a
 * creature does not state one. It is a real number from the source rather than
 * a placeholder, so a missing speed produces a slow actor and never a stalled
 * one.
 */
export const DEFAULT_STEP_SPEED = 110;

/**
 * The floor the source clamps an ordinary PLAYER's step speed to
 * (`PLAYER_MIN_SPEED`, `src/creatures/players/player.hpp:126`, applied in
 * `Player::getStepSpeed`).
 *
 * It is why a Character can never reach the "step speed <= 0, do not walk"
 * branch a monster can (`Creature::addEventWalk`, `creature.cpp:345`): the
 * source clamps players and leaves creatures alone, and so does this.
 */
export const PLAYER_MIN_STEP_SPEED = 10;

/**
 * The ceiling the source clamps an ordinary PLAYER's step speed to
 * (`PLAYER_MAX_SPEED`, `src/creatures/players/player.hpp:124`), which is the
 * `uint16_t` maximum because `Player::baseSpeed` is one.
 */
export const PLAYER_MAX_STEP_SPEED = 65535;

/**
 * A Character's own step speed, before any effect touches it.
 *
 * `Player::updateBaseSpeed` (`src/creatures/players/player.cpp:7338-7346`):
 *
 *     computedSpeed = vocation->getBaseSpeed() + (level - 1)
 *
 * Every vocation Global Idle has — and the unvocationed Character — carries
 * `basespeed="110"` in `data/XML/vocations.xml`, promoted included, so the
 * vocation is a PARAMETER here and not a table: there is currently nothing for
 * a table to say. Phase 4 can pass a different base without this function
 * changing shape.
 *
 * `varSpeed` — haste, paralyze, boots, mounts — is deliberately absent. When
 * it arrives it is one more term, added before the clamp, exactly as the
 * source does it.
 */
export function playerBaseStepSpeed(level: number, vocationBaseSpeed = DEFAULT_STEP_SPEED): number {
  const computed = vocationBaseSpeed + Math.max(0, Math.floor(level) - 1);
  return Math.max(PLAYER_MIN_STEP_SPEED, Math.min(PLAYER_MAX_STEP_SPEED, computed));
}

/**
 * The slowest Character this game can produce: level 1, at the vocation base.
 *
 * DERIVED, never asserted — no Phase 3.6 effect can take a Character below it,
 * because `playerBaseStepSpeed` only ever adds level to the base and then
 * clamps up to `PLAYER_MIN_STEP_SPEED`. It is the yardstick `compileMap` holds
 * authored ground against: ground an actor this slow cannot walk is ground
 * nobody can.
 */
export const SLOWEST_CHARACTER_STEP_SPEED = playerBaseStepSpeed(1);

const SPEED_A = 857.36;
const SPEED_B = 261.29;
const SPEED_C = -4795.01;

/**
 * The log curve, exactly as `Creature::updateCalculatedStepSpeed` writes it
 * (`src/creatures/creature.hpp:1089-1097`):
 *
 *     calculatedStepSpeed = 1
 *     if (stepSpeed > -speedB)
 *         calculatedStepSpeed = max(floor(speedA × ln(stepSpeed + speedB) + speedC + .5), 1.)
 *
 * Both guards are the source's and both are observable. The `> -speedB` branch
 * keeps the logarithm off a non-positive argument; the `max(…, 1.)` floor
 * keeps the DIVISOR at one, which is the only thing it protects. It says
 * nothing about how long the resulting step is — see `stepDurationMs`.
 *
 * It cannot overflow its own `uint16_t`: the largest step speed the source can
 * hold is 65,535 and the curve answers 4,717 there.
 */
export function calculatedStepSpeed(stepSpeed: number): number {
  const speed = Math.floor(stepSpeed);
  if (!(speed > -SPEED_B)) return 1;
  return Math.max(1, Math.floor(SPEED_A * Math.log(speed + SPEED_B) + SPEED_C + 0.5));
}

/** Refused: the source could not have represented this step. */
export class StepDurationError extends Error {
  override readonly name = 'StepDurationError';
  readonly stepSpeed: number;
  readonly groundSpeed: number;
  readonly stepCost: number;
  /** What the arithmetic produced, before anything narrowed it. */
  readonly durationMs: number;

  constructor(
    message: string,
    detail: { stepSpeed: number; groundSpeed: number; stepCost: number; durationMs: number },
  ) {
    super(message);
    this.stepSpeed = detail.stepSpeed;
    this.groundSpeed = detail.groundSpeed;
    this.stepCost = detail.stepCost;
    this.durationMs = detail.durationMs;
  }
}

/**
 * How long ONE step takes, or `null` where the source could not have said.
 *
 * The arithmetic is `Creature::getStepDuration`
 * (`src/creatures/creature.cpp:1690-1710`) in its own order, and the order is
 * the contract:
 *
 *     calculated = floor(857.36 × ln(speed + 261.29) − 4795.01 + 0.5)
 *     cardinal   = floor(1000 × groundSpeed / calculated) rounded UP to a beat
 *     duration   = cardinal × stepCost
 *
 * `stepCost` is the source's own extra-cost multiplier applied to the CACHED
 * cardinal: 1 for a plain step, `WALK_DIAGONAL_EXTRA_COST` (3) for a diagonal,
 * and `WALK_TARGET_NEARBY_EXTRA_COST` (2) the day that branch is imported. It
 * belongs inside this function because the source narrows the product as well
 * as the cardinal, so the two limits are one question asked twice and a caller
 * that multiplied afterwards could not be checked. It is floored at a whole 1,
 * because the source's costs are integer constants and a cost below one is not
 * a step made cheaper — it is a caller mistake, and rounding it up keeps that
 * mistake from shortening a leg.
 *
 * A level-1 Character (speed 110, the vocation base in `data/XML/vocations.xml`)
 * gets 550 ms; a Rat (speed 67) gets 900 ms. The Character is faster than what
 * is chasing it, which is why an approach is a chase rather than a queue.
 *
 * TWO deliberate departures from the source, both at the edges and both
 * documented as ADAPT in the source map:
 *
 *  - the beat floor. Where `floor(1000 × groundSpeed / calculated)` rounds to
 *    zero the source stores `walk.duration = 0`, which makes `needRecache()`
 *    permanently true and `getEventStepTicks` return 0, and `addEventWalk`
 *    then declines to schedule anything at all: the creature stops walking for
 *    good. That is a degenerate state, not a speed. One beat is the shortest
 *    step this engine will issue;
 *  - the ceiling. Above `MAX_STEP_DURATION_MS` the source is undefined or
 *    wraps, so the answer here is `null` rather than a number.
 */
export function supportedStepDurationMs(
  stepSpeed: number,
  groundSpeed: number = DEFAULT_GROUND_SPEED,
  stepCost = 1,
): number | null {
  const step = stepArithmetic(stepSpeed, groundSpeed, stepCost);
  // The cached cardinal is narrowed FIRST (the `static_cast<uint16_t>`), and
  // the multiplied result is narrowed again on return. Both are the ceiling.
  return step.cardinal > MAX_STEP_DURATION_MS || step.duration > MAX_STEP_DURATION_MS
    ? null
    : step.duration;
}

/** The source's arithmetic, done ONCE, before anything decides what to do. */
function stepArithmetic(
  stepSpeed: number,
  groundSpeed: number,
  stepCost: number,
): { cardinal: number; cost: number; duration: number } {
  const raw = Math.floor((1000 * groundSpeed) / calculatedStepSpeed(stepSpeed));
  const cardinal = Math.max(BEAT_MS, Math.ceil(raw / BEAT_MS) * BEAT_MS);
  const cost = Math.max(1, Math.floor(stepCost));
  return { cardinal, cost, duration: cardinal * cost };
}

/**
 * How long ONE step takes, refusing rather than inventing.
 *
 * Outside the supported domain this THROWS. It does not clamp to the ceiling,
 * because a clamp is a number the source never produced; it does not wrap
 * modulo 65,536, because copying a C++ narrowing is not fidelity when the
 * source reaches it through undefined behaviour on one path and a silent
 * defect on the other. A caller that wants the question asked without the
 * refusal has `supportedStepDurationMs`.
 *
 * Reaching this is a CONTENT fault, and the message says which two numbers
 * caused it so the author can fix the pair rather than guess.
 */
export function stepDurationMs(
  stepSpeed: number,
  groundSpeed: number = DEFAULT_GROUND_SPEED,
  stepCost = 1,
): number {
  const supported = supportedStepDurationMs(stepSpeed, groundSpeed, stepCost);
  if (supported !== null) return supported;
  const { cardinal, cost, duration } = stepArithmetic(stepSpeed, groundSpeed, stepCost);
  const reason =
    cardinal > MAX_STEP_DURATION_MS
      ? `its ${cardinal} ms cardinal step`
      : `its ${duration} ms step (${cardinal} ms × ${cost})`;
  throw new StepDurationError(
    `step speed ${stepSpeed} on ground speed ${groundSpeed} is outside the supported movement ` +
      `domain: ${reason} is beyond the ${MAX_STEP_DURATION_MS} ms the source can represent, ` +
      `where it is undefined or wraps. Use a faster actor or a lower ground speed.`,
    { stepSpeed, groundSpeed, stepCost: cost, durationMs: duration },
  );
}
