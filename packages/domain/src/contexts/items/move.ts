/**
 * Moving items — the one primitive every storage transition goes through
 * (Phase 3 spec §3, §12, §16).
 *
 * INTERNAL to the items context. There is deliberately ONE function that moves
 * a quantity from one place to another, because every legality rule lives in
 * it: a second path is a second place to forget the Loot Pouch prohibition.
 *
 * Conservation is structural rather than checked afterwards: a move either
 * decrements the source and credits the destination inside one transaction, or
 * it throws and nothing happened. Splitting is a move of part of a stack, and
 * merging is what a move does on arrival.
 */
import type { ResolvedBundle } from '@global-idle/game-data';
import type { Instant } from '@global-idle/shared';
import { recordDomainEvent } from '../../platform/observability/index.js';
import { illegalItemMove, noRoomForItem } from '../../platform/errors/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { itemDefinition } from './catalogue.js';
import {
  assertCapacity,
  carried,
  containerOf,
  createItem,
  freeSpacesIn,
  fungibleWith,
  lockItems,
  planPlacement,
  readItem,
  weightOf,
  type Affix,
  type ItemDestination,
  type ItemRarity,
  type StoredItem,
} from './custody.js';

export interface MoveItem {
  readonly bundle: ResolvedBundle;
  readonly accountId: string;
  /** The Character performing the move. Its Capacity is the one that binds. */
  readonly characterId: string;
  readonly baseLevel: number;
  readonly instanceId: string;
  /** Omitted means the whole stack. */
  readonly quantity?: number;
  readonly to: ItemDestination;
  readonly at: Instant;
}

/** Rows already in the destination that an arriving quantity could merge with. */
async function occupants(
  tx: UnitOfWork,
  accountId: string,
  characterId: string,
  to: ItemDestination,
): Promise<readonly StoredItem[]> {
  if (to.kind === 'CONTAINER') {
    const rows = await tx.itemInstance.findMany({
      where: { containerId: to.containerId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({ ...row, affixes: (row.affixes ?? []) as never })) as never;
  }
  if (to.kind === 'DEPOT') {
    const rows = await tx.itemInstance.findMany({
      where: { accountId, location: 'DEPOT' },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({ ...row, affixes: (row.affixes ?? []) as never })) as never;
  }
  void characterId;
  return [];
}

/**
 * Move a quantity of one instance to one destination.
 *
 * Refuses, in this order: a quantity that is not positive or exceeds the
 * stack; a destination the definition cannot occupy; a container that is not
 * installed in an unlocked slot; a container inside a container; an equipment
 * slot the definition does not fit; no free space; and finally the Capacity
 * the arrival would exceed. Every one of them leaves the source untouched.
 */
export async function moveItem(tx: UnitOfWork, input: MoveItem): Promise<void> {
  const source = await readItem(tx, input.accountId, input.instanceId);
  await lockItems(tx, [source.id, input.to.kind === 'CONTAINER' ? input.to.containerId : '']);

  const fresh = await readItem(tx, input.accountId, input.instanceId);
  const quantity = input.quantity ?? fresh.quantity;
  if (quantity <= 0 || quantity > fresh.quantity) {
    throw illegalItemMove({ instanceId: fresh.id, quantity, available: fresh.quantity });
  }

  const definition = itemDefinition(input.bundle, fresh.definitionKey);

  // ── destination legality ────────────────────────────────────────────────
  if (input.to.kind === 'EQUIPPED') {
    if (!definition.slot || definition.slot !== input.to.slot) {
      throw illegalItemMove({
        instanceId: fresh.id,
        reason: 'the definition does not fit that slot',
        slot: input.to.slot,
        fits: definition.slot ?? null,
      });
    }
    if (quantity !== fresh.quantity || quantity !== 1) {
      throw illegalItemMove({ instanceId: fresh.id, reason: 'equipment is worn whole' });
    }
  }
  if (input.to.kind === 'CONTAINER') {
    if (definition.category === 'CONTAINER') {
      // The nesting exploit, refused where it is understood rather than where
      // it happens to be noticed. Containers live in top-level slots.
      throw illegalItemMove({
        instanceId: fresh.id,
        reason: 'a container cannot go in a container',
      });
    }
    await containerOf(tx, input.bundle, input.accountId, input.to.containerId);
  }

  // ── space ───────────────────────────────────────────────────────────────
  const free = await freeSpacesIn(tx, input.bundle, input.accountId, input.to);
  const existing = await occupants(tx, input.accountId, input.characterId, input.to);
  const placement =
    input.to.kind === 'EQUIPPED'
      ? { merges: [], newStacks: [quantity] }
      : planPlacement(
          {
            bundle: input.bundle,
            definitionKey: fresh.definitionKey,
            rarity: fresh.rarity,
            affixes: fresh.affixes,
            quantity,
          },
          existing.filter((row) => row.id !== fresh.id),
          free,
        );
  if (!placement) throw noRoomForItem({ instanceId: fresh.id, to: input.to.kind });

  // ── Capacity, only for what is arriving into CARRIED custody ────────────
  //
  // The Depot weighs nothing, and moving inside the same Character's carried
  // custody moves no weight at all. Charging either would refuse a tidy-up for
  // being heavy, which it is not.
  const arrivingIsCarried = input.to.kind !== 'DEPOT';
  const leavingWasCarried = fresh.location !== 'DEPOT' && fresh.characterId === input.characterId;
  if (arrivingIsCarried && !leavingWasCarried) {
    await assertCapacity(
      tx,
      input.bundle,
      input.characterId,
      input.baseLevel,
      weightOf(input.bundle, { ...fresh, quantity }),
    );
  }

  // ── apply ───────────────────────────────────────────────────────────────
  for (const merge of placement.merges) {
    await tx.itemInstance.update({
      where: { id: merge.id },
      data: { quantity: { increment: merge.add } },
    });
  }
  for (const size of placement.newStacks) {
    await createItem(tx, {
      accountId: input.accountId,
      characterId: input.to.kind === 'DEPOT' ? null : input.characterId,
      definitionKey: fresh.definitionKey,
      quantity: size,
      location:
        input.to.kind === 'EQUIPPED'
          ? 'EQUIPPED'
          : input.to.kind === 'CONTAINER'
            ? 'CHARACTER_CONTAINER'
            : 'DEPOT',
      slot: input.to.kind === 'EQUIPPED' ? input.to.slot : null,
      containerId: input.to.kind === 'CONTAINER' ? input.to.containerId : null,
      rarity: fresh.rarity,
      affixes: fresh.affixes,
      at: input.at,
    });
  }

  if (quantity === fresh.quantity) {
    await tx.itemInstance.delete({ where: { id: fresh.id } });
  } else {
    await tx.itemInstance.update({
      where: { id: fresh.id },
      data: { quantity: { decrement: quantity } },
    });
  }

  recordDomainEvent({
    kind: 'item.moved',
    accountId: input.accountId,
    characterId: input.characterId,
    definitionKey: fresh.definitionKey,
    quantity,
    from: fresh.location,
    to: input.to.kind,
  });
}

/** Unequip is a move out of a slot into somewhere that accepts the item. */
export async function unequip(
  tx: UnitOfWork,
  input: Omit<MoveItem, 'instanceId' | 'quantity'> & { readonly slot: string },
): Promise<void> {
  const row = await tx.itemInstance.findFirst({
    where: { characterId: input.characterId, location: 'EQUIPPED', slot: input.slot as never },
  });
  if (!row) throw illegalItemMove({ slot: input.slot, reason: 'nothing is equipped there' });
  await moveItem(tx, { ...input, instanceId: row.id, to: input.to, at: input.at });
}

/**
 * Collect creature loot into the Loot Pouch.
 *
 * The ONLY inbound path, and it is not reachable from a player command: the
 * destination type has no `LOOT_POUCH` member, so a manual move cannot name
 * it. Returns what was actually collected, which may be less than what
 * dropped — a full pouch stops collection and never stops the Hunt.
 */
export async function placeInPouch(
  tx: UnitOfWork,
  input: {
    readonly bundle: ResolvedBundle;
    readonly accountId: string;
    readonly characterId: string;
    readonly baseLevel: number;
    readonly definitionKey: string;
    readonly quantity: number;
    readonly rarity?: ItemRarity;
    readonly affixes?: readonly Affix[];
    readonly at: Instant;
  },
): Promise<{ readonly collected: number; readonly reason: 'ok' | 'no-space' | 'over-capacity' }> {
  const rarity = input.rarity ?? 'COMMON';
  const affixes = input.affixes ?? [];
  const free = await freeSpacesIn(tx, input.bundle, input.accountId, {
    kind: 'LOOT_POUCH',
    characterId: input.characterId,
  });
  const inPouch = (await carried(tx, input.characterId)).filter(
    (row) => row.location === 'LOOT_POUCH',
  );
  const placement = planPlacement(
    {
      bundle: input.bundle,
      definitionKey: input.definitionKey,
      rarity,
      affixes,
      quantity: input.quantity,
    },
    inPouch,
    free,
  );
  if (!placement) return { collected: 0, reason: 'no-space' };

  const definition = itemDefinition(input.bundle, input.definitionKey);
  const adding = definition.weight * (definition.stackable ? input.quantity : 1);
  try {
    await assertCapacity(tx, input.bundle, input.characterId, input.baseLevel, adding);
  } catch {
    return { collected: 0, reason: 'over-capacity' };
  }

  for (const merge of placement.merges) {
    await tx.itemInstance.update({
      where: { id: merge.id },
      data: { quantity: { increment: merge.add } },
    });
  }
  for (const size of placement.newStacks) {
    await createItem(tx, {
      accountId: input.accountId,
      characterId: input.characterId,
      definitionKey: input.definitionKey,
      quantity: size,
      location: 'LOOT_POUCH',
      rarity,
      affixes,
      at: input.at,
    });
  }
  return { collected: input.quantity, reason: 'ok' };
}

/** Everything in the Loot Pouch is destroyed. Death, without Full Bless. */
export async function emptyPouch(
  tx: UnitOfWork,
  characterId: string,
): Promise<readonly { readonly definitionKey: string; readonly quantity: number }[]> {
  const rows = await tx.itemInstance.findMany({
    where: { characterId, location: 'LOOT_POUCH' },
    orderBy: { id: 'asc' },
  });
  if (rows.length === 0) return [];
  await lockItems(
    tx,
    rows.map((row) => row.id),
  );
  await tx.itemInstance.deleteMany({ where: { characterId, location: 'LOOT_POUCH' } });
  return rows.map((row) => ({ definitionKey: row.definitionKey, quantity: row.quantity }));
}

export { fungibleWith };
