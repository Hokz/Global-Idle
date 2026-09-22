/**
 * Phase 3 test support — physical items.
 *
 * The same shape as `phase2.ts`: helpers that read what is DURABLE, so a case
 * asserts the database rather than the value a function happened to return.
 */
import { items, withTransaction } from '@global-idle/domain';
import type { ContentBundleResolver, ResolvedBundle } from '@global-idle/game-data';
import type { PrismaClient } from '@global-idle/domain/generated/prisma/client.js';

export const CHEESE = 'item.cheese';
export const POTION = 'item.small-health-potion';
export const DAGGER = 'item.dagger';
export const BACKPACK = 'item.backpack';
export const HELMET = 'item.leather-helmet';
export const SERVICE = 'service.rookgaard.counter';
export const GRANT = 'starting-grant.origin.rookgaard';

export const resolveBundle = (
  resolver: ContentBundleResolver,
  version: string,
): Promise<ResolvedBundle> => resolver.resolve(version as never);

export const allOf = (prisma: PrismaClient, characterId: string) =>
  prisma.itemInstance.findMany({ where: { characterId }, orderBy: { id: 'asc' } });

export const equippedOf = (prisma: PrismaClient, characterId: string) =>
  prisma.itemInstance.findMany({
    where: { characterId, location: 'EQUIPPED' },
    orderBy: { slot: 'asc' },
  });

export const pouchOf = (prisma: PrismaClient, characterId: string) =>
  prisma.itemInstance.findMany({
    where: { characterId, location: 'LOOT_POUCH' },
    orderBy: { id: 'asc' },
  });

export const depotOf = (prisma: PrismaClient, accountId: string) =>
  prisma.itemInstance.findMany({ where: { accountId, location: 'DEPOT' }, orderBy: { id: 'asc' } });

export const slotsOf = (prisma: PrismaClient, characterId: string) =>
  prisma.characterContainerSlot.findMany({ where: { characterId }, orderBy: { slotIndex: 'asc' } });

/** The container installed in slot 1 — where the tutorial grant puts the backpack. */
export async function firstContainer(prisma: PrismaClient, characterId: string): Promise<string> {
  const slot = await prisma.characterContainerSlot.findUniqueOrThrow({
    where: { characterId_slotIndex: { characterId, slotIndex: 1 } },
  });
  if (!slot.containerInstanceId) throw new Error('slot 1 holds no container');
  return slot.containerInstanceId;
}

export const contentsOf = (prisma: PrismaClient, containerId: string) =>
  prisma.itemInstance.findMany({ where: { containerId }, orderBy: { id: 'asc' } });

/** Total quantity of one definition anywhere on the account — the number every
 *  conservation case is really about. */
export async function totalOf(
  prisma: PrismaClient,
  accountId: string,
  definitionKey: string,
): Promise<number> {
  const rows = await prisma.itemInstance.findMany({ where: { accountId, definitionKey } });
  const stashed = await prisma.stashEntry.findUnique({
    where: { accountId_definitionKey: { accountId, definitionKey } },
  });
  return rows.reduce((sum, row) => sum + row.quantity, 0) + Number(stashed?.quantity ?? 0n);
}

export const carriedWeight = (
  prisma: PrismaClient,
  bundle: ResolvedBundle,
  characterId: string,
): Promise<number> => withTransaction(prisma, (tx) => items.carriedWeight(tx, bundle, characterId));

/** Put a quantity straight into a container, bypassing the Hunt. */
export async function give(
  prisma: PrismaClient,
  input: {
    accountId: string;
    characterId: string;
    containerId: string;
    definitionKey: string;
    quantity: number;
    at: Date;
  },
): Promise<string> {
  return withTransaction(prisma, async (tx) => {
    const created = await items.createItem(tx, {
      accountId: input.accountId,
      characterId: input.characterId,
      definitionKey: input.definitionKey,
      quantity: input.quantity,
      location: 'CHARACTER_CONTAINER',
      containerId: input.containerId,
      at: input.at,
    });
    return created.id;
  });
}

/** Put a quantity straight into the Loot Pouch, as a kill would. */
export async function drop(
  prisma: PrismaClient,
  input: {
    bundle: ResolvedBundle;
    accountId: string;
    characterId: string;
    baseLevel: number;
    definitionKey: string;
    quantity: number;
    at: Date;
  },
) {
  return withTransaction(prisma, (tx) =>
    items.placeInPouch(tx, {
      bundle: input.bundle,
      accountId: input.accountId,
      characterId: input.characterId,
      baseLevel: input.baseLevel,
      definitionKey: input.definitionKey,
      quantity: input.quantity,
      at: input.at,
    }),
  );
}

/**
 * Assert a typed domain failure by its CODE, and optionally by the reason it
 * recorded in `details`.
 *
 * `rejects.toThrow(/text/)` matches the message, and these errors deliberately
 * carry a stable message with the specifics in `details` — so matching the
 * message would either be vacuous or would pin prose that is allowed to
 * change.
 */
export async function expectDomainError(
  run: () => Promise<unknown>,
  code: string,
  reason?: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  if (!thrown) throw new Error(`expected ${code}, but nothing was thrown`);
  const error = thrown as { name?: string; details?: Record<string, unknown> };
  if (error.name !== code) {
    throw new Error(`expected ${code}, got ${error.name}: ${String((thrown as Error).message)}`);
  }
  if (reason) {
    const detail = JSON.stringify(error.details ?? {});
    if (!reason.test(detail)) throw new Error(`${code} details ${detail} do not match ${reason}`);
  }
}
