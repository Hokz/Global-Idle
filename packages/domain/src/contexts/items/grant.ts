/**
 * The starting grant — real items, in real slots, from the first moment
 * (Phase 3 spec §19, source map §11).
 *
 * INTERNAL to the items context. Canary's pre-vocation kit is four armour
 * pieces and NOTHING else: no container and no weapon. Global Idle adds a
 * backpack, a dagger and potions, because a Character with no container cannot
 * carry loot and one with no weapon measurably loses to a Rat. Every item is a
 * real source item; what is adapted is WHEN it is given, and the content
 * definition says so in its own `sourceRef`.
 */
import type { ResolvedBundle } from '@global-idle/game-data';
import type { Instant } from '@global-idle/shared';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { itemDefinition, startingGrant } from './catalogue.js';
import { createItem } from './custody.js';
import type { EquipmentSlot } from './custody.js';
import { createSlots, installContainer } from './slots.js';

export async function applyStartingGrant(
  tx: UnitOfWork,
  input: {
    readonly bundle: ResolvedBundle;
    readonly accountId: string;
    readonly characterId: string;
    readonly grantKey: string;
    readonly at: Instant;
  },
): Promise<void> {
  const grant = startingGrant(input.bundle, input.grantKey);

  for (const entry of grant.equipped) {
    await createItem(tx, {
      accountId: input.accountId,
      characterId: input.characterId,
      definitionKey: entry.itemKey,
      quantity: 1,
      location: 'EQUIPPED',
      slot: entry.slot as EquipmentSlot,
      at: input.at,
    });
  }

  const container = await createItem(tx, {
    accountId: input.accountId,
    characterId: input.characterId,
    definitionKey: grant.container,
    quantity: 1,
    // A container in a top-level slot is not INSIDE anything, which is what
    // `installed` means and why it is EQUIPPED in the BACKPACK slot rather
    // than CHARACTER_CONTAINER: the latter would need a parent it does not
    // have, and the CHECK would refuse it — correctly.
    location: 'EQUIPPED',
    slot: 'BACKPACK',
    at: input.at,
  });
  await installContainer(tx, {
    bundle: input.bundle,
    characterId: input.characterId,
    slotIndex: 1,
    instanceId: container.id,
  });

  for (const entry of grant.contents) {
    const definition = itemDefinition(input.bundle, entry.itemKey);
    const maxStack = definition.stackable ? definition.maxStack : 1;
    let remaining = entry.quantity;
    while (remaining > 0) {
      const size = Math.min(maxStack, remaining);
      remaining -= size;
      await createItem(tx, {
        accountId: input.accountId,
        characterId: input.characterId,
        definitionKey: entry.itemKey,
        quantity: size,
        location: 'CHARACTER_CONTAINER',
        containerId: container.id,
        at: input.at,
      });
    }
  }
}

export { createSlots };
