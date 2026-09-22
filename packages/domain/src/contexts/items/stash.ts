/**
 * The Stash — account-level, fungible, and an AGGREGATE (Phase 3 spec §10.2).
 *
 * INTERNAL to the items context. It is the one place a quantity may exceed
 * `maxStack`, which is exactly why it is not `ItemInstance` rows: a withdrawal
 * MATERIALIZES legal stacks instead of splitting a number that was never split.
 */
import { STASH_MAX_PER_ENTRY, type Instant } from '@global-idle/shared';
import type { ResolvedBundle } from '@global-idle/game-data';
import { illegalItemMove, noRoomForItem } from '../../platform/errors/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { assertSafeContext } from './access.js';
import { itemDefinition } from './catalogue.js';
import {
  CARRIED_SOURCES,
  assertCapacity,
  createItem,
  freeSpacesIn,
  lockDestination,
  readItemForCharacterAction,
} from './custody.js';

export interface StashRow {
  readonly definitionKey: string;
  readonly quantity: bigint;
}

export async function readStash(tx: UnitOfWork, accountId: string): Promise<readonly StashRow[]> {
  const rows = await tx.stashEntry.findMany({
    where: { accountId },
    orderBy: { definitionKey: 'asc' },
  });
  return rows.map((row) => ({ definitionKey: row.definitionKey, quantity: row.quantity }));
}

/**
 * Move a physical stack INTO the Stash.
 *
 * Refuses anything the Stash is not for: a definition that is not
 * `stashEligible`, and anything individualized — a rarity above Common or any
 * affix at all. A stash entry is a number, and a number cannot remember that
 * one of the things it counts was Legendary.
 */
export async function stow(
  tx: UnitOfWork,
  input: {
    readonly bundle: ResolvedBundle;
    readonly accountId: string;
    readonly characterId: string;
    readonly instanceId: string;
    readonly quantity?: number;
    readonly at: Instant;
  },
): Promise<number> {
  await assertSafeContext(tx, input.characterId, 'stash');
  const item = await readItemForCharacterAction(tx, {
    accountId: input.accountId,
    characterId: input.characterId,
    instanceId: input.instanceId,
    allow: CARRIED_SOURCES,
  });
  const definition = itemDefinition(input.bundle, item.definitionKey);
  if (!definition.stashEligible) {
    throw illegalItemMove({ instanceId: item.id, reason: 'the definition is not stashable' });
  }
  if (item.rarity !== 'COMMON' || item.affixes.length > 0) {
    throw illegalItemMove({
      instanceId: item.id,
      reason: 'an individualized item cannot become a quantity',
    });
  }
  const quantity = input.quantity ?? item.quantity;
  if (quantity <= 0 || quantity > item.quantity) {
    throw illegalItemMove({ instanceId: item.id, quantity, available: item.quantity });
  }

  const existing = await tx.stashEntry.findUnique({
    where: {
      accountId_definitionKey: { accountId: input.accountId, definitionKey: item.definitionKey },
    },
  });
  const after = (existing?.quantity ?? 0n) + BigInt(quantity);
  if (after > BigInt(STASH_MAX_PER_ENTRY)) {
    throw noRoomForItem({ definitionKey: item.definitionKey, cap: STASH_MAX_PER_ENTRY });
  }

  await tx.stashEntry.upsert({
    where: {
      accountId_definitionKey: { accountId: input.accountId, definitionKey: item.definitionKey },
    },
    create: {
      accountId: input.accountId,
      definitionKey: item.definitionKey,
      quantity: BigInt(quantity),
      updatedAt: input.at,
    },
    update: { quantity: after, updatedAt: input.at },
  });

  if (quantity === item.quantity) await tx.itemInstance.delete({ where: { id: item.id } });
  else
    await tx.itemInstance.update({
      where: { id: item.id },
      data: { quantity: { decrement: quantity } },
    });
  return quantity;
}

/**
 * Take a quantity out, as legal stacks.
 *
 * 600 potions come back as 255 / 255 / 90 across three spaces, and if there is
 * not room for ALL THREE nothing leaves the Stash — a partial withdrawal that
 * loses the remainder is the failure mode this exists to make impossible.
 */
export async function withdraw(
  tx: UnitOfWork,
  input: {
    readonly bundle: ResolvedBundle;
    readonly accountId: string;
    readonly characterId: string;
    readonly baseLevel: number;
    readonly definitionKey: string;
    readonly quantity: number;
    readonly containerId: string;
    readonly at: Instant;
  },
): Promise<number> {
  await assertSafeContext(tx, input.characterId, 'stash');
  const rows = await tx.$queryRawUnsafe<{ quantity: bigint }[]>(
    `SELECT quantity FROM "StashEntry"
      WHERE "accountId" = $1 AND "definitionKey" = $2 FOR UPDATE`,
    input.accountId,
    input.definitionKey,
  );
  const held = rows[0]?.quantity ?? 0n;
  if (held < BigInt(input.quantity) || input.quantity <= 0) {
    throw illegalItemMove({
      definitionKey: input.definitionKey,
      requested: input.quantity,
      held: held.toString(),
    });
  }

  const definition = itemDefinition(input.bundle, input.definitionKey);
  const maxStack = definition.stackable ? definition.maxStack : 1;
  const stacks: number[] = [];
  let remaining = input.quantity;
  while (remaining > 0) {
    const size = Math.min(maxStack, remaining);
    stacks.push(size);
    remaining -= size;
  }

  // Lock the destination container before counting, for the same reason a
  // purchase does: the last free space must be won by exactly one caller.
  await lockDestination(tx, input.accountId, input.characterId, {
    kind: 'CONTAINER',
    containerId: input.containerId,
  });
  const free = await freeSpacesIn(tx, input.bundle, input.accountId, input.characterId, {
    kind: 'CONTAINER',
    containerId: input.containerId,
  });
  if (stacks.length > free) {
    throw noRoomForItem({ needed: stacks.length, free, containerId: input.containerId });
  }
  await assertCapacity(
    tx,
    input.bundle,
    input.characterId,
    input.baseLevel,
    definition.weight * input.quantity,
  );

  for (const size of stacks) {
    await createItem(tx, {
      bundle: input.bundle,
      accountId: input.accountId,
      characterId: input.characterId,
      definitionKey: input.definitionKey,
      quantity: size,
      location: 'CHARACTER_CONTAINER',
      containerId: input.containerId,
      at: input.at,
    });
  }

  const after = held - BigInt(input.quantity);
  if (after === 0n) {
    await tx.stashEntry.delete({
      where: {
        accountId_definitionKey: {
          accountId: input.accountId,
          definitionKey: input.definitionKey,
        },
      },
    });
  } else {
    await tx.stashEntry.update({
      where: {
        accountId_definitionKey: {
          accountId: input.accountId,
          definitionKey: input.definitionKey,
        },
      },
      data: { quantity: after, updatedAt: input.at },
    });
  }
  return stacks.length;
}
