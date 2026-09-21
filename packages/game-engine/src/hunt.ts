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

export const TICK_MS = 1000;

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
  readonly attackFactor: number;
  readonly attackIntervalMs: number;
  readonly defense: number;
  readonly armor: number;
  readonly supply: SupplyProfile;
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
}

export interface HuntReward {
  readonly tick: number;
  readonly creatureKey: string;
  readonly experience: number;
  readonly gold: number;
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
  | { readonly tick: number; readonly kind: 'died' };

export interface HuntStep {
  readonly state: HuntState;
  readonly rewards: readonly HuntReward[];
  readonly events: readonly HuntEvent[];
  readonly roomsCleared: number;
  readonly suppliesUsed: number;
  readonly drawsConsumed: number;
}

const msToTicks = (ms: number): number => Math.max(1, Math.round(ms / TICK_MS));

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
  return Math.floor(profile.level / 5);
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

  for (let step = 0; step < ticks && ended === null; step += 1) {
    tick += 1;

    // 1. Spawn the encounter if the room is empty.
    if (creatures.length === 0) {
      const definition = roomFor(plan, room);
      const spawned: { key: string; health: number; nextAttackTick: number }[] = [];
      for (const entry of definition.creatures) {
        const stats = plan.creatures[entry.key];
        if (!stats) throw new RangeError(`Room ${room} names ${entry.key}, which is not resolved.`);
        for (let index = 0; index < entry.count; index += 1) {
          spawned.push({
            key: entry.key,
            health: stats.maxHealth,
            nextAttackTick: tick + msToTicks(stats.attackIntervalMs),
          });
        }
      }
      creatures = spawned;
      events.push({ tick, kind: 'spawn', room, count: spawned.length });
    }

    // 2. The Character acts. Target: the lowest-index living creature (P2-D6).
    if (tick >= characterNextAttackTick) {
      const index = creatures.findIndex((creature) => creature.health > 0);
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
          rewards.push({ tick, creatureKey: target.key, experience: stats.experience, gold });
        }
      }
    }

    // 3. Living creatures act, in index order.
    for (const creature of creatures) {
      if (creature.health <= 0 || tick < creature.nextAttackTick) continue;
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
    state: { tick, room, cycle, health, supplyCharges, creatures, characterNextAttackTick, ended },
    rewards,
    events,
    roomsCleared,
    suppliesUsed,
    drawsConsumed: rng.drawCount - before,
  };
}
