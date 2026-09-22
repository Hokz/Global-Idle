/**
 * The Hunt simulator (Phase 2 spec §2, §3, §4).
 *
 * PURE. No I/O, no clock, no content lookup, no persistence. Time arrives as a
 * number of ticks, randomness is injected and seeded, content arrives already
 * resolved, and the result DESCRIBES change rather than applying it (ADR-010).
 * Stamina, Gold, the ledger, the connection lifecycle and everything durable
 * belong to the domain, which is the only thing that can be told about them.
 *
 * `simulateActivity` in `simulate.ts` is DELIBERATELY UNTOUCHED: Phase 0B's E1
 * and E2 pin it against a committed golden file, and breaking a VERIFIED test
 * to make a new phase pass is not a trade this project makes. This is a second
 * function with its own fixture.
 */
import { normalRandom, uniformRandom } from './distributions.js';
import type { SeededRandom } from './random.js';
import {
  canOccupy,
  connectorAt,
  isAdjacent,
  meleeGoals,
  samePosition,
  stepToward,
  type MapRegion,
  type TileMap,
  type TilePosition,
} from './space.js';

/** The COMBAT tick, unchanged since Phase 2 and pinned by its golden file. */
export const TICK_MS = 1000;

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

/** Default ground speed (`src/creatures/creature.cpp:1817`). */
export const GROUND_SPEED = 150;

/** `WALK_DIAGONAL_EXTRA_COST` (`src/creatures/creature.hpp:45`). */
export const DIAGONAL_STEP_FACTOR = 3;

/**
 * The vocation base speed every Character starts from
 * (`data/XML/vocations.xml`, `basespeed="110"`), used when a profile or a
 * creature does not state one. It is a real number from the source rather than
 * a placeholder, so a missing speed produces a slow actor and never a stalled
 * one.
 */
export const DEFAULT_STEP_SPEED = 110;

const SPEED_A = 857.36;
const SPEED_B = 261.29;
const SPEED_C = -4795.01;

/**
 * How long ONE cardinal step takes, from the source's own arithmetic
 * (`Creature::getStepDuration`, `src/creatures/creature.cpp:1690-1709`):
 *
 *     calculated = floor(857.36 * ln(speed + 261.29) - 4795.01 + 0.5)
 *     duration   = floor(1000 * groundSpeed / calculated)
 *                  rounded UP to a multiple of SERVER_BEAT
 *
 * A level-1 Character (speed 110, the vocation base in `data/XML/vocations.xml`)
 * gets 550 ms; a Rat (speed 67) gets 900 ms. The Character is faster than what
 * is chasing it, which is why an approach is a chase rather than a queue.
 */
export function stepDurationMs(stepSpeed: number, groundSpeed: number = GROUND_SPEED): number {
  const speed = Math.max(1, Math.floor(stepSpeed));
  const calculated = Math.max(1, Math.floor(SPEED_A * Math.log(speed + SPEED_B) + SPEED_C + 0.5));
  const raw = Math.floor((1000 * groundSpeed) / calculated);
  return Math.max(BEAT_MS, Math.ceil(raw / BEAT_MS) * BEAT_MS);
}

export interface CreatureStats {
  readonly key: string;
  readonly maxHealth: number;
  readonly experience: number;
  readonly attackIntervalMs: number;
  readonly maxDamage: number;
  readonly defense: number;
  readonly armor: number;
  /** Percent, as Canary stores it: `damage -= damage * mitigation / 100`. */
  readonly mitigation: number;
  readonly gold: { readonly chance: number; readonly min: number; readonly max: number };
  /** Phase 3.5 — the source's `monster.speed`. Absent means this creature is
   *  never simulated on a map, which is every Phase 2 fixture. */
  readonly stepSpeed?: number;
  /** PHYSICAL loot — Phase 3. Separate from `gold`, which is a currency scope
   *  and never an item. A Rat's whole table is one entry. */
  readonly loot?: readonly {
    readonly itemKey: string;
    readonly chance: number;
    readonly min: number;
    readonly max: number;
  }[];
}

export interface SupplyProfile {
  readonly healMin: number;
  readonly healMax: number;
  /** Drink at or below this percentage of maximum health. */
  readonly useBelowPercent: number;
}

export interface CombatProfile {
  readonly level: number;
  readonly maxHealth: number;
  readonly attackSkill: number;
  /** ALREADY the effective value — the 120% weapon compensation is applied
   *  where the profile is authored, not here (source map §3.3). */
  readonly attackValue: number;
  /**
   * Whether a WEAPON is in the hand.
   *
   * `WeaponMelee::getWeaponDamage` rolls from `level / 5`; `Weapon::useFist`
   * rolls from zero. The two agree below Level 5 and diverge above it, so a
   * Character that took its weapon off must not keep the armed floor.
   */
  readonly armed: boolean;
  readonly attackFactor: number;
  readonly attackIntervalMs: number;
  readonly defense: number;
  readonly armor: number;
  readonly supply: SupplyProfile;
  /** Phase 3.5 — `vocation base speed + (level - 1)`, the source's own
   *  `Player::updateBaseSpeed`. Optional for the same reason as the creature's:
   *  a Hunt with no map never asks. */
  readonly stepSpeed?: number;
}

export interface RoomDefinition {
  readonly number: number;
  readonly creatures: readonly { readonly key: string; readonly count: number }[];
  readonly endless: boolean;
}

export interface RoomPlan {
  readonly rooms: readonly RoomDefinition[];
  readonly creatures: Readonly<Record<string, CreatureStats>>;
}

export interface HuntCreatureState {
  readonly key: string;
  readonly health: number;
  readonly nextAttackTick: number;
  /**
   * Phase 3.5 — spatial fields, present only when the Hunt has a map.
   *
   * They are OPTIONAL because Phase 2's golden fixture pins this state's exact
   * JSON, and `undefined` does not serialize. A Hunt with no map produces
   * byte-for-byte what it produced before space existed, which is how the
   * VERIFIED combat kernel stays verified.
   */
  readonly id?: string;
  /** The tile it IS on. Never a fraction, never the destination of a step in
   *  flight. */
  readonly position?: TilePosition;
  readonly movement?: Movement;
}

/**
 * A step IN FLIGHT, on the simulation's own millisecond timeline.
 *
 * This is one authoritative state, not a server hint plus a client guess. An
 * actor with an `activeMovement` is STILL STANDING on `from` — it cannot
 * attack from `to`, cannot be attacked at `to`, and does not occupy `to` — but
 * `to` is RESERVED, so nothing else may claim it. On `arrivesAtMs` the actor
 * commits to `to` and the reservation ends.
 *
 * The browser interpolates between `from` and `to` using these two instants
 * and the simulation time the snapshot was taken at. It invents no duration of
 * its own, which is what makes the picture a view of the server's state rather
 * than a second opinion about it.
 */
export interface Movement {
  readonly from: TilePosition;
  readonly to: TilePosition;
  readonly startsAtMs: number;
  readonly arrivesAtMs: number;
}

/** The map and the room→region mapping a spatial Hunt simulates over. */
export interface SpatialPlan {
  readonly map: TileMap;
  /** Region for a room number, falling back to the endless room's region. */
  readonly regionFor: (room: number) => MapRegion;
}

export type HuntEndReason = 'DIED';

export interface HuntState {
  readonly tick: number;
  readonly room: number;
  /** Completed clears of the endless room. */
  readonly cycle: number;
  readonly health: number;
  readonly supplyCharges: number;
  readonly creatures: readonly HuntCreatureState[];
  readonly characterNextAttackTick: number;
  readonly ended: HuntEndReason | null;
  /** Phase 3.5 — present only when the Hunt has a map. */
  readonly position?: TilePosition;
  readonly movement?: Movement;
}

export interface HuntReward {
  readonly tick: number;
  readonly creatureKey: string;
  readonly experience: number;
  readonly gold: number;
  /** Phase 3 — what physically dropped. The DOMAIN decides what is collected;
   *  the engine only says what fell, because policy, space and Capacity are
   *  durable state a pure function must never see. */
  readonly loot: readonly { readonly itemKey: string; readonly quantity: number }[];
}

export type HuntEvent =
  | { readonly tick: number; readonly kind: 'spawn'; readonly room: number; readonly count: number }
  | {
      readonly tick: number;
      readonly kind: 'hit';
      readonly target: string;
      readonly damage: number;
    }
  | {
      readonly tick: number;
      readonly kind: 'taken';
      readonly source: string;
      readonly damage: number;
    }
  | { readonly tick: number; readonly kind: 'kill'; readonly target: string }
  | {
      /** Phase 3 — a physical item was collected into the Loot Pouch. */
      readonly tick: number;
      readonly kind: 'loot';
      readonly item: string;
      readonly quantity: number;
    }
  | {
      /**
       * Phase 3 — something dropped and was NOT collected, with the reason.
       *
       * A skipped drop is not an error and never stops the Hunt; it is
       * information the player needs in order to fix it, which is why it has
       * an event rather than a silence.
       */
      readonly tick: number;
      readonly kind: 'loot-skipped';
      readonly item: string;
      readonly reason: 'policy' | 'no-space' | 'over-capacity';
    }
  | {
      readonly tick: number;
      readonly kind: 'room-cleared';
      readonly room: number;
      readonly cycle: number;
    }
  | {
      readonly tick: number;
      readonly kind: 'supply';
      readonly healed: number;
      readonly remaining: number;
    }
  | { readonly tick: number; readonly kind: 'died' }
  | {
      /**
       * Phase 3.5 — an actor STARTED a step, with the timing the server will
       * hold it to. Not "has moved": the actor is still on `from` until
       * `arrivesAtMs`.
       */
      readonly tick: number;
      readonly kind: 'move';
      readonly actor: string;
      readonly from: TilePosition;
      readonly to: TilePosition;
      readonly startsAtMs: number;
      readonly arrivesAtMs: number;
    };

export interface HuntStep {
  readonly state: HuntState;
  readonly rewards: readonly HuntReward[];
  readonly events: readonly HuntEvent[];
  readonly roomsCleared: number;
  readonly suppliesUsed: number;
  readonly drawsConsumed: number;
}

const msToTicks = (ms: number): number => Math.max(1, Math.round(ms / TICK_MS));

/** The actor id the Character moves under, in events and in occupancy. */
export const CHARACTER_ACTOR = 'character';
const CHARACTER = CHARACTER_ACTOR;

/** The room a run is in, or the endless one once past the end of the plan. */
function roomFor(plan: RoomPlan, room: number): RoomDefinition {
  const found = plan.rooms.find((candidate) => candidate.number === room);
  if (found) return found;
  const endless = plan.rooms.find((candidate) => candidate.endless);
  if (!endless) throw new RangeError(`No room ${room} and no endless room in the plan.`);
  return endless;
}

/** The first room of a run. */
export function initialState(profile: CombatProfile, plan: RoomPlan, charges: number): HuntState {
  const first = plan.rooms[0];
  if (!first) throw new RangeError('A room plan needs at least one room.');
  return {
    tick: 0,
    room: first.number,
    cycle: 0,
    health: profile.maxHealth,
    supplyCharges: charges,
    creatures: [],
    characterNextAttackTick: 0,
    ended: null,
  };
}

/**
 * `Creature::blockHit` (source map §3.6), in order: defence, then armour, then
 * mitigation, each clamping at zero and stopping.
 *
 * DRAWS: one for defence when there is any, one for armour only when
 * `armor > 3` AND the damage survived defence. Outcome-dependent and therefore
 * deterministic for a given state, which is what replay needs.
 */
function applyReduction(
  rng: SeededRandom,
  damage: number,
  defense: number,
  armor: number,
  mitigationPercent: number,
): number {
  let value = damage;
  if (defense > 0) {
    value -= uniformRandom(rng, Math.floor(defense / 2), defense);
    if (value <= 0) return 0;
  }
  if (armor > 3) value -= uniformRandom(rng, Math.floor(armor / 2), armor - ((armor % 2) + 1));
  else if (armor > 0) value -= 1;
  if (value <= 0) return 0;
  value -= (value * mitigationPercent) / 100;
  return Math.max(0, Math.floor(value));
}

/** `Weapons::getMaxWeaponDamage` for melee (source map §3.1). */
export function maxMeleeHit(profile: CombatProfile): number {
  return profile.attackValue > 0
    ? Math.round(
        0.085 * profile.attackFactor * profile.attackValue * profile.attackSkill +
          Math.floor(profile.level / 5),
      )
    : 0;
}

/**
 * The FLOOR of an armed melee roll, `WeaponMelee::getWeaponDamage` (source map
 * §3.1): `normal_random(minDamage, maxDamage)` with `minDamage = level / 5`,
 * integer division.
 *
 * It is zero for the first four levels, which is why the unarmed shape
 * (`normal_random(0, max)`) and the armed one agree at Level 1 and diverge
 * from Level 5. The tutorial profile is ARMED, so this is the one that
 * applies; using zero past level 5 would quietly make a levelling Character
 * weaker than the baseline says it is.
 */
export function minMeleeHit(profile: CombatProfile): number {
  return profile.armed ? Math.floor(profile.level / 5) : 0;
}

/**
 * Advance a run by `ticks` ticks.
 *
 * TICK ORDER is part of the contract (spec §2.4): spawn, Character acts,
 * creatures act in index order, death check, supply, room clear. The supply
 * check comes AFTER the death check on purpose — a potion cannot save a
 * Character that is already dead, which is both Tibia's behaviour and the only
 * reading that does not make a charge worth more than it is.
 */
export function simulateHunt(
  state: HuntState,
  profile: CombatProfile,
  plan: RoomPlan,
  ticks: number,
  rng: SeededRandom,
  /**
   * A SECOND stream, for physical loot only (Phase 3).
   *
   * Deliberately separate rather than more draws from `rng`. Phase 2 is
   * `VERIFIED` against a golden fixture that pins its exact draw sequence, and
   * interleaving loot rolls into the fight would change every subsequent hit
   * for a reason that has nothing to do with combat. Two streams keep the
   * fight identical AND make loot a pure function of the persisted position —
   * both properties, instead of trading one for the other.
   *
   * Omitted, nothing drops, which is what every Phase 2 case expects.
   */
  lootRng?: SeededRandom,
  /**
   * Phase 3.5 — SPACE.
   *
   * Omitted, this function is exactly what Phase 2 verified: the same branches,
   * the same draws, the same golden file. Present, an attack additionally
   * requires the attacker to be standing next to its target, and an actor that
   * is not spends its tick walking. No new randomness: pathing is a
   * deterministic rule, so a reload recomputes the same future.
   */
  space?: SpatialPlan,
): HuntStep {
  const before = rng.drawCount;
  const rewards: HuntReward[] = [];
  const events: HuntEvent[] = [];
  let roomsCleared = 0;
  let suppliesUsed = 0;

  let { tick, room, cycle, health, supplyCharges, characterNextAttackTick } = state;
  let creatures = state.creatures.map((creature) => ({ ...creature }));
  let ended = state.ended;

  const maxHit = maxMeleeHit(profile);
  const minHit = minMeleeHit(profile);
  const supplyThreshold = (profile.maxHealth * profile.supply.useBelowPercent) / 100;

  // ── space ────────────────────────────────────────────────────────────────
  //
  // One authoritative movement state. An actor is on `position`; if it has an
  // `activeMovement` it is still on `position` and will be on `movement.to`
  // at `arrivesAtMs`, and nothing else may take that tile in the meantime.
  let position = state.position ?? space?.map.entry;
  let movement: Movement | undefined = state.movement;

  /** Absolute simulation time. Ticks are the combat grid laid over it. */
  let nowMs = tick * TICK_MS;

  /** Tiles no one else may enter: every living actor's tile, plus every tile a
   *  living actor has already committed to stepping onto. */
  const occupied = (exclude?: string): ((at: TilePosition) => boolean) => {
    const taken: TilePosition[] = [];
    if (exclude !== CHARACTER) {
      if (position) taken.push(position);
      if (movement) taken.push(movement.to);
    }
    for (const creature of creatures) {
      if (creature.health <= 0) continue;
      if (creature.id !== undefined && creature.id === exclude) continue;
      if (creature.position) taken.push(creature.position);
      if (creature.movement) taken.push(creature.movement.to);
    }
    return (at: TilePosition) => taken.some((tile) => samePosition(tile, at));
  };

  /** What one step costs this actor, in milliseconds. Diagonals cost three
   *  times a cardinal, which is the source's `WALK_DIAGONAL_EXTRA_COST`. */
  const durationFor = (speed: number, from: TilePosition, to: TilePosition): number => {
    const base = stepDurationMs(speed);
    const diagonal = from.x !== to.x && from.y !== to.y;
    return diagonal ? base * DIAGONAL_STEP_FACTOR : base;
  };

  /**
   * Begin a step toward `target`, or nothing.
   *
   * Nothing moves here. What is decided is which tile the actor has committed
   * to and when it will arrive; the arrival is applied by `arrive`.
   */
  const departFor = (
    actor: string,
    speed: number,
    from: TilePosition,
    target: TilePosition,
  ): Movement | null => {
    if (!space) return null;
    const blocked = occupied(actor);
    const goals = meleeGoals(space.map, target, blocked);
    const next = stepToward(space.map, from, goals, blocked);
    if (!next || !canOccupy(space.map, next)) return null;
    const started: Movement = {
      from,
      to: next,
      startsAtMs: nowMs,
      arrivesAtMs: nowMs + durationFor(speed, from, next),
    };
    events.push({
      tick: Math.floor(nowMs / TICK_MS),
      kind: 'move',
      actor,
      from,
      to: next,
      startsAtMs: started.startsAtMs,
      arrivesAtMs: started.arrivesAtMs,
    });
    return started;
  };

  /** A step that has run its time COMMITS, and a connector under the arrival
   *  tile takes the actor to the floor it leads to (spec §6). */
  const arrive = (at: Movement): TilePosition => {
    if (!space) return at.to;
    const link = connectorAt(space.map, at.to);
    return link ? { ...link.to } : at.to;
  };

  /**
   * One beat of movement, for every actor, in a fixed order.
   *
   * ARRIVALS first and then DEPARTURES, both in the same order: the Character,
   * then creatures by index. That order is the arbitration — the second actor
   * to decide sees the first one's reservation already standing — and it is
   * inside one deterministic function, which is why it is an array index and
   * not a database lock.
   */
  const moveBeat = (): void => {
    if (!space) return;

    if (movement && nowMs >= movement.arrivesAtMs) {
      position = arrive(movement);
      movement = undefined;
    }
    for (let index = 0; index < creatures.length; index += 1) {
      const creature = creatures[index]!;
      if (!creature.movement || nowMs < creature.movement.arrivesAtMs) continue;
      const { movement: _done, ...rest } = creature;
      creatures[index] = { ...rest, position: arrive(creature.movement) };
    }

    if (position && !movement) {
      // The Character fights what is IN REACH and walks toward the first
      // creature it can take a step toward. Reach chooses the candidates;
      // index order still chooses between them (P2-D6, narrowed).
      const engaged = creatures.some(
        (creature) =>
          creature.health > 0 && creature.position && isAdjacent(position!, creature.position),
      );
      if (!engaged) {
        for (const enemy of creatures) {
          if (enemy.health <= 0 || !enemy.position) continue;
          const started = departFor(
            CHARACTER,
            profile.stepSpeed ?? DEFAULT_STEP_SPEED,
            position,
            enemy.position,
          );
          if (!started) continue;
          movement = started;
          break;
        }
      }
    }

    if (!position) return;
    for (let index = 0; index < creatures.length; index += 1) {
      const creature = creatures[index]!;
      if (creature.health <= 0 || !creature.position || !creature.id || creature.movement) continue;
      if (isAdjacent(creature.position, position)) continue;
      const stats = plan.creatures[creature.key];
      const started = departFor(
        creature.id,
        stats?.stepSpeed ?? DEFAULT_STEP_SPEED,
        creature.position,
        position,
      );
      if (started) creatures[index] = { ...creature, movement: started };
    }
  };

  // A Hunt with no map beats once per tick, which is the loop Phase 2 has
  // always run: same iterations, same order, same draws, same golden file.
  const beat = space ? BEAT_MS : TICK_MS;
  const endMs = nowMs + ticks * TICK_MS;

  while (nowMs < endMs && ended === null) {
    nowMs += beat;
    moveBeat();
    if (nowMs % TICK_MS !== 0) continue;
    tick += 1;

    // 1. Spawn the encounter if the room is empty.
    if (creatures.length === 0) {
      const definition = roomFor(plan, room);
      const region = space?.regionFor(room);
      const spawned: HuntCreatureState[] = [];
      let slot = 0;
      for (const entry of definition.creatures) {
        const stats = plan.creatures[entry.key];
        if (!stats) throw new RangeError(`Room ${room} names ${entry.key}, which is not resolved.`);
        for (let index = 0; index < entry.count; index += 1) {
          // A deterministic, run-local identity. It survives persistence and
          // reload because it is derived from WHERE and WHICH, never from a
          // counter that a restart would lose. Not a durable database row:
          // this actor exists only inside this run.
          const id = region ? `${entry.key}:${region.id}:c${cycle}:s${slot}` : undefined;
          const position = region ? region.spawns[slot % region.spawns.length] : undefined;
          spawned.push({
            key: entry.key,
            health: stats.maxHealth,
            nextAttackTick: tick + msToTicks(stats.attackIntervalMs),
            ...(id === undefined ? {} : { id }),
            ...(position === undefined ? {} : { position }),
          });
          slot += 1;
        }
      }
      creatures = spawned;
      events.push({ tick, kind: 'spawn', room, count: spawned.length });
    }

    // 2. The Character acts. Target: the lowest-index living creature (P2-D6).
    //
    // WHAT SPACE CHANGES is the candidate set, never the arbitration. Index
    // order still decides which of several creatures is hit; it no longer
    // decides which one is *considered*. A Character fixated on the lowest
    // index regardless of reach stands still forever the moment that creature
    // is unreachable — one rat in a one-tile doorway is enough — while the two
    // biting it go unanswered. Reach first, then index.
    //
    // Reach is measured from the tile the actor IS on. An actor with a step in
    // flight has not arrived, so it cannot swing from where it is going.
    const engaged = space
      ? creatures.findIndex(
          (creature) =>
            creature.health > 0 &&
            !!creature.position &&
            !!position &&
            isAdjacent(position, creature.position),
        )
      : creatures.findIndex((creature) => creature.health > 0);

    if (tick >= characterNextAttackTick) {
      const index = engaged;
      if (index >= 0) {
        const target = creatures[index]!;
        const stats = plan.creatures[target.key]!;
        const damage = applyReduction(
          rng,
          normalRandom(rng, minHit, maxHit),
          stats.defense,
          stats.armor,
          stats.mitigation,
        );
        target.health -= damage;
        events.push({ tick, kind: 'hit', target: target.key, damage });
        characterNextAttackTick = tick + msToTicks(profile.attackIntervalMs);

        if (target.health <= 0) {
          events.push({ tick, kind: 'kill', target: target.key });
          const gold =
            stats.gold.chance >= 1 || rng.next() < stats.gold.chance
              ? uniformRandom(rng, stats.gold.min, stats.gold.max)
              : 0;
          // Entries are rolled in AUTHORED ORDER with a FIXED draw count each —
          // one for the chance unless it is certain, and one for the quantity
          // unless min equals max — so whether a drop happened never changes
          // how many numbers the next entry consumes.
          const loot: { itemKey: string; quantity: number }[] = [];
          if (lootRng) {
            for (const entry of stats.loot ?? []) {
              const dropped = entry.chance >= 1 || lootRng.next() < entry.chance;
              const quantity =
                entry.min === entry.max ? entry.min : uniformRandom(lootRng, entry.min, entry.max);
              if (dropped) loot.push({ itemKey: entry.itemKey, quantity });
            }
          }
          rewards.push({
            tick,
            creatureKey: target.key,
            experience: stats.experience,
            gold,
            loot,
          });
        }
      }
    }

    // 3. Living creatures act, in index order. Their MOVEMENT was decided on
    //    the beat; what is left here is whether they can reach and swing.
    for (const creature of creatures) {
      if (creature.health <= 0 || tick < creature.nextAttackTick) continue;
      if (space && (!creature.position || !position || !isAdjacent(creature.position, position))) {
        continue;
      }
      const stats = plan.creatures[creature.key]!;
      const damage = applyReduction(
        rng,
        normalRandom(rng, 0, stats.maxDamage),
        profile.defense,
        profile.armor,
        0,
      );
      health -= damage;
      creature.nextAttackTick = tick + msToTicks(stats.attackIntervalMs);
      events.push({ tick, kind: 'taken', source: creature.key, damage });
    }

    // 4. Death.
    if (health <= 0) {
      health = 0;
      ended = 'DIED';
      events.push({ tick, kind: 'died' });
      break;
    }

    // 5. Supplies.
    if (health <= supplyThreshold && supplyCharges > 0) {
      const healed = uniformRandom(rng, profile.supply.healMin, profile.supply.healMax);
      health = Math.min(profile.maxHealth, health + healed);
      supplyCharges -= 1;
      suppliesUsed += 1;
      events.push({ tick, kind: 'supply', healed, remaining: supplyCharges });
    }

    // 6. Room clear.
    if (creatures.length > 0 && creatures.every((creature) => creature.health <= 0)) {
      const definition = roomFor(plan, room);
      creatures = [];
      roomsCleared += 1;
      if (definition.endless) cycle += 1;
      else room += 1;
      events.push({ tick, kind: 'room-cleared', room: definition.number, cycle });
    }
  }

  return {
    state: {
      tick,
      room,
      cycle,
      health,
      supplyCharges,
      creatures,
      characterNextAttackTick,
      ended,
      ...(position === undefined ? {} : { position }),
      ...(movement === undefined ? {} : { movement }),
    },
    rewards,
    events,
    roomsCleared,
    suppliesUsed,
    drawsConsumed: rng.drawCount - before,
  };
}
