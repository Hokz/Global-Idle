/**
 * Resolved content + what the Character is WEARING → the engine's inputs
 * (Phase 3 spec §6.3).
 *
 * The engine never looks a key up; it has no resolver and no I/O. This is
 * where a bundle becomes a `RoomPlan`, and where equipment becomes a
 * `CombatProfile` — once, with every reference checked.
 *
 * Phase 2 authored that profile as content, because it had no items. Phase 3
 * has items, so the profile is COMPUTED: armour is the sum of what is worn,
 * attack value is the weapon in the hand compensated by the 120% factor, and
 * an empty hand falls to `Weapon::useFist`'s 7. The `combat-profile` content
 * kind is gone, and `ISR`/`EQP` cases assert that it is.
 */
import { characterBaselineSchema, creatureSchema, huntSchema } from '@global-idle/game-data';
import type { ResolvedBundle } from '@global-idle/game-data';
import type { CombatProfile, CreatureStats, RoomPlan } from '@global-idle/game-engine';
import { contentKindMismatch, huntNotFound } from '../../platform/errors/index.js';
import { itemDefinition } from '../items/index.js';
import type { Affix, StoredItem } from '../items/index.js';

/** `EffectiveCombatValues::WEAPON_ATTACK_PERCENT` — a weapon's Attack counts
 *  20% higher before it enters any damage formula. */
export const WEAPON_ATTACK_PERCENT = 120;

export interface HuntPlan {
  readonly plan: RoomPlan;
  readonly profile: CombatProfile;
  readonly supplyCharges: number;
}

const affixTotal = (affixes: readonly Affix[], kind: Affix['affix']): number =>
  affixes.filter((affix) => affix.affix === kind).reduce((sum, affix) => sum + affix.value, 0);

export interface Loadout {
  readonly armor: number;
  readonly attackValue: number;
  readonly weaponDefense: number;
  readonly armed: boolean;
}

/**
 * What the equipped items are worth in combat.
 *
 * This is the whole of "real equipment replaced the shadow profile": four
 * leather pieces at 1 armour each make 4, and a dagger's raw 8 becomes the 9.6
 * `getMaxWeaponDamage` actually receives. Remove the weapon and `armed` is
 * false, which is how the unarmed path stays reachable rather than theoretical.
 */
export function loadoutOf(bundle: ResolvedBundle, equipped: readonly StoredItem[]): Loadout {
  let armor = 0;
  let attackValue = 0;
  let weaponDefense = 0;
  let armed = false;

  for (const item of equipped) {
    const definition = itemDefinition(bundle, item.definitionKey);
    armor += (definition.combat?.armor ?? 0) + affixTotal(item.affixes, 'ARMOR_PLUS');
    if (item.slot === 'LEFT' && definition.combat?.attack) {
      armed = true;
      const raw = definition.combat.attack + affixTotal(item.affixes, 'ATTACK_PLUS');
      attackValue = (raw * WEAPON_ATTACK_PERCENT) / 100;
      weaponDefense = definition.combat.defense ?? 0;
    }
  }
  return { armor, attackValue, weaponDefense, armed };
}

export interface BuildHuntPlan {
  readonly bundle: ResolvedBundle;
  readonly huntKey: string;
  readonly level: number;
  readonly equipped: readonly StoredItem[];
  /** How many supply items the Character actually brought. A charge is now a
   *  real potion in a real container, so this is a count, not a content field. */
  readonly supplyCharges: number;
  /** What one of them restores, from the potion definition. */
  readonly supplyHeal: { readonly min: number; readonly max: number } | null;
}

export function buildHuntPlan(input: BuildHuntPlan): HuntPlan {
  const { bundle, huntKey, level } = input;
  const definition = bundle.definitions.get(huntKey);
  if (!definition) throw huntNotFound({ key: huntKey, version: bundle.version });

  const hunt = huntSchema.safeParse(definition);
  if (!hunt.success) {
    throw contentKindMismatch({ key: huntKey, expected: 'hunt', actual: definition.kind });
  }
  if (!hunt.data.rooms || hunt.data.rooms.length === 0 || !hunt.data.characterBaseline) {
    // Content validation refuses this at build time; reaching it at runtime
    // means an older bundle is pinned, which is a legitimate state for an
    // Activity started before Phase 3 and an unplayable one now.
    throw contentKindMismatch({
      key: huntKey,
      expected: 'hunt with rooms and a character baseline',
      actual: 'hunt without a Phase 3 simulation',
    });
  }

  const baselineRaw = bundle.definitions.get(hunt.data.characterBaseline);
  const baseline = baselineRaw ? characterBaselineSchema.safeParse(baselineRaw) : undefined;
  if (!baseline?.success) {
    throw contentKindMismatch({
      key: hunt.data.characterBaseline,
      expected: 'character-baseline',
      actual: baselineRaw?.kind ?? 'absent',
    });
  }

  const creatures: Record<string, CreatureStats> = {};
  for (const room of hunt.data.rooms) {
    for (const entry of room.creatures) {
      if (creatures[entry.key]) continue;
      const raw = bundle.definitions.get(entry.key);
      const creature = raw ? creatureSchema.safeParse(raw) : undefined;
      if (!creature?.success) {
        throw contentKindMismatch({
          key: entry.key,
          expected: 'creature',
          actual: raw?.kind ?? 'absent',
        });
      }
      creatures[entry.key] = {
        key: creature.data.key,
        maxHealth: creature.data.maxHealth,
        experience: creature.data.experience,
        attackIntervalMs: creature.data.attack.intervalMs,
        maxDamage: creature.data.attack.maxDamage,
        defense: creature.data.defense,
        armor: creature.data.armor,
        mitigation: creature.data.mitigation,
        gold: creature.data.gold,
        loot: creature.data.loot,
      };
    }
  }

  const loadout = loadoutOf(bundle, input.equipped);

  // `Player::getDefense` (Phase 2 source map §3.5), computed rather than
  // authored now:
  //
  //   ((defenseSkill / 4 + 2.23) * defenseValue * defenseFactor * scaling)
  //
  // with the int32 return truncating. Unarmed uses fist skill, value 7 and
  // scaling 0.15; armed uses the weapon's own defence with the 0.146 scaling
  // a weapon-without-shield takes. Both readings of the tutorial Character
  // land on 4, which is the number Phase 2 authored — arrived at, not copied.
  const defenseValue = loadout.armed ? loadout.weaponDefense : baseline.data.unarmedAttackValue;
  const scaling = loadout.armed ? 0.146 : 0.15;
  const defense = Math.trunc(
    (baseline.data.attackSkill / 4 + 2.23) * defenseValue * baseline.data.attackFactor * scaling,
  );

  return {
    plan: {
      rooms: hunt.data.rooms.map((room) => ({
        number: room.number,
        creatures: room.creatures.map((entry) => ({ key: entry.key, count: entry.count })),
        endless: room.endless,
      })),
      creatures,
    },
    profile: {
      level,
      maxHealth: baseline.data.maxHealth,
      attackSkill: baseline.data.attackSkill,
      // An EMPTY hand attacks with 7 and rolls from zero — `Weapon::useFist`.
      attackValue: loadout.armed ? loadout.attackValue : baseline.data.unarmedAttackValue,
      armed: loadout.armed,
      attackFactor: baseline.data.attackFactor,
      attackIntervalMs: baseline.data.attackIntervalMs,
      defense,
      armor: loadout.armor,
      supply: {
        healMin: input.supplyHeal?.min ?? 0,
        healMax: input.supplyHeal?.max ?? 0,
        useBelowPercent: baseline.data.supplyUseBelowPercent,
      },
    },
    supplyCharges: input.supplyCharges,
  };
}
