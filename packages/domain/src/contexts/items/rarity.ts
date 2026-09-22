/**
 * Rarity and affixes — deterministic, content-driven, and exponential because
 * the AUTHORED WEIGHTS say so rather than because a formula in code does
 * (Phase 3 spec §5).
 *
 * INTERNAL to the items context. A replay produces the same instance, which is
 * what stops a retry rerolling a Legendary into a Common — or the other way
 * round, which players notice faster.
 */
import type { RarityTable, ResolvedBundle } from '@global-idle/game-data';
import type { SeededRandom } from '@global-idle/game-engine';
import { uniformRandom } from '@global-idle/game-engine';
import { itemDefinition, rarityTable } from './catalogue.js';
import type { Affix, ItemRarity } from './custody.js';

export interface RolledItem {
  readonly rarity: ItemRarity;
  readonly affixes: readonly Affix[];
}

export const COMMON: RolledItem = { rarity: 'COMMON', affixes: [] };

/**
 * Roll an instance's identity.
 *
 * A definition that is not `rarityEligible` — cheese, a potion — is Common
 * with no affixes and consumes NO draws, so adding an eligible drop to a
 * creature later cannot disturb an existing one's sequence.
 */
export function rollIdentity(
  bundle: ResolvedBundle,
  itemKey: string,
  rng: SeededRandom,
  table: RarityTable = rarityTable(bundle),
): RolledItem {
  const definition = itemDefinition(bundle, itemKey);
  if (!definition.rarityEligible) return COMMON;

  const total = table.tiers.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = rng.next() * total;
  let chosen = table.tiers[0]!;
  for (const tier of table.tiers) {
    roll -= tier.weight;
    if (roll < 0) {
      chosen = tier;
      break;
    }
  }

  const affixes: Affix[] = [];
  for (let index = 0; index < chosen.affixes; index += 1) {
    const pool = table.affixes;
    const pick = pool[Math.min(pool.length - 1, Math.floor(rng.next() * pool.length))]!;
    affixes.push({ affix: pick.affix, value: uniformRandom(rng, pick.min, pick.max) });
  }
  return { rarity: chosen.rarity as ItemRarity, affixes };
}
