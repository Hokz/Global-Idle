/**
 * What a Character is wearing and carrying, as the Hunt needs it
 * (Phase 3 spec §6.3, §14).
 *
 * INTERNAL to the items context. The Hunt asks two questions — what does
 * combat come from, and how many supplies were actually brought — and neither
 * of them is a content field any more.
 */
import type { ResolvedBundle } from '@global-idle/game-data';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { itemDefinition } from './catalogue.js';
import type { StoredItem } from './custody.js';

const toStored = (row: {
  id: string;
  accountId: string;
  characterId: string | null;
  definitionKey: string;
  quantity: number;
  location: string;
  slot: string | null;
  containerId: string | null;
  rarity: string;
  affixes: unknown;
}): StoredItem => ({
  id: row.id,
  accountId: row.accountId,
  characterId: row.characterId,
  definitionKey: row.definitionKey,
  quantity: row.quantity,
  location: row.location as StoredItem['location'],
  slot: row.slot as StoredItem['slot'],
  containerId: row.containerId,
  rarity: row.rarity as StoredItem['rarity'],
  affixes: Array.isArray(row.affixes) ? (row.affixes as StoredItem['affixes']) : [],
});

export async function equippedItems(
  tx: UnitOfWork,
  characterId: string,
): Promise<readonly StoredItem[]> {
  const rows = await tx.itemInstance.findMany({
    where: { characterId, location: 'EQUIPPED' },
    orderBy: { slot: 'asc' },
  });
  return rows.map(toStored);
}

export interface BroughtSupplies {
  readonly charges: number;
  readonly heal: { readonly min: number; readonly max: number } | null;
  readonly definitionKey: string | null;
}

/**
 * The supplies a Character actually brought into the Hunt.
 *
 * A "charge" was a number on a content profile in Phase 2. It is now a count
 * of real potions in real containers — which is why running out is a logistics
 * problem the player can solve, rather than a constant they cannot.
 *
 * Only what is in the Character's CONTAINERS counts. The Loot Pouch is
 * one-way-in for creature loot and is not a supply belt.
 */
export async function broughtSupplies(
  tx: UnitOfWork,
  bundle: ResolvedBundle,
  characterId: string,
): Promise<BroughtSupplies> {
  const rows = await tx.itemInstance.findMany({
    where: { characterId, location: 'CHARACTER_CONTAINER' },
    orderBy: { id: 'asc' },
  });
  let charges = 0;
  let heal: { min: number; max: number } | null = null;
  let definitionKey: string | null = null;
  for (const row of rows) {
    const definition = itemDefinition(bundle, row.definitionKey);
    if (definition.category !== 'POTION' || !definition.heal) continue;
    charges += row.quantity;
    if (!heal) {
      heal = { min: definition.heal.min, max: definition.heal.max };
      definitionKey = definition.key;
    }
  }
  return { charges, heal, definitionKey };
}

/**
 * Spend `count` supplies, cheapest row first.
 *
 * A Hunt that drank three potions must have three fewer potions when it ends,
 * or the whole point of bringing them is decorative.
 */
export async function consumeSupplies(
  tx: UnitOfWork,
  characterId: string,
  definitionKey: string,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  const rows = await tx.itemInstance.findMany({
    where: { characterId, location: 'CHARACTER_CONTAINER', definitionKey },
    orderBy: { id: 'asc' },
  });
  let remaining = count;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity, remaining);
    remaining -= take;
    if (take === row.quantity) await tx.itemInstance.delete({ where: { id: row.id } });
    else
      await tx.itemInstance.update({
        where: { id: row.id },
        data: { quantity: { decrement: take } },
      });
  }
}
