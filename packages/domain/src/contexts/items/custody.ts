/**
 * Physical custody, and the one primitive that moves it (Phase 3 spec §3, §16).
 *
 * INTERNAL to the items context. Every legality question a move can ask is
 * answered HERE and nowhere else — ownership, source custody, destination
 * acceptance, stack limits, space, Capacity, slot legality, `stashEligible`,
 * the Loot Pouch inbound prohibition and `quantity > 0`. A caller that forgot
 * one is not a caller this module has.
 *
 * The database already refuses the shapes that must never exist: one row is in
 * exactly one location, a container cannot nest, a quantity is 1..255, one
 * item per equipment slot. What is left for this file is the part a CHECK
 * cannot see — how much is already there, and how much it weighs.
 */
import {
  CAPACITY_BASE_HUNDREDTHS,
  CAPACITY_PER_LEVEL_HUNDREDTHS,
  DEPOT_SPACES,
  LOOT_POUCH_SPACES,
  newId,
} from '@global-idle/shared';
import type { ResolvedBundle } from '@global-idle/game-data';
import type { Instant } from '@global-idle/shared';
import {
  illegalItemMove,
  itemNotFound,
  noRoomForItem,
  overCapacity,
} from '../../platform/errors/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { itemDefinition } from './catalogue.js';

export type ItemLocation = 'EQUIPPED' | 'CHARACTER_CONTAINER' | 'LOOT_POUCH' | 'DEPOT';

export type EquipmentSlot =
  'HEAD' | 'NECKLACE' | 'BACKPACK' | 'ARMOR' | 'RIGHT' | 'LEFT' | 'LEGS' | 'FEET' | 'RING' | 'AMMO';

export type ItemRarity = 'COMMON' | 'SEMI_RARE' | 'RARE' | 'MYSTIC' | 'LEGENDARY' | 'STELLAR';

export interface Affix {
  readonly affix: 'ARMOR_PLUS' | 'ATTACK_PLUS';
  readonly value: number;
}

export interface StoredItem {
  readonly id: string;
  readonly accountId: string;
  readonly characterId: string | null;
  readonly definitionKey: string;
  readonly quantity: number;
  readonly location: ItemLocation;
  readonly slot: EquipmentSlot | null;
  readonly containerId: string | null;
  readonly rarity: ItemRarity;
  readonly affixes: readonly Affix[];
}

/**
 * Where an item is being moved TO.
 *
 * `LOOT_POUCH` is deliberately absent. It is not a destination a player can
 * choose: the only automatic inbound is creature-generated loot, and that path
 * calls {@link placeInPouch} directly. Making it unspeakable in this type is
 * why "manual inbound is refused" needs no runtime check in five places.
 */
export type ItemDestination =
  | { readonly kind: 'EQUIPPED'; readonly slot: EquipmentSlot }
  | { readonly kind: 'CONTAINER'; readonly containerId: string }
  | { readonly kind: 'DEPOT' };

/** Capacity in hundredths of an ounce, from the Character's Base Level. */
export const capacityFor = (baseLevel: number): number =>
  CAPACITY_BASE_HUNDREDTHS + Math.max(0, baseLevel - 1) * CAPACITY_PER_LEVEL_HUNDREDTHS;

const affixesOf = (raw: unknown): readonly Affix[] =>
  Array.isArray(raw) ? (raw as readonly Affix[]) : [];

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
  location: row.location as ItemLocation,
  slot: row.slot as EquipmentSlot | null,
  containerId: row.containerId,
  rarity: row.rarity as ItemRarity,
  affixes: affixesOf(row.affixes),
});

/**
 * Read one instance, scoped to the Account.
 *
 * A missing instance and someone else's instance give the SAME answer, because
 * the difference is information a caller has no business learning.
 */
export async function readItem(
  tx: UnitOfWork,
  accountId: string,
  instanceId: string,
): Promise<StoredItem> {
  const row = await tx.itemInstance.findFirst({ where: { id: instanceId, accountId } });
  if (!row) throw itemNotFound({ instanceId });
  return toStored(row);
}

/**
 * Lock instances in ascending id order, which is §8.5's rule applied to the
 * new table: `ItemInstance` sits after the occupancy claim and before the
 * balances, so an operation that moves an item AND money always moves the item
 * first. Two concurrent moves of the same rows therefore serialize instead of
 * cloning.
 */
export async function lockItems(tx: UnitOfWork, ids: readonly string[]): Promise<void> {
  const ordered = [...new Set(ids)].filter(Boolean).sort();
  if (ordered.length === 0) return;
  await tx.$queryRawUnsafe(
    `SELECT id FROM "ItemInstance" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    ordered,
  );
}

/** Everything a Character is carrying: equipped, in its containers, in its
 *  Loot Pouch. The Depot is account storage and weighs nothing. */
export async function carried(tx: UnitOfWork, characterId: string): Promise<readonly StoredItem[]> {
  const rows = await tx.itemInstance.findMany({
    where: {
      characterId,
      location: { in: ['EQUIPPED', 'CHARACTER_CONTAINER', 'LOOT_POUCH'] },
    },
    orderBy: { id: 'asc' },
  });
  return rows.map(toStored);
}

/** `Item::getWeight`: a stackable weighs its base weight times its count. */
export function weightOf(bundle: ResolvedBundle, item: StoredItem): number {
  const definition = itemDefinition(bundle, item.definitionKey);
  return definition.weight * (definition.stackable ? item.quantity : 1);
}

export async function carriedWeight(
  tx: UnitOfWork,
  bundle: ResolvedBundle,
  characterId: string,
): Promise<number> {
  const items = await carried(tx, characterId);
  return items.reduce((total, item) => total + weightOf(bundle, item), 0);
}

/** How many rows a container is holding. One row is one SPACE, which is what
 *  makes 600 potions cost three of them. */
export async function usedSpaces(tx: UnitOfWork, containerId: string): Promise<number> {
  return tx.itemInstance.count({ where: { containerId } });
}

export async function pouchSpaces(tx: UnitOfWork, characterId: string): Promise<number> {
  return tx.itemInstance.count({ where: { characterId, location: 'LOOT_POUCH' } });
}

export async function depotSpaces(tx: UnitOfWork, accountId: string): Promise<number> {
  return tx.itemInstance.count({ where: { accountId, location: 'DEPOT' } });
}

export interface CreateItem {
  readonly accountId: string;
  readonly characterId: string | null;
  readonly definitionKey: string;
  readonly quantity: number;
  readonly location: ItemLocation;
  readonly slot?: EquipmentSlot | null;
  readonly containerId?: string | null;
  readonly rarity?: ItemRarity;
  readonly affixes?: readonly Affix[];
  readonly at: Instant;
}

export async function createItem(tx: UnitOfWork, input: CreateItem): Promise<StoredItem> {
  const row = await tx.itemInstance.create({
    data: {
      id: newId<'ItemInstanceId'>(input.at),
      accountId: input.accountId,
      characterId: input.characterId,
      definitionKey: input.definitionKey,
      quantity: input.quantity,
      location: input.location,
      slot: input.slot ?? null,
      containerId: input.containerId ?? null,
      rarity: input.rarity ?? 'COMMON',
      affixes: (input.affixes ?? []) as never,
      createdAt: input.at,
    },
  });
  return toStored(row);
}

/**
 * Two rows are the same THING when their definition, rarity and affixes all
 * agree. An individualized instance never merges, because its rarity or its
 * affixes are part of what it is — which is how unique equipment stays unique
 * without a second table.
 */
export interface ItemIdentity {
  readonly definitionKey: string;
  readonly rarity: ItemRarity;
  readonly affixes: readonly Affix[];
}

export function fungibleWith(a: ItemIdentity, b: ItemIdentity): boolean {
  return (
    a.definitionKey === b.definitionKey &&
    a.rarity === b.rarity &&
    JSON.stringify(a.affixes) === JSON.stringify(b.affixes)
  );
}

export interface PlacementCheck extends ItemIdentity {
  readonly bundle: ResolvedBundle;
  readonly quantity: number;
}

/**
 * Where a quantity can actually go inside one container or the Loot Pouch:
 * how much merges into existing stacks, and how many NEW spaces the remainder
 * needs. Returns null when it does not fit at all.
 */
export interface Placement {
  readonly merges: readonly { readonly id: string; readonly add: number }[];
  readonly newStacks: readonly number[];
}

export function planPlacement(
  check: PlacementCheck,
  existing: readonly StoredItem[],
  freeSpaces: number,
): Placement | null {
  const definition = itemDefinition(check.bundle, check.definitionKey);
  const maxStack = definition.stackable ? definition.maxStack : 1;
  let remaining = check.quantity;
  const merges: { id: string; add: number }[] = [];

  if (definition.stackable) {
    for (const row of existing) {
      if (remaining <= 0) break;
      if (!fungibleWith(row, check)) continue;
      const room = maxStack - row.quantity;
      if (room <= 0) continue;
      const add = Math.min(room, remaining);
      merges.push({ id: row.id, add });
      remaining -= add;
    }
  }

  const newStacks: number[] = [];
  while (remaining > 0) {
    const size = Math.min(maxStack, remaining);
    newStacks.push(size);
    remaining -= size;
  }
  if (newStacks.length > freeSpaces) return null;
  return { merges, newStacks };
}

/** The capacity guard, as one sentence: what is carried now, plus what is
 *  arriving, against what this Character can carry. */
export async function assertCapacity(
  tx: UnitOfWork,
  bundle: ResolvedBundle,
  characterId: string,
  baseLevel: number,
  addingHundredths: number,
): Promise<void> {
  if (addingHundredths <= 0) return;
  const current = await carriedWeight(tx, bundle, characterId);
  const limit = capacityFor(baseLevel);
  if (current + addingHundredths > limit) {
    throw overCapacity({ characterId, carried: current, adding: addingHundredths, limit });
  }
}

export const POUCH_SPACES = LOOT_POUCH_SPACES;
export const DEPOT_LIMIT = DEPOT_SPACES;

/** A container instance, verified to be one — and to be installed in an
 *  unlocked slot of the Character that is asking. */
export async function containerOf(
  tx: UnitOfWork,
  bundle: ResolvedBundle,
  accountId: string,
  containerId: string,
): Promise<{ readonly item: StoredItem; readonly spaces: number }> {
  const item = await readItem(tx, accountId, containerId);
  const definition = itemDefinition(bundle, item.definitionKey);
  if (definition.category !== 'CONTAINER' || !definition.containerSpaces) {
    throw illegalItemMove({ containerId, reason: 'not a container' });
  }
  const slot = await tx.characterContainerSlot.findFirst({
    where: { containerInstanceId: containerId },
  });
  if (!slot || slot.unlockedAt === null) {
    throw illegalItemMove({
      containerId,
      reason: 'container is not installed in an unlocked slot',
    });
  }
  return { item, spaces: definition.containerSpaces };
}

/** Free spaces in a container, the Loot Pouch or the Depot. */
export async function freeSpacesIn(
  tx: UnitOfWork,
  bundle: ResolvedBundle,
  accountId: string,
  destination: ItemDestination | { readonly kind: 'LOOT_POUCH'; readonly characterId: string },
): Promise<number> {
  switch (destination.kind) {
    case 'CONTAINER': {
      const { spaces } = await containerOf(tx, bundle, accountId, destination.containerId);
      return spaces - (await usedSpaces(tx, destination.containerId));
    }
    case 'LOOT_POUCH':
      return POUCH_SPACES - (await pouchSpaces(tx, destination.characterId));
    case 'DEPOT':
      return DEPOT_LIMIT - (await depotSpaces(tx, accountId));
    case 'EQUIPPED':
      return 1;
    default:
      throw noRoomForItem({ destination });
  }
}
