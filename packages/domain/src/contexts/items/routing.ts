/**
 * Manage Containers — where a KNOWN, LEGAL arrival goes (Phase 3 spec §12).
 *
 * INTERNAL to the items context. Used by a counter purchase, a refill, a Stash
 * withdrawal and a Depot withdrawal. **Ordinary creature loot never routes
 * here**: it enters the Loot Pouch and nowhere else, which is why this module
 * is not reachable from the Hunt settlement.
 *
 * The fallback is a stable ladder rather than a search, because "it went
 * somewhere" is not an answer a player can plan around.
 */
import type { ResolvedBundle } from '@global-idle/game-data';
import type { Instant } from '@global-idle/shared';
import { noRoomForItem } from '../../platform/errors/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { itemDefinition } from './catalogue.js';
import {
  addToStack,
  assertCapacity,
  createItem,
  freeSpacesIn,
  lockDestination,
  planPlacement,
} from './custody.js';
import { readSlots } from './slots.js';

export interface RouteResult {
  readonly containerId: string;
  readonly stacks: number;
}

/**
 * Deliver a quantity into the Character's containers.
 *
 * 1. the PREFERRED container, whose routing category matches the definition's;
 * 2. otherwise every unlocked, installed container in ASCENDING SLOT ORDER;
 * 3. otherwise it fails, atomically — and the caller must not have charged.
 */
export async function route(
  tx: UnitOfWork,
  input: {
    readonly bundle: ResolvedBundle;
    readonly accountId: string;
    readonly characterId: string;
    readonly baseLevel: number;
    readonly definitionKey: string;
    readonly quantity: number;
    readonly at: Instant;
  },
): Promise<RouteResult> {
  const definition = itemDefinition(input.bundle, input.definitionKey);
  const slots = await readSlots(tx, input.characterId);

  // ── a CONTAINER is delivered by being INSTALLED ─────────────────────────
  //
  // It cannot route into a container, because containers do not nest. So the
  // destination for one is a free Hunt Container Slot, which is also what
  // makes slots 2 to 5 worth buying: unlock one, buy a backpack, and the
  // backpack is in it. With every unlocked slot full the purchase fails
  // atomically and nothing is charged, exactly as a full backpack does.
  if (definition.category === 'CONTAINER') {
    const free = slots.filter((slot) => slot.unlocked && !slot.containerInstanceId);
    if (free.length < input.quantity) {
      throw noRoomForItem({
        definitionKey: input.definitionKey,
        quantity: input.quantity,
        freeSlots: free.length,
        reason: 'no free Hunt container slot',
      });
    }
    await assertCapacity(
      tx,
      input.bundle,
      input.characterId,
      input.baseLevel,
      definition.weight * input.quantity,
    );
    let last = '';
    for (let n = 0; n < input.quantity; n += 1) {
      const slot = free[n]!;
      await lockDestination(tx, input.accountId, input.characterId, {
        kind: 'HUNT_CONTAINER',
        slotIndex: slot.slotIndex,
      });
      const created = await createItem(tx, {
        bundle: input.bundle,
        accountId: input.accountId,
        characterId: input.characterId,
        definitionKey: input.definitionKey,
        quantity: 1,
        location: 'HUNT_CONTAINER',
        slotIndex: slot.slotIndex,
        at: input.at,
      });
      await tx.characterContainerSlot.update({
        where: {
          characterId_slotIndex: {
            characterId: input.characterId,
            slotIndex: slot.slotIndex,
          },
        },
        data: { containerInstanceId: created.id },
      });
      last = created.id;
    }
    return { containerId: last, stacks: input.quantity };
  }

  const installed = slots.filter((slot) => slot.unlocked && slot.containerInstanceId);

  const preferred = installed.filter(
    (slot) => slot.routingCategory && slot.routingCategory === definition.category,
  );
  const order = [...preferred, ...installed.filter((slot) => !preferred.includes(slot))];

  await assertCapacity(
    tx,
    input.bundle,
    input.characterId,
    input.baseLevel,
    definition.weight * (definition.stackable ? input.quantity : 1),
  );

  for (const slot of order) {
    const containerId = slot.containerInstanceId!;
    // Serialize on the destination BEFORE counting its free space: two
    // arrivals that both read "one space left" would otherwise both write.
    await lockDestination(tx, input.accountId, input.characterId, {
      kind: 'CONTAINER',
      containerId,
    });
    const free = await freeSpacesIn(tx, input.bundle, input.accountId, input.characterId, {
      kind: 'CONTAINER',
      containerId,
    });
    const rows = await tx.itemInstance.findMany({
      where: { containerId },
      orderBy: { id: 'asc' },
    });
    const placement = planPlacement(
      {
        bundle: input.bundle,
        definitionKey: input.definitionKey,
        rarity: 'COMMON',
        affixes: [],
        quantity: input.quantity,
      },
      rows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        characterId: row.characterId,
        definitionKey: row.definitionKey,
        quantity: row.quantity,
        location: row.location as never,
        slot: row.slot as never,
        containerId: row.containerId,
        slotIndex: row.slotIndex,
        rarity: row.rarity as never,
        affixes: Array.isArray(row.affixes) ? (row.affixes as never) : [],
      })),
      free,
    );
    if (!placement) continue;

    for (const merge of placement.merges) {
      const row = rows.find((item) => item.id === merge.id)!;
      await addToStack(tx, input.bundle, row, merge.add);
    }
    for (const size of placement.newStacks) {
      await createItem(tx, {
        bundle: input.bundle,
        accountId: input.accountId,
        characterId: input.characterId,
        definitionKey: input.definitionKey,
        quantity: size,
        location: 'CHARACTER_CONTAINER',
        containerId,
        at: input.at,
      });
    }
    return { containerId, stacks: placement.merges.length + placement.newStacks.length };
  }

  // Nowhere it fits. The caller has not charged yet, and now it will not:
  // items never disappear, and no partial payment is taken for an undelivered
  // good.
  throw noRoomForItem({ definitionKey: input.definitionKey, quantity: input.quantity });
}
