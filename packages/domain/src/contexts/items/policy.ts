/**
 * Loot Policy — "pick it up?" and nothing else (Phase 3 spec §15).
 *
 * INTERNAL to the items context. What happens AFTER collection — selling it,
 * routing it, keeping it — is a different question with a different owner;
 * Phase 8's Auto-Sell is the one this deliberately does not answer.
 */
import type { ResolvedBundle } from '@global-idle/game-data';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { itemDefinition } from './catalogue.js';
import type { ItemRarity } from './custody.js';

export type LootPolicyMode = 'COLLECT_ALL_EXCEPT_SKIPPED' | 'ACCEPTED_ONLY';

/**
 * One override. Exactly one of `itemKey`, `category` and `rarity` is set, and
 * which one decides its PRECEDENCE: item beats category beats rarity beats the
 * mode's own default.
 */
export interface LootRule {
  readonly itemKey?: string;
  readonly category?: string;
  readonly rarity?: ItemRarity;
  readonly accept: boolean;
}

export interface LootPolicy {
  readonly mode: LootPolicyMode;
  readonly rules: readonly LootRule[];
}

export const DEFAULT_POLICY: LootPolicy = { mode: 'COLLECT_ALL_EXCEPT_SKIPPED', rules: [] };

export async function readPolicy(tx: UnitOfWork, characterId: string): Promise<LootPolicy> {
  const row = await tx.characterLootPolicy.findUnique({ where: { characterId } });
  if (!row) return DEFAULT_POLICY;
  return {
    mode: row.mode as LootPolicyMode,
    rules: Array.isArray(row.rules) ? (row.rules as unknown as readonly LootRule[]) : [],
  };
}

export async function writePolicy(
  tx: UnitOfWork,
  characterId: string,
  policy: LootPolicy,
  at: Date,
): Promise<void> {
  await tx.characterLootPolicy.upsert({
    where: { characterId },
    create: {
      characterId,
      mode: policy.mode,
      rules: policy.rules as never,
      updatedAt: at,
    },
    update: { mode: policy.mode, rules: policy.rules as never, updatedAt: at },
  });
}

/**
 * Should this drop be collected?
 *
 * Precedence is resolved by LOOKING for the most specific rule first, not by
 * ordering the array — an override that happened to be added last must not
 * outrank a more specific one that was added first.
 */
export function accepts(
  policy: LootPolicy,
  bundle: ResolvedBundle,
  itemKey: string,
  rarity: ItemRarity,
): boolean {
  const definition = itemDefinition(bundle, itemKey);

  const byItem = policy.rules.find((rule) => rule.itemKey === itemKey);
  if (byItem) return byItem.accept;

  const byCategory = policy.rules.find((rule) => rule.category === definition.category);
  if (byCategory) return byCategory.accept;

  const byRarity = policy.rules.find((rule) => rule.rarity === rarity);
  if (byRarity) return byRarity.accept;

  return policy.mode === 'COLLECT_ALL_EXCEPT_SKIPPED';
}
