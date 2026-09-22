// Public surface of the Items bounded context (Phase 3 spec §2, §3).
//
// This file is the ONLY legal entry point. Reaching past it into custody.ts,
// move.ts or catalogue.ts is a dependency-cruiser violation, inside this
// package as much as across it — the same rule the economy context has, for
// the same reason: every legality question has exactly one place to be asked.
export const CONTEXT_NAME = 'items' as const;

export {
  allItems,
  containerSlotPrices,
  itemDefinition,
  rarityTable,
  serviceDefinition,
  startingGrant,
} from './catalogue.js';

export {
  capacityFor,
  carried,
  carriedWeight,
  createItem,
  depotSpaces,
  freeSpacesIn,
  fungibleWith,
  lockItems,
  pouchSpaces,
  readItem,
  usedSpaces,
  weightOf,
} from './custody.js';
export type {
  Affix,
  EquipmentSlot,
  ItemDestination,
  ItemLocation,
  ItemRarity,
  StoredItem,
} from './custody.js';

export { emptyPouch, moveItem, placeInPouch, unequip } from './move.js';
export type { MoveItem } from './move.js';

export { broughtSupplies, consumeSupplies, equippedItems } from './loadout.js';
export type { BroughtSupplies } from './loadout.js';

export { DEFAULT_POLICY, accepts, readPolicy, writePolicy } from './policy.js';
export type { LootPolicy, LootPolicyMode, LootRule } from './policy.js';

export { COMMON, rollIdentity } from './rarity.js';
export type { RolledItem } from './rarity.js';

export { createSlots, installContainer, readSlots, setRouting, unlockSlot } from './slots.js';
export type { ContainerSlot } from './slots.js';

export { applyStartingGrant } from './grant.js';
