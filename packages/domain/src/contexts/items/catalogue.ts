/**
 * The item catalogue — content, resolved once per bundle (Phase 3 spec §2).
 *
 * INTERNAL to the items context. What an item IS is authored, hashed and
 * published; what a particular one HAS BECOME is a database row. This file is
 * the boundary between the two, and it is the only place that parses an item
 * definition out of a bundle.
 */
import {
  containerSlotsSchema,
  itemSchema,
  rarityTableSchema,
  serviceSchema,
  startingGrantSchema,
} from '@global-idle/game-data';
import type {
  ContainerSlots,
  ItemDefinition,
  RarityTable,
  ResolvedBundle,
  ServiceDefinition,
  StartingGrant,
} from '@global-idle/game-data';
import { contentKindMismatch, itemDefinitionUnknown } from '../../platform/errors/index.js';

/** Non-stackable definitions carry `maxStack` 1, which is what makes a
 *  quantity above 1 unrepresentable for a unique item (spec §4). */
export const NON_STACKABLE_MAX = 1;

/** The ceiling no definition may exceed — Canary's own parser limit. */
export const STACK_CEILING = 255;

export function itemDefinition(bundle: ResolvedBundle, key: string): ItemDefinition {
  const raw = bundle.definitions.get(key);
  if (!raw) throw itemDefinitionUnknown({ key, version: bundle.version });
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    throw contentKindMismatch({ key, expected: 'item', actual: raw.kind });
  }
  return parsed.data;
}

export function rarityTable(bundle: ResolvedBundle, key = 'rarity-table.default'): RarityTable {
  const raw = bundle.definitions.get(key);
  const parsed = raw ? rarityTableSchema.safeParse(raw) : undefined;
  if (!parsed?.success) {
    throw contentKindMismatch({ key, expected: 'rarity-table', actual: raw?.kind ?? 'absent' });
  }
  return parsed.data;
}

export function containerSlotPrices(
  bundle: ResolvedBundle,
  key = 'container-slots.default',
): ContainerSlots {
  const raw = bundle.definitions.get(key);
  const parsed = raw ? containerSlotsSchema.safeParse(raw) : undefined;
  if (!parsed?.success) {
    throw contentKindMismatch({ key, expected: 'container-slots', actual: raw?.kind ?? 'absent' });
  }
  return parsed.data;
}

export function serviceDefinition(bundle: ResolvedBundle, key: string): ServiceDefinition {
  const raw = bundle.definitions.get(key);
  const parsed = raw ? serviceSchema.safeParse(raw) : undefined;
  if (!parsed?.success) {
    throw contentKindMismatch({ key, expected: 'service', actual: raw?.kind ?? 'absent' });
  }
  return parsed.data;
}

export function startingGrant(bundle: ResolvedBundle, key: string): StartingGrant {
  const raw = bundle.definitions.get(key);
  const parsed = raw ? startingGrantSchema.safeParse(raw) : undefined;
  if (!parsed?.success) {
    throw contentKindMismatch({ key, expected: 'starting-grant', actual: raw?.kind ?? 'absent' });
  }
  return parsed.data;
}

/** Every item definition in a bundle, for the catalogue the System UI shows. */
export function allItems(bundle: ResolvedBundle): readonly ItemDefinition[] {
  const items: ItemDefinition[] = [];
  for (const definition of bundle.definitions.values()) {
    if (definition.kind !== 'item') continue;
    items.push(itemSchema.parse(definition));
  }
  return items;
}
