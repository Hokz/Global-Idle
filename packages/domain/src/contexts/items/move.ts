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
import { illegalItemMove, itemNotFound, noRoomForItem } from '../../platform/errors/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { assertSafeContext } from './access.js';
import { itemDefinition } from './catalogue.js';
import {
  addToStack,
  assertCapacity,
  carried,
  containerOf,
  createItem,
  freeSpacesIn,
  fungibleWith,
  lockDestination,
  lockItems,
  lockSlot,
  planPlacement,
  readItem,
  usedSpaces,
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

/** Install a container into one of the five slots — a move, like any other. */
export async function installContainer(
  tx: UnitOfWork,
  input: Omit<MoveItem, 'to' | 'quantity'> & { readonly slotIndex: number },
): Promise<void> {
  await moveItem(tx, {
    ...input,
    to: { kind: 'HUNT_CONTAINER', slotIndex: input.slotIndex },
  });
}

/**
 * Move a quantity of one instance to one destination.
 *
 * Refuses, in this order: a Depot touch from inside a Hunt; a quantity that is
 * not positive or exceeds the stack; a destination the definition cannot
 * occupy; a container that is not an ACTIVE container of THIS Character; a
 * container inside a container; an equipment slot the definition does not fit;
 * a loaded container being taken out of its slot; no free space; and finally
 * the Capacity the arrival would exceed. Every one of them leaves the source
 * untouched.
 *
 * INSTALLING and UNINSTALLING a top-level Hunt container are moves like any
 * other — `to.kind === 'HUNT_CONTAINER'` — which is why the slot row can never
 * drift from the instance: the same function writes both, in the same
 * transaction, and the composite foreign key refuses the orderings that would
 * leave one without the other.
 */
export async function moveItem(tx: UnitOfWork, input: MoveItem): Promise<void> {
  const peek = await readItem(tx, input.accountId, input.instanceId);

  // ── access, in the DOMAIN ───────────────────────────────────────────────
  //
  // Not in the controller. A rule that lives at one call site is a rule the
  // next call site has to remember, and a job or a future service is exactly
  // the caller that will not.
  if (input.to.kind === 'DEPOT' || peek.location === 'DEPOT') {
    await assertSafeContext(tx, input.characterId, 'depot');
  }

  // ── locks, in §8.5 order: Account, Character, slot, then instances ──────
  if (input.to.kind === 'DEPOT')
    await lockDestination(tx, input.accountId, input.characterId, input.to);
  const slotsToLock = new Set<number>();
  if (input.to.kind === 'HUNT_CONTAINER') slotsToLock.add(input.to.slotIndex);
  if (peek.location === 'HUNT_CONTAINER' && peek.slotIndex !== null) {
    slotsToLock.add(peek.slotIndex);
  }
  for (const index of [...slotsToLock].sort((a, b) => a - b)) {
    await lockSlot(tx, input.characterId, index);
  }
  await lockItems(tx, [peek.id, input.to.kind === 'CONTAINER' ? input.to.containerId : '']);

  const fresh = await readItem(tx, input.accountId, input.instanceId);

  // Another CHARACTER on the same account is still another Character. Its
  // backpack, its potions and its worn armour are not a shared shelf, and the
  // answer is NOT FOUND rather than FORBIDDEN because whose it is, is not
  // information the asker is entitled to. Account storage is the exception
  // that proves it: a Depot row belongs to nobody in particular.
  if (fresh.characterId !== null && fresh.characterId !== input.characterId) {
    throw itemNotFound({ instanceId: fresh.id });
  }

  const quantity = input.quantity ?? fresh.quantity;
  if (quantity <= 0 || quantity > fresh.quantity) {
    throw illegalItemMove({ instanceId: fresh.id, quantity, available: fresh.quantity });
  }

  const definition = itemDefinition(input.bundle, fresh.definitionKey);
  const isContainer = definition.category === 'CONTAINER';

  // ── destination legality ────────────────────────────────────────────────
  if (input.to.kind === 'EQUIPPED') {
    if (isContainer) {
      throw illegalItemMove({
        instanceId: fresh.id,
        reason: 'a container is installed in a Hunt slot, not worn',
      });
    }
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
  if (input.to.kind === 'HUNT_CONTAINER') {
    if (!isContainer || !definition.containerSpaces) {
      throw illegalItemMove({ instanceId: fresh.id, reason: 'only a container can be installed' });
    }
    if (quantity !== fresh.quantity || quantity !== 1) {
      throw illegalItemMove({ instanceId: fresh.id, reason: 'a container is installed whole' });
    }
  }
  if (input.to.kind === 'CONTAINER') {
    if (isContainer) {
      // The nesting exploit, refused where it is understood rather than where
      // it happens to be noticed. Containers live in top-level slots.
      throw illegalItemMove({
        instanceId: fresh.id,
        reason: 'a container cannot go in a container',
      });
    }
    await containerOf(tx, input.bundle, input.accountId, input.characterId, input.to.containerId);
  }

  // ── taking a container OUT of its slot ──────────────────────────────────
  //
  // THE RULE, chosen and written down rather than left to whichever branch
  // ran first: a container must be EMPTY to leave its slot. Moving it loaded
  // would have to answer "where did its contents go", and every answer is
  // worse than asking the player to empty it — carrying them into the Depot
  // changes their custody silently, and leaving them behind orphans rows
  // whose parent is no longer anywhere. Re-slotting an installed container
  // from slot 1 to slot 3 is NOT leaving, so it keeps its contents.
  const leavingSlot = fresh.location === 'HUNT_CONTAINER' && input.to.kind !== 'HUNT_CONTAINER';
  if (leavingSlot && (await usedSpaces(tx, fresh.id)) > 0) {
    throw illegalItemMove({
      instanceId: fresh.id,
      reason: 'empty the container before taking it out of its slot',
    });
  }

  // ── space ───────────────────────────────────────────────────────────────
  const free = await freeSpacesIn(tx, input.bundle, input.accountId, input.characterId, input.to);
  const existing = await occupants(tx, input.accountId, input.characterId, input.to);
  const placement =
    input.to.kind === 'EQUIPPED' || input.to.kind === 'HUNT_CONTAINER'
      ? free >= 1
        ? { merges: [], newStacks: [quantity] }
        : null
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
  //
  // The slot is released BEFORE the instance changes shape and claimed AFTER,
  // because the composite foreign key is checked per statement: a slot may
  // never, even for one statement, name a row that does not agree with it.
  if (fresh.location === 'HUNT_CONTAINER' && fresh.slotIndex !== null) {
    await tx.characterContainerSlot.update({
      where: {
        characterId_slotIndex: { characterId: input.characterId, slotIndex: fresh.slotIndex },
      },
      data: { containerInstanceId: null },
    });
  }

  for (const merge of placement.merges) {
    const row = existing.find((item) => item.id === merge.id)!;
    await addToStack(tx, input.bundle, row, merge.add);
  }

  const custody = {
    characterId: input.to.kind === 'DEPOT' ? null : input.characterId,
    location:
      input.to.kind === 'EQUIPPED'
        ? ('EQUIPPED' as const)
        : input.to.kind === 'HUNT_CONTAINER'
          ? ('HUNT_CONTAINER' as const)
          : input.to.kind === 'CONTAINER'
            ? ('CHARACTER_CONTAINER' as const)
            : ('DEPOT' as const),
    slot: input.to.kind === 'EQUIPPED' ? input.to.slot : null,
    containerId: input.to.kind === 'CONTAINER' ? input.to.containerId : null,
    slotIndex: input.to.kind === 'HUNT_CONTAINER' ? input.to.slotIndex : null,
  };

  // MOVING THE WHOLE STACK MOVES THE ROW, it does not replace it.
  //
  // An instance's id IS its identity — it is what a rarity, an affix and one
  // day a Forge tier hang on. Deleting and recreating would copy the value and
  // lose the thing, and the loss would only surface in a phase that keyed
  // something on it. So the row is updated in place whenever nothing merged,
  // and only a genuine SPLIT creates something new.
  const movesWhole = quantity === fresh.quantity && placement.merges.length === 0;
  if (movesWhole && placement.newStacks.length === 1) {
    await tx.itemInstance.update({
      where: { id: fresh.id },
      data: { ...custody, quantity },
    });
  } else {
    for (const size of placement.newStacks) {
      await createItem(tx, {
        bundle: input.bundle,
        accountId: input.accountId,
        ...custody,
        definitionKey: fresh.definitionKey,
        quantity: size,
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
  }

  if (input.to.kind === 'HUNT_CONTAINER') {
    await tx.characterContainerSlot.update({
      where: {
        characterId_slotIndex: {
          characterId: input.characterId,
          slotIndex: input.to.slotIndex,
        },
      },
      data: { containerInstanceId: fresh.id },
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
  // The Loot Pouch is the Character's, so the Character is what serializes two
  // drops racing for its last space.
  await lockDestination(tx, input.accountId, input.characterId, {
    kind: 'LOOT_POUCH',
    characterId: input.characterId,
  });
  const free = await freeSpacesIn(tx, input.bundle, input.accountId, input.characterId, {
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
    const row = inPouch.find((item) => item.id === merge.id)!;
    await addToStack(tx, input.bundle, row, merge.add);
  }
  for (const size of placement.newStacks) {
    await createItem(tx, {
      bundle: input.bundle,
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
