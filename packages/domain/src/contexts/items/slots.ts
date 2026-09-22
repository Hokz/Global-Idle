/**
 * The five top-level Hunt Container Slots (Phase 3 spec §3.1).
 *
 * INTERNAL to the items context. LOCKED: every Character has exactly five,
 * slot 1 is free, and slots 2 to 5 are bought with Gold by THAT Character —
 * so five vocation Characters can hold up to 25 independent unlocks, and the
 * sink is permanent and heavy on purpose.
 *
 * There is no slot 6. Not "the service refuses one": the CHECK on `slotIndex`
 * means no row could hold it.
 */
import { HUNT_CONTAINER_SLOTS, type Instant, type OperationId } from '@global-idle/shared';
import type { ResolvedBundle } from '@global-idle/game-data';
import { containerSlotLocked, insufficientFunds } from '../../platform/errors/index.js';
import { recordDomainEvent } from '../../platform/observability/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { bankOf, post, readBalance } from '../economy/index.js';
import { containerSlotPrices } from './catalogue.js';

export interface ContainerSlot {
  readonly slotIndex: number;
  readonly unlocked: boolean;
  readonly containerInstanceId: string | null;
  readonly routingCategory: string | null;
}

/** Five rows, created with the Character. Slot 1 arrives unlocked. */
export async function createSlots(tx: UnitOfWork, characterId: string, at: Instant): Promise<void> {
  await tx.characterContainerSlot.createMany({
    data: Array.from({ length: HUNT_CONTAINER_SLOTS }, (_, index) => ({
      characterId,
      slotIndex: index + 1,
      unlockedAt: index === 0 ? at : null,
    })),
  });
}

export async function readSlots(
  tx: UnitOfWork,
  characterId: string,
): Promise<readonly ContainerSlot[]> {
  const rows = await tx.characterContainerSlot.findMany({
    where: { characterId },
    orderBy: { slotIndex: 'asc' },
  });
  return rows.map((row) => ({
    slotIndex: row.slotIndex,
    unlocked: row.unlockedAt !== null,
    containerInstanceId: row.containerInstanceId,
    routingCategory: row.routingCategory,
  }));
}

/**
 * Buy a slot, once, with SAFE Bank Gold.
 *
 * The Bank and not the Pouch: a permanent unlock paid out of money that a
 * death could have taken would make the purchase a gamble on surviving the
 * walk home. `post` throws `InsufficientFunds` before anything is written, and
 * an already-unlocked slot returns without charging — which is what makes a
 * retried request idempotent rather than expensive.
 */
export async function unlockSlot(
  tx: UnitOfWork,
  input: {
    readonly bundle: ResolvedBundle;
    readonly accountId: string;
    readonly characterId: string;
    readonly slotIndex: number;
    readonly operationId: OperationId;
    readonly at: Instant;
  },
): Promise<{ readonly charged: bigint; readonly alreadyUnlocked: boolean }> {
  const rows = await tx.$queryRawUnsafe<{ slotIndex: number; unlockedAt: Date | null }[]>(
    `SELECT "slotIndex", "unlockedAt" FROM "CharacterContainerSlot"
      WHERE "characterId" = $1 AND "slotIndex" = $2 FOR UPDATE`,
    input.characterId,
    input.slotIndex,
  );
  const slot = rows[0];
  if (!slot) throw containerSlotLocked({ slotIndex: input.slotIndex, reason: 'no such slot' });
  if (slot.unlockedAt !== null) return { charged: 0n, alreadyUnlocked: true };

  const prices = containerSlotPrices(input.bundle);
  const price = prices.prices.find((entry) => entry.slot === input.slotIndex);
  if (!price) throw containerSlotLocked({ slotIndex: input.slotIndex, reason: 'no price' });

  const gold = BigInt(price.gold);
  if (gold > 0n) {
    const bank = bankOf(input.accountId as never);
    const balance = await readBalance(tx, bank, 'GOLD');
    if (balance < gold) {
      throw insufficientFunds({
        accountId: input.accountId,
        currency: 'GOLD',
        balance: balance.toString(),
        requested: gold.toString(),
      });
    }
    await post(tx, {
      subject: bank,
      currency: 'GOLD',
      amount: -gold,
      reasonCode: 'container-slot.unlock',
      operationId: input.operationId,
      at: input.at,
    });
  }

  await tx.characterContainerSlot.update({
    where: {
      characterId_slotIndex: { characterId: input.characterId, slotIndex: input.slotIndex },
    },
    data: { unlockedAt: input.at },
  });
  recordDomainEvent({
    kind: 'container-slot.unlocked',
    characterId: input.characterId,
    slotIndex: input.slotIndex,
    gold: gold.toString(),
  });
  return { charged: gold, alreadyUnlocked: false };
}

/**
 * Installing is a MOVE now, not a pointer update — see `move.ts`. This file
 * owns the slots themselves: how many there are, what they cost, and where a
 * purchase prefers to land.
 */

export async function setRouting(
  tx: UnitOfWork,
  input: {
    readonly characterId: string;
    readonly slotIndex: number;
    readonly category: string | null;
  },
): Promise<void> {
  await tx.characterContainerSlot.update({
    where: {
      characterId_slotIndex: { characterId: input.characterId, slotIndex: input.slotIndex },
    },
    data: { routingCategory: input.category },
  });
}
