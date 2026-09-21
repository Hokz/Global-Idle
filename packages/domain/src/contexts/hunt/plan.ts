/**
 * Resolved content → the engine's inputs (Phase 2 spec §5).
 *
 * The engine never looks a key up; it has no resolver and no I/O. This is
 * where a bundle becomes a `RoomPlan` and a `CombatProfile`, once, with every
 * reference checked — so a missing creature is a readable failure here rather
 * than an `undefined` inside a tick.
 */
import { combatProfileSchema, creatureSchema, huntSchema } from '@global-idle/game-data';
import type { ResolvedBundle } from '@global-idle/game-data';
import type { CombatProfile, CreatureStats, RoomPlan } from '@global-idle/game-engine';
import { contentKindMismatch, huntNotFound } from '../../platform/errors/index.js';

export interface HuntPlan {
  readonly plan: RoomPlan;
  readonly profile: CombatProfile;
  readonly supplyCharges: number;
}

export function buildHuntPlan(bundle: ResolvedBundle, huntKey: string, level: number): HuntPlan {
  const definition = bundle.definitions.get(huntKey);
  if (!definition) throw huntNotFound({ key: huntKey, version: bundle.version });

  const hunt = huntSchema.safeParse(definition);
  if (!hunt.success) {
    throw contentKindMismatch({ key: huntKey, expected: 'hunt', actual: definition.kind });
  }
  if (!hunt.data.rooms || hunt.data.rooms.length === 0 || !hunt.data.combatProfile) {
    // Content validation refuses this at build time; reaching it at runtime
    // means an older bundle is pinned, which is a legitimate state for an
    // Activity started before Phase 2 and an unplayable one now.
    throw contentKindMismatch({
      key: huntKey,
      expected: 'hunt with rooms and a combat profile',
      actual: 'hunt without a Phase 2 simulation',
    });
  }

  const profileDefinition = bundle.definitions.get(hunt.data.combatProfile);
  const profile = profileDefinition ? combatProfileSchema.safeParse(profileDefinition) : undefined;
  if (!profile?.success) {
    throw contentKindMismatch({
      key: hunt.data.combatProfile,
      expected: 'combat-profile',
      actual: profileDefinition?.kind ?? 'absent',
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
      };
    }
  }

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
      maxHealth: profile.data.maxHealth,
      attackSkill: profile.data.attackSkill,
      attackValue: profile.data.attackValue,
      attackFactor: profile.data.attackFactor,
      attackIntervalMs: profile.data.attackIntervalMs,
      defense: profile.data.defense,
      armor: profile.data.armor,
      supply: {
        healMin: profile.data.supply.healMin,
        healMax: profile.data.supply.healMax,
        useBelowPercent: profile.data.supply.useBelowPercent,
      },
    },
    supplyCharges: profile.data.supply.charges,
  };
}
